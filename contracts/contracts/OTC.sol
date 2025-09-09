// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface AggregatorV3Interface {
  function latestRoundData()
    external
    view
    returns (
      uint80 roundId,
      int256 answer,
      uint256 startedAt,
      uint256 updatedAt,
      uint80 answeredInRound
    );
  function decimals() external view returns (uint8);
}

/// @title OTC-like Token Sale Desk
/// @notice Permissionless offer creation, approver-gated approvals, price snapshot on creation using Chainlink.
///         No vesting; single unlock time per deal. Supports ETH or USDC payments. Tracks token and stable treasuries.
contract OTC is Ownable, Pausable, ReentrancyGuard {
  enum PaymentCurrency { ETH, USDC }

  struct Offer {
    address beneficiary; // who receives tokens at unlock
    uint256 tokenAmount; // 18 decimals
    uint256 discountBps; // 0..2500
    uint256 createdAt;   // timestamp
    uint256 unlockTime;  // timestamp
    uint256 priceUsdPerToken; // 8-decimal USD price snapshot for token
    uint256 ethUsdPrice;      // 8-decimal USD price snapshot for ETH (only if currency=ETH)
    PaymentCurrency currency;
    bool approved;
    bool paid;
    bool fulfilled;
    bool cancelled;
    address payer;
    uint256 amountPaid; // ETH in wei or USDC in 6 decimals
  }

  // tokens
  IERC20 public immutable token; // token being sold (18 decimals)
  IERC20 public immutable usdc;  // USDC stablecoin (6 decimals)

  // Chainlink price feeds
  AggregatorV3Interface public tokenUsdFeed; // token/USD (8 decimals)
  AggregatorV3Interface public ethUsdFeed;   // ETH/USD   (8 decimals)

  // Limits and controls
  uint256 public minUsdAmount = 5 * 1e8; // $5 with 8 decimals
  uint256 public maxTokenPerOrder = 10_000 * 1e18; // 10,000 tokens
  uint256 public quoteExpirySeconds = 30 minutes;
  uint256 public defaultUnlockDelaySeconds = 0; // can be set by admin

  // Treasury tracking
  uint256 public tokenDeposited;   // total tokens ever deposited
  uint256 public tokenReserved;    // tokens reserved for paid, not-yet-claimed deals

  // Roles
  address public agent;
  mapping(address => bool) public isApprover; // distributors/approvers

  // Offers
  uint256 public nextOfferId = 1;
  mapping(uint256 => Offer) public offers; // id => Offer
  uint256[] public openOfferIds;
  mapping(address => uint256[]) private _beneficiaryOfferIds;

  // Events
  event AgentUpdated(address indexed previous, address indexed newAgent);
  event ApproverUpdated(address indexed approver, bool allowed);
  event TokenDeposited(uint256 amount);
  event TokenWithdrawn(uint256 amount);
  event StableWithdrawn(address indexed to, uint256 usdcAmount, uint256 ethAmount);
  event OfferCreated(uint256 indexed id, address indexed beneficiary, uint256 tokenAmount, uint256 discountBps, PaymentCurrency currency);
  event OfferApproved(uint256 indexed id, address indexed by);
  event OfferCancelled(uint256 indexed id, address indexed by);
  event OfferPaid(uint256 indexed id, address indexed payer, uint256 amountPaid);
  event TokensClaimed(uint256 indexed id, address indexed beneficiary, uint256 amount);

  modifier onlyApproverRole() {
    require(msg.sender == agent || isApprover[msg.sender], "Not approver");
    _;
  }

  constructor(
    address owner_,
    IERC20 token_,
    IERC20 usdc_,
    AggregatorV3Interface tokenUsdFeed_,
    AggregatorV3Interface ethUsdFeed_,
    address agent_
  ) Ownable(owner_) {
    require(address(token_) != address(0) && address(usdc_) != address(0), "bad tokens");
    token = token_;
    usdc = usdc_;
    tokenUsdFeed = tokenUsdFeed_;
    ethUsdFeed = ethUsdFeed_;
    agent = agent_;
  }

  // Admin
  function setAgent(address newAgent) external onlyOwner { emit AgentUpdated(agent, newAgent); agent = newAgent; }
  function setApprover(address a, bool allowed) external onlyOwner { isApprover[a] = allowed; emit ApproverUpdated(a, allowed); }
  function setFeeds(AggregatorV3Interface tokenUsd, AggregatorV3Interface ethUsd) external onlyOwner { tokenUsdFeed = tokenUsd; ethUsdFeed = ethUsd; }
  function setLimits(uint256 minUsd, uint256 maxToken, uint256 expirySecs, uint256 unlockDelaySecs) external onlyOwner {
    minUsdAmount = minUsd; maxTokenPerOrder = maxToken; quoteExpirySeconds = expirySecs; defaultUnlockDelaySeconds = unlockDelaySecs;
  }
  function pause() external onlyOwner { _pause(); }
  function unpause() external onlyOwner { _unpause(); }

  // Treasury mgmt
  function depositTokens(uint256 amount) external onlyOwner { require(token.transferFrom(msg.sender, address(this), amount), "xferFrom"); tokenDeposited += amount; }
  function withdrawTokens(uint256 amount) external onlyOwner { require(availableTokenInventory() >= amount, "reserved"); require(token.transfer(owner(), amount), "xfer"); emit TokenWithdrawn(amount); }
  function withdrawStable(address to, uint256 usdcAmount, uint256 ethAmount) external onlyOwner {
    if (usdcAmount > 0) { require(usdc.transfer(to, usdcAmount), "usdc xfer"); }
    if (ethAmount > 0) { (bool ok, ) = payable(to).call{ value: ethAmount }(""); require(ok, "eth xfer"); }
    emit StableWithdrawn(to, usdcAmount, ethAmount);
  }

  function availableTokenInventory() public view returns (uint256) {
    uint256 bal = token.balanceOf(address(this));
    if (bal < tokenReserved) return 0; // should not happen
    return bal - tokenReserved;
  }

  // Offers
  function createOffer(
    uint256 tokenAmount,
    uint256 discountBps,
    PaymentCurrency currency,
    uint256 lockupSeconds
  ) external whenNotPaused returns (uint256 offerId) {
    require(tokenAmount > 0 && tokenAmount <= maxTokenPerOrder, "amount range");
    require(discountBps <= 2_500, "disc");

    uint256 priceUsdPerToken = _readTokenUsdPrice(); // 8d
    uint256 totalUsd = _mulDiv(tokenAmount, priceUsdPerToken, 1e18); // 8d
    totalUsd = (totalUsd * (10_000 - discountBps)) / 10_000; // apply discount
    require(totalUsd >= minUsdAmount, "min $5");

    require(availableTokenInventory() >= tokenAmount, "insuff token inv");

    offerId = nextOfferId++;
    Offer storage o = offers[offerId];
    o.beneficiary = msg.sender;
    o.tokenAmount = tokenAmount;
    o.discountBps = discountBps;
    o.createdAt = block.timestamp;
    uint256 lockup = lockupSeconds > 0 ? lockupSeconds : defaultUnlockDelaySeconds;
    o.unlockTime = block.timestamp + lockup;
    o.priceUsdPerToken = priceUsdPerToken;
    o.currency = currency;
    if (currency == PaymentCurrency.ETH) { o.ethUsdPrice = _readEthUsdPrice(); }
    _beneficiaryOfferIds[msg.sender].push(offerId);
    openOfferIds.push(offerId);
    emit OfferCreated(offerId, o.beneficiary, tokenAmount, discountBps, currency);
  }

  function approveOffer(uint256 offerId) external onlyApproverRole whenNotPaused {
    Offer storage o = offers[offerId];
    require(o.beneficiary != address(0), "no offer");
    require(!o.cancelled && !o.paid, "bad state");
    o.approved = true;
    emit OfferApproved(offerId, msg.sender);
  }

  function cancelOffer(uint256 offerId) external whenNotPaused {
    Offer storage o = offers[offerId];
    require(o.beneficiary != address(0), "no offer");
    require(!o.paid && !o.fulfilled, "already paid");
    require(msg.sender == o.beneficiary || msg.sender == owner() || msg.sender == agent || isApprover[msg.sender], "no auth");
    // Users can cancel after expiry window
    if (msg.sender == o.beneficiary) {
      require(block.timestamp >= o.createdAt + quoteExpirySeconds, "not expired");
    }
    o.cancelled = true;
    emit OfferCancelled(offerId, msg.sender);
  }

  function totalUsdForOffer(uint256 offerId) public view returns (uint256) {
    Offer storage o = offers[offerId];
    require(o.beneficiary != address(0), "no offer");
    uint256 totalUsd = _mulDiv(o.tokenAmount, o.priceUsdPerToken, 1e18); // 8d
    totalUsd = (totalUsd * (10_000 - o.discountBps)) / 10_000; // 8d
    return totalUsd;
  }

  function fulfillOffer(uint256 offerId) external payable nonReentrant whenNotPaused {
    Offer storage o = offers[offerId];
    require(o.beneficiary != address(0), "no offer");
    require(o.approved, "not appr");
    require(!o.cancelled && !o.paid && !o.fulfilled, "bad state");
    require(block.timestamp <= o.createdAt + quoteExpirySeconds, "expired");
    require(availableTokenInventory() >= o.tokenAmount, "insuff token inv");

    uint256 usd = totalUsdForOffer(offerId); // 8d
    if (o.currency == PaymentCurrency.ETH) {
      // Convert USD (8d) to ETH wei
      uint256 ethUsd = o.ethUsdPrice > 0 ? o.ethUsdPrice : _readEthUsdPrice(); // 8d
      uint256 weiAmount = _mulDiv(usd, 1e18, ethUsd); // 18d
      require(msg.value == weiAmount, "bad eth");
      o.amountPaid = weiAmount;
      o.payer = msg.sender;
      o.paid = true;
    } else {
      // USDC 6 decimals
      uint256 usdcAmount = _mulDiv(usd, 1e6, 1e8);
      require(usdc.transferFrom(msg.sender, address(this), usdcAmount), "usdc xferFrom");
      o.amountPaid = usdcAmount;
      o.payer = msg.sender;
      o.paid = true;
    }
    // reserve tokens for later claim
    tokenReserved += o.tokenAmount;
    emit OfferPaid(offerId, msg.sender, o.amountPaid);
  }

  function claim(uint256 offerId) external nonReentrant whenNotPaused {
    Offer storage o = offers[offerId];
    require(o.beneficiary != address(0), "no offer");
    require(o.paid && !o.cancelled && !o.fulfilled, "bad state");
    require(block.timestamp >= o.unlockTime, "locked");
    o.fulfilled = true;
    tokenReserved -= o.tokenAmount;
    require(token.transfer(o.beneficiary, o.tokenAmount), "xfer");
    emit TokensClaimed(offerId, o.beneficiary, o.tokenAmount);
  }

  function autoClaim(uint256[] calldata offerIds) external onlyApproverRole nonReentrant whenNotPaused {
    for (uint256 i = 0; i < offerIds.length; i++) {
      Offer storage o = offers[offerIds[i]];
      if (o.beneficiary == address(0) || !o.paid || o.cancelled || o.fulfilled) continue;
      if (block.timestamp < o.unlockTime) continue;
      o.fulfilled = true;
      tokenReserved -= o.tokenAmount;
      require(token.transfer(o.beneficiary, o.tokenAmount), "xfer");
      emit TokensClaimed(offerIds[i], o.beneficiary, o.tokenAmount);
    }
  }

  function getOpenOfferIds() external view returns (uint256[] memory) {
    uint256 total = openOfferIds.length;
    uint256 count = 0;
    for (uint256 i = 0; i < total; i++) {
      Offer storage o = offers[openOfferIds[i]];
      if (!o.cancelled && !o.paid && block.timestamp <= o.createdAt + quoteExpirySeconds) { count++; }
    }
    uint256[] memory result = new uint256[](count);
    uint256 idx = 0;
    for (uint256 j = 0; j < total; j++) {
      Offer storage o2 = offers[openOfferIds[j]];
      if (!o2.cancelled && !o2.paid && block.timestamp <= o2.createdAt + quoteExpirySeconds) { result[idx++] = openOfferIds[j]; }
    }
    return result;
  }

  function getOffersForBeneficiary(address who) external view returns (uint256[] memory) { return _beneficiaryOfferIds[who]; }

  // Pricing helpers
  function _readTokenUsdPrice() internal view returns (uint256) {
    (, int256 answer,,,) = tokenUsdFeed.latestRoundData();
    require(answer > 0, "bad price");
    return uint256(answer);
  }
  function _readEthUsdPrice() internal view returns (uint256) {
    (, int256 answer,,,) = ethUsdFeed.latestRoundData();
    require(answer > 0, "bad price");
    return uint256(answer);
  }

  function _mulDiv(uint256 a, uint256 b, uint256 d) internal pure returns (uint256) { return (a * b) / d; }

  receive() external payable {}
}


