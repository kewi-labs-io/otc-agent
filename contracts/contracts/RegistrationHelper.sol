// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {UniswapV3TWAPOracle} from "./UniswapV3TWAPOracle.sol";
import {IUniswapV3Pool} from "./interfaces/IUniswapV3Pool.sol";
import {IOTC} from "./interfaces/IOTC.sol";
import {IAggregatorV3} from "./interfaces/IAggregatorV3.sol";

// Custom errors
error ZeroOtc();
error ZeroFeed();
error InsufficientFee();
error ZeroToken();
error ZeroPool();
error InvalidDecimals();
error InvalidPool();
error OracleValidationFailed();
error InsufficientLiquidity();
error FeeTransferFailed();
error RefundFailed();
error FeeTooHigh();
error ZeroRecipient();
error NoFees();
error WithdrawalFailed();

/// @title RegistrationHelper
/// @notice Allows users to register tokens to the OTC contract by paying a fee
/// @dev Deploys UniswapV3TWAPOracle and registers token in single transaction
contract RegistrationHelper is Ownable2Step {
    IOTC public immutable otc;
    address public immutable ethUsdFeed;
    
    uint256 public registrationFee = 0; // No fee - only gas cost
    address public feeRecipient;
    
    event TokenRegistered(
        bytes32 indexed tokenId,
        address indexed tokenAddress,
        address indexed pool,
        address oracle,
        address registeredBy
    );
    event RegistrationFeeUpdated(uint256 oldFee, uint256 newFee);
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);

    // Minimum liquidity threshold (in USD) to prevent manipulation
    uint256 public constant MIN_LIQUIDITY_USD = 10000 * 1e8; // $10,000 in 8 decimals

    /**
     * @notice Validate that the provided address is a legitimate Uniswap V3 pool
     * @param pool The pool address to validate
     * @param token The token address that should be in the pool
     * @return isValid True if the pool is valid
     */
    function isValidUniswapV3Pool(address pool, address token) internal view returns (bool isValid) {
        // Check if pool implements required interface
        (bool success0, bytes memory data0) = pool.staticcall(
            abi.encodeWithSelector(IUniswapV3Pool.token0.selector)
        );
        if (!success0) return false;

        (bool success1, bytes memory data1) = pool.staticcall(
            abi.encodeWithSelector(IUniswapV3Pool.token1.selector)
        );
        if (!success1) return false;

        address token0 = abi.decode(data0, (address));
        address token1 = abi.decode(data1, (address));

        // Verify token is in pool
        if (token0 != token && token1 != token) return false;

        // Try progressively shorter observation windows
        // New pools may not have enough history for 5 minutes
        uint32[4] memory intervals = [uint32(300), uint32(120), uint32(60), uint32(30)];
        
        for (uint256 i; i < intervals.length;) {
            uint32[] memory secondsAgos = new uint32[](2);
            secondsAgos[0] = intervals[i];
            secondsAgos[1] = 0;

            (bool successObserve, bytes memory dataObserve) = pool.staticcall(
                abi.encodeWithSelector(IUniswapV3Pool.observe.selector, secondsAgos)
            );
            
            if (successObserve) {
                (int56[] memory tickCumulatives,) = abi.decode(dataObserve, (int56[], uint160[]));
                // Check that observations are valid (not zero)
                if (tickCumulatives[0] != 0 && tickCumulatives[1] != 0) {
                    return true;
                }
            }
            unchecked { ++i; }
        }
        
        return false;
    }

    /**
     * @notice Pre-validate oracle functionality before deployment
     * @param pool The pool address
     * @param token The token address
     * @return isValid True if oracle would work correctly
     */
    function validateOracle(address pool, address token) internal returns (bool) {
        // Create a temporary oracle instance to test
        UniswapV3TWAPOracle testOracle = new UniswapV3TWAPOracle(pool, token, ethUsdFeed);

        // Test oracle functionality
        (bool success, bytes memory data) = address(testOracle).staticcall(
            abi.encodeWithSelector(UniswapV3TWAPOracle.getTWAPPrice.selector)
        );

        if (!success) return false;

        uint256 price = abi.decode(data, (uint256));
        return price > 0;
    }

    /**
     * @notice Estimate if pool has sufficient liquidity to prevent manipulation
     * @param pool The pool address
     * @param token The token address
     * @return True if pool has sufficient liquidity
     */
    function hasSufficientLiquidity(address pool, address token) internal returns (bool) {
        // Create a temporary oracle instance to test
        UniswapV3TWAPOracle testOracle = new UniswapV3TWAPOracle(pool, token, ethUsdFeed);

        // Get current price to estimate liquidity
        (bool success, bytes memory data) = address(testOracle).staticcall(
            abi.encodeWithSelector(UniswapV3TWAPOracle.getTWAPPrice.selector)
        );

        if (!success) return false;

        uint256 currentPrice = abi.decode(data, (uint256));

        // For now, use price as proxy for liquidity
        // Higher price tokens generally need more liquidity to prevent manipulation
        if (currentPrice < 1e8) { // Less than $1
            return currentPrice > 1e6; // At least $0.01 equivalent
        } else if (currentPrice < 1e10) { // Less than $100
            return currentPrice > 1e8; // At least $1 equivalent
        } else {
            return currentPrice > 1e9; // At least $10 equivalent for higher value tokens
        }
    }

    constructor(address _otc, address _ethUsdFeed) payable Ownable(msg.sender) {
        if (_otc == address(0)) revert ZeroOtc();
        if (_ethUsdFeed == address(0)) revert ZeroFeed();
        otc = IOTC(_otc);
        ethUsdFeed = _ethUsdFeed;
        feeRecipient = msg.sender;
    }
    
    /// @notice Register a token with payment
    /// @param tokenAddress The ERC20 token to register
    /// @param poolAddress The Uniswap V3 pool for price oracle
    /// @return oracle The deployed oracle address
    function registerTokenWithPayment(
        address tokenAddress,
        address poolAddress
    ) external payable returns (address oracle) {
        if (msg.value < registrationFee) revert InsufficientFee();
        if (tokenAddress == address(0)) revert ZeroToken();
        if (poolAddress == address(0)) revert ZeroPool();

        // Validate token is ERC20
        IERC20Metadata token = IERC20Metadata(tokenAddress);
        uint8 decimals = token.decimals();
        if (decimals > 18) revert InvalidDecimals();

        // Validate pool is legitimate Uniswap V3 pool
        if (!isValidUniswapV3Pool(poolAddress, tokenAddress)) revert InvalidPool();

        // Pre-validate oracle functionality
        if (!validateOracle(poolAddress, tokenAddress)) revert OracleValidationFailed();

        // Validate pool has sufficient liquidity
        if (!hasSufficientLiquidity(poolAddress, tokenAddress)) revert InsufficientLiquidity();
        
        // Generate tokenId (use keccak256 of address for uniqueness)
        bytes32 tokenId = keccak256(abi.encodePacked(tokenAddress));
        
        // Deploy UniswapV3TWAPOracle
        UniswapV3TWAPOracle poolOracle = new UniswapV3TWAPOracle(
            poolAddress,
            tokenAddress,
            ethUsdFeed
        );
        
        // Transfer ownership to the RegistrationHelper's owner (protocol admin)
        // This allows the protocol to update TWAP intervals or the ETH feed if needed
        poolOracle.transferOwnership(owner());
        
        oracle = address(poolOracle);
        
        // Register token to OTC
        otc.registerToken(tokenId, tokenAddress, oracle);
        
        // Emit event before external ETH transfers (CEI pattern)
        emit TokenRegistered(tokenId, tokenAddress, poolAddress, oracle, msg.sender);
        
        // Forward fee to recipient
        if (feeRecipient != address(0)) {
            (bool success, ) = payable(feeRecipient).call{value: registrationFee}("");
            if (!success) revert FeeTransferFailed();
        }
        
        // Refund excess payment
        if (msg.value > registrationFee) {
            uint256 refund = msg.value - registrationFee;
            (bool refundSuccess, ) = payable(msg.sender).call{value: refund}("");
            if (!refundSuccess) revert RefundFailed();
        }
    }
    
    /// @notice Update registration fee (owner only)
    function setRegistrationFee(uint256 newFee) external onlyOwner {
        if (newFee > 0.1 ether) revert FeeTooHigh();
        uint256 oldFee = registrationFee;
        registrationFee = newFee;
        emit RegistrationFeeUpdated(oldFee, newFee);
    }
    
    /// @notice Update fee recipient (owner only)
    function setFeeRecipient(address newRecipient) external onlyOwner {
        if (newRecipient == address(0)) revert ZeroRecipient();
        address oldRecipient = feeRecipient;
        feeRecipient = newRecipient;
        emit FeeRecipientUpdated(oldRecipient, newRecipient);
    }
    
    /// @notice Withdraw accumulated fees (owner only)
    function withdrawFees() external onlyOwner {
        uint256 balance = address(this).balance;
        if (balance == 0) revert NoFees();
        (bool success, ) = payable(owner()).call{value: balance}("");
        if (!success) revert WithdrawalFailed();
    }
    
    receive() external payable {}
}

