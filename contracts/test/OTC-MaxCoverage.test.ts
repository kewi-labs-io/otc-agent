import { expect } from "chai";
import { ethers } from "hardhat";
import { OTC, MockERC20, MockAggregatorV3 } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("OTC Maximum Coverage Tests - Targeting 99%", function () {
  let otc: OTC;
  let defaultToken: MockERC20;
  let usdc: MockERC20;
  let tokenOracle: MockAggregatorV3;
  let ethOracle: MockAggregatorV3;
  let owner: SignerWithAddress;
  let agent: SignerWithAddress;
  let approver: SignerWithAddress;
  let approver2: SignerWithAddress;
  let approver3: SignerWithAddress;
  let consigner: SignerWithAddress;
  let buyer: SignerWithAddress;
  let buyer2: SignerWithAddress;
  let attacker: SignerWithAddress;

  const DEFAULT_TOKEN_ID = ethers.keccak256(ethers.toUtf8Bytes("DEFAULT"));
  const TOKEN_A_ID = ethers.keccak256(ethers.toUtf8Bytes("TOKEN_A"));

  beforeEach(async function () {
    [owner, agent, approver, approver2, approver3, consigner, buyer, buyer2, attacker] = await ethers.getSigners();

    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    defaultToken = await MockERC20Factory.deploy("ELIZA", "ELIZA", 18, ethers.parseEther("10000000"));
    usdc = await MockERC20Factory.deploy("USDC", "USDC", 6, ethers.parseUnits("10000000", 6));

    const MockOracleFactory = await ethers.getContractFactory("MockAggregatorV3");
    tokenOracle = await MockOracleFactory.deploy(8, 10_000_000); // $0.10
    ethOracle = await MockOracleFactory.deploy(8, 2500_00_000_000); // $2500

    const OTCFactory = await ethers.getContractFactory("OTC");
    otc = await OTCFactory.deploy(
      owner.address,
      defaultToken.target,
      usdc.target,
      tokenOracle.target,
      ethOracle.target,
      agent.address
    );

    await otc.setApprover(approver.address, true);
    await otc.registerToken(DEFAULT_TOKEN_ID, defaultToken.target, tokenOracle.target);
    
    await defaultToken.transfer(consigner.address, ethers.parseEther("5000000"));
    await defaultToken.transfer(buyer.address, ethers.parseEther("100000"));
    await usdc.transfer(buyer.address, ethers.parseUnits("1000000", 6));
    await usdc.transfer(buyer2.address, ethers.parseUnits("100000", 6));
  });

  describe("Constructor Edge Cases", function () {
    it("should reject invalid constructor parameters", async function () {
      const OTCFactory = await ethers.getContractFactory("OTC");
      
      // Zero address tokens
      await expect(
        OTCFactory.deploy(
          owner.address,
          ethers.ZeroAddress,
          usdc.target,
          tokenOracle.target,
          ethOracle.target,
          agent.address
        )
      ).to.be.revertedWith("bad tokens");

      // Wrong oracle decimals - need to create mock with wrong decimals
      const MockOracleFactory = await ethers.getContractFactory("MockAggregatorV3");
      const wrongDecimalOracle = await MockOracleFactory.deploy(6, 100_000_000); // 6 decimals instead of 8
      
      await expect(
        OTCFactory.deploy(
          owner.address,
          defaultToken.target,
          usdc.target,
          wrongDecimalOracle.target,
          ethOracle.target,
          agent.address
        )
      ).to.be.revertedWith("token feed decimals");
    });
  });

  describe("Admin Functions Complete Coverage", function () {
    it("should test all setters with edge cases", async function () {
      // setAgent edge cases
      await expect(otc.setAgent(ethers.ZeroAddress)).to.be.revertedWith("zero agent");
      await otc.setAgent(agent.address);
      
      // setRequiredApprovals edge cases
      await expect(otc.setRequiredApprovals(0)).to.be.revertedWith("invalid required approvals");
      await expect(otc.setRequiredApprovals(11)).to.be.revertedWith("invalid required approvals");
      await otc.setRequiredApprovals(3);
      
      // setFeeds with wrong decimals
      const MockOracleFactory = await ethers.getContractFactory("MockAggregatorV3");
      const wrongOracle = await MockOracleFactory.deploy(6, 100_000_000);
      await expect(
        otc.setFeeds(wrongOracle.target, ethOracle.target)
      ).to.be.revertedWith("token feed decimals");
      
      // setMaxFeedAge
      await otc.setMaxFeedAge(7200);
      expect(await otc.maxFeedAgeSeconds()).to.equal(7200);
      
      // setLimits with lockup validation
      await expect(
        otc.setLimits(
          ethers.parseUnits("5", 8),
          ethers.parseEther("10000"),
          1800,
          86400 * 366 // Too long
        )
      ).to.be.revertedWith("lockup too long");
      
      await otc.setLimits(
        ethers.parseUnits("10", 8),
        ethers.parseEther("5000"),
        900,
        86400 * 30
      );
      
      // setMaxLockup
      await otc.setMaxLockup(86400 * 180);
      expect(await otc.maxLockupSeconds()).to.equal(86400 * 180);
      
      // setRestrictFulfill
      await otc.setRestrictFulfill(true);
      expect(await otc.restrictFulfillToBeneficiaryOrApprover()).to.be.true;
      
      // setRequireApproverToFulfill
      await otc.setRequireApproverToFulfill(true);
      expect(await otc.requireApproverToFulfill()).to.be.true;
      
      // setEmergencyRefund
      await otc.setEmergencyRefund(true);
      expect(await otc.emergencyRefundsEnabled()).to.be.true;
      
      // setEmergencyRefundDeadline
      await otc.setEmergencyRefundDeadline(60);
      expect(await otc.emergencyRefundDeadline()).to.equal(86400 * 60);
      
      // setManualPrices with all edge cases
      await expect(
        otc.setManualPrices(0, ethers.parseUnits("3000", 8), true)
      ).to.be.revertedWith("invalid token price");
      
      await expect(
        otc.setManualPrices(
          ethers.parseUnits("10001", 8), // Above max
          ethers.parseUnits("3000", 8),
          true
        )
      ).to.be.revertedWith("invalid token price");
      
      await expect(
        otc.setManualPrices(
          ethers.parseUnits("100", 8),
          999_999n, // Below min
          true
        )
      ).to.be.revertedWith("invalid eth price");
      
      await expect(
        otc.setManualPrices(
          ethers.parseUnits("100", 8),
          ethers.parseUnits("100001", 8), // Above max
          true
        )
      ).to.be.revertedWith("invalid eth price");
      
      // Valid manual prices
      await otc.setManualPrices(
        ethers.parseUnits("50", 8),
        ethers.parseUnits("3000", 8),
        true
      );
      
      // pause/unpause
      await otc.pause();
      await expect(
        otc.connect(consigner).createConsignment(
          DEFAULT_TOKEN_ID,
          ethers.parseEther("1000"),
          false, 1000, 0, 0, 0, 0, 0,
          ethers.parseEther("10"),
          ethers.parseEther("100"),
          true, false, 2000, 86400
        )
      ).to.be.reverted;
      
      await otc.unpause();
    });

    it("should test approver management", async function () {
      // Add multiple approvers
      await otc.setApprover(approver2.address, true);
      await otc.setApprover(approver3.address, true);
      expect(await otc.isApprover(approver2.address)).to.be.true;
      
      // Remove approver
      await otc.setApprover(approver2.address, false);
      expect(await otc.isApprover(approver2.address)).to.be.false;
    });
  });

  describe("Token Registration Edge Cases", function () {
    it("should handle all registration scenarios", async function () {
      // Register with zero address
      await expect(
        otc.registerToken(TOKEN_A_ID, ethers.ZeroAddress, tokenOracle.target)
      ).to.be.revertedWith("zero address");
      
      // Register duplicate
      await expect(
        otc.registerToken(DEFAULT_TOKEN_ID, defaultToken.target, tokenOracle.target)
      ).to.be.revertedWith("token exists");
      
      // Register new token successfully
      const MockERC20Factory = await ethers.getContractFactory("MockERC20");
      const tokenA = await MockERC20Factory.deploy("TokenA", "TKA", 18, ethers.parseEther("1000000"));
      await otc.registerToken(TOKEN_A_ID, tokenA.target, tokenOracle.target);
      
      const registered = await otc.tokens(TOKEN_A_ID);
      expect(registered.isActive).to.be.true;
    });
  });

  describe("Consignment Creation Edge Cases", function () {
    it("should validate all consignment parameters", async function () {
      // Zero amount
      await expect(
        otc.connect(consigner).createConsignment(
          DEFAULT_TOKEN_ID,
          0,
          false, 1000, 0, 0, 0, 0, 0,
          ethers.parseEther("10"),
          ethers.parseEther("100"),
          true, false, 2000, 86400
        )
      ).to.be.revertedWith("zero amount");
      
      // Invalid deal amounts
      await expect(
        otc.connect(consigner).createConsignment(
          DEFAULT_TOKEN_ID,
          ethers.parseEther("1000"),
          false, 1000, 0, 0, 0, 0, 0,
          ethers.parseEther("200"), // min > max
          ethers.parseEther("100"), // max
          true, false, 2000, 86400
        )
      ).to.be.revertedWith("invalid deal amounts");
      
      // Invalid discount range
      await expect(
        otc.connect(consigner).createConsignment(
          DEFAULT_TOKEN_ID,
          ethers.parseEther("1000"),
          true, 0, 0,
          2000, // min
          1000, // max (less than min)
          0, 30,
          ethers.parseEther("10"),
          ethers.parseEther("100"),
          true, false, 2000, 86400
        )
      ).to.be.revertedWith("invalid discount range");
      
      // Invalid lockup range
      await expect(
        otc.connect(consigner).createConsignment(
          DEFAULT_TOKEN_ID,
          ethers.parseEther("1000"),
          true, 0, 0, 500, 2000,
          30, // min
          10, // max (less than min)
          ethers.parseEther("10"),
          ethers.parseEther("100"),
          true, false, 2000, 86400
        )
      ).to.be.revertedWith("invalid lockup range");
      
      // Inactive token
      const INACTIVE_ID = ethers.keccak256(ethers.toUtf8Bytes("INACTIVE"));
      await expect(
        otc.connect(consigner).createConsignment(
          INACTIVE_ID,
          ethers.parseEther("1000"),
          false, 1000, 0, 0, 0, 0, 0,
          ethers.parseEther("10"),
          ethers.parseEther("100"),
          true, false, 2000, 86400
        )
      ).to.be.revertedWith("token not active");
    });
  });

  describe("Offer Creation From Consignment Edge Cases", function () {
    it("should validate all offer parameters", async function () {
      await defaultToken.connect(consigner).approve(otc.target, ethers.parseEther("10000"));
      
      // Create negotiable consignment
      const consignmentId = await otc.connect(consigner).createConsignment.staticCall(
        DEFAULT_TOKEN_ID,
        ethers.parseEther("10000"),
        true, 0, 0, 500, 2000, 0, 60,
        ethers.parseEther("100"),
        ethers.parseEther("5000"),
        true, false, 2000, 86400
      );
      
      await otc.connect(consigner).createConsignment(
        DEFAULT_TOKEN_ID,
        ethers.parseEther("10000"),
        true, 0, 0, 500, 2000, 0, 60,
        ethers.parseEther("100"),
        ethers.parseEther("5000"),
        true, false, 2000, 86400
      );
      
      // Amount below minimum
      await expect(
        otc.connect(buyer).createOfferFromConsignment(
          consignmentId,
          ethers.parseEther("50"), // Below min of 100
          1000, 1, 0
        )
      ).to.be.revertedWith("amount out of range");
      
      // Amount above maximum
      await expect(
        otc.connect(buyer).createOfferFromConsignment(
          consignmentId,
          ethers.parseEther("6000"), // Above max of 5000
          1000, 1, 0
        )
      ).to.be.revertedWith("amount out of range");
      
      // Discount out of range
      await expect(
        otc.connect(buyer).createOfferFromConsignment(
          consignmentId,
          ethers.parseEther("1000"),
          400, // Below min of 500
          1, 0
        )
      ).to.be.revertedWith("discount out of range");
      
      await expect(
        otc.connect(buyer).createOfferFromConsignment(
          consignmentId,
          ethers.parseEther("1000"),
          2100, // Above max of 2000
          1, 0
        )
      ).to.be.revertedWith("discount out of range");
      
      // Lockup out of range
      await expect(
        otc.connect(buyer).createOfferFromConsignment(
          consignmentId,
          ethers.parseEther("1000"),
          1000, 1,
          86400 * 61 // Above max of 60 days
        )
      ).to.be.revertedWith("lockup out of range");
      
      // Fixed price consignment - wrong discount
      const fixedConsignmentId = await otc.connect(consigner).createConsignment.staticCall(
        DEFAULT_TOKEN_ID,
        ethers.parseEther("10000"),
        false, 1500, 30, 0, 0, 0, 0,
        ethers.parseEther("100"),
        ethers.parseEther("5000"),
        true, false, 2000, 86400
      );
      
      await otc.connect(consigner).createConsignment(
        DEFAULT_TOKEN_ID,
        ethers.parseEther("10000"),
        false, 1500, 30, 0, 0, 0, 0,
        ethers.parseEther("100"),
        ethers.parseEther("5000"),
        true, false, 2000, 86400
      );
      
      await expect(
        otc.connect(buyer).createOfferFromConsignment(
          fixedConsignmentId,
          ethers.parseEther("1000"),
          1000, // Wrong discount (should be 1500)
          1, 86400 * 30
        )
      ).to.be.revertedWith("must use fixed discount");
      
      await expect(
        otc.connect(buyer).createOfferFromConsignment(
          fixedConsignmentId,
          ethers.parseEther("1000"),
          1500,
          1,
          86400 * 20 // Wrong lockup (should be 30 days)
        )
      ).to.be.revertedWith("must use fixed lockup");
    });
  });

  describe("Withdrawal Functions", function () {
    it("should test withdrawConsignment edge cases", async function () {
      await defaultToken.connect(consigner).approve(otc.target, ethers.parseEther("10000"));
      
      const consignmentId = await otc.connect(consigner).createConsignment.staticCall(
        DEFAULT_TOKEN_ID,
        ethers.parseEther("10000"),
        false, 1000, 0, 0, 0, 0, 0,
        ethers.parseEther("100"),
        ethers.parseEther("1000"),
        true, false, 2000, 86400
      );
      
      await otc.connect(consigner).createConsignment(
        DEFAULT_TOKEN_ID,
        ethers.parseEther("10000"),
        false, 1000, 0, 0, 0, 0, 0,
        ethers.parseEther("100"),
        ethers.parseEther("1000"),
        true, false, 2000, 86400
      );
      
      // Only consigner can withdraw
      await expect(
        otc.connect(attacker).withdrawConsignment(consignmentId)
      ).to.be.revertedWith("not consigner");
      
      // Partial consignment usage
      await otc.connect(buyer).createOfferFromConsignment(
        consignmentId,
        ethers.parseEther("1000"),
        1000, 1, 0
      );
      
      // Should withdraw remaining
      const balanceBefore = await defaultToken.balanceOf(consigner.address);
      await otc.connect(consigner).withdrawConsignment(consignmentId);
      const balanceAfter = await defaultToken.balanceOf(consigner.address);
      
      expect(balanceAfter - balanceBefore).to.equal(ethers.parseEther("9000"));
      
      // Cannot withdraw inactive consignment
      await expect(
        otc.connect(consigner).withdrawConsignment(consignmentId)
      ).to.be.revertedWith("not active");
      
      // Cannot withdraw non-existent consignment
      await expect(
        otc.connect(consigner).withdrawConsignment(999)
      ).to.be.revertedWith("not consigner");
    });

    it("should test withdrawStable", async function () {
      // Zero address check
      await expect(
        otc.withdrawStable(ethers.ZeroAddress, 0, ethers.parseEther("1"))
      ).to.be.revertedWith("zero addr");
      
      // Fund contract
      await owner.sendTransaction({
        to: otc.target,
        value: ethers.parseEther("10")
      });
      
      // Create and fulfill an offer to get USDC in contract
      await defaultToken.connect(consigner).approve(otc.target, ethers.parseEther("10000"));
      const consignmentId = await otc.connect(consigner).createConsignment.staticCall(
        DEFAULT_TOKEN_ID,
        ethers.parseEther("10000"),
        false, 1000, 0, 0, 0, 0, 0,
        ethers.parseEther("100"),
        ethers.parseEther("1000"),
        true, false, 2000, 86400
      );
      
      await otc.connect(consigner).createConsignment(
        DEFAULT_TOKEN_ID,
        ethers.parseEther("10000"),
        false, 1000, 0, 0, 0, 0, 0,
        ethers.parseEther("100"),
        ethers.parseEther("1000"),
        true, false, 2000, 86400
      );
      
      const offerId = await otc.connect(buyer).createOfferFromConsignment.staticCall(
        consignmentId,
        ethers.parseEther("1000"),
        1000, 1, 0
      );
      
      await otc.connect(buyer).createOfferFromConsignment(
        consignmentId,
        ethers.parseEther("1000"),
        1000, 1, 0
      );
      
      await otc.connect(approver).approveOffer(offerId);
      const requiredUsdc = await otc.requiredUsdcAmount(offerId);
      await usdc.connect(buyer).approve(otc.target, requiredUsdc);
      await otc.connect(buyer).fulfillOffer(offerId);
      
      // Withdraw both USDC and ETH
      const usdcBalance = await usdc.balanceOf(otc.target);
      await otc.withdrawStable(owner.address, usdcBalance, ethers.parseEther("1"));
    });
  });

  describe("Multi-Approval Flow", function () {
    it("should handle all multi-sig scenarios", async function () {
      await otc.setApprover(approver2.address, true);
      await otc.setApprover(approver3.address, true);
      await otc.setRequiredApprovals(3);
      
      await defaultToken.connect(consigner).approve(otc.target, ethers.parseEther("10000"));
      const consignmentId = await otc.connect(consigner).createConsignment.staticCall(
        DEFAULT_TOKEN_ID,
        ethers.parseEther("10000"),
        false, 1000, 0, 0, 0, 0, 0,
        ethers.parseEther("100"),
        ethers.parseEther("1000"),
        true, false, 2000, 86400
      );
      
      await otc.connect(consigner).createConsignment(
        DEFAULT_TOKEN_ID,
        ethers.parseEther("10000"),
        false, 1000, 0, 0, 0, 0, 0,
        ethers.parseEther("100"),
        ethers.parseEther("1000"),
        true, false, 2000, 86400
      );
      
      const offerId = await otc.connect(buyer).createOfferFromConsignment.staticCall(
        consignmentId,
        ethers.parseEther("1000"),
        1000, 1, 0
      );
      
      await otc.connect(buyer).createOfferFromConsignment(
        consignmentId,
        ethers.parseEther("1000"),
        1000, 1, 0
      );
      
      // First approval
      await otc.connect(approver).approveOffer(offerId);
      expect((await otc.offers(offerId)).approved).to.be.false;
      
      // Double approval attempt
      await expect(
        otc.connect(approver).approveOffer(offerId)
      ).to.be.revertedWith("already approved by you");
      
      // Second approval
      await otc.connect(approver2).approveOffer(offerId);
      expect((await otc.offers(offerId)).approved).to.be.false;
      
      // Third approval - should now be approved
      await otc.connect(approver3).approveOffer(offerId);
      expect((await otc.offers(offerId)).approved).to.be.true;
    });
  });

  describe("Cancel Offer Permissions", function () {
    it("should test all cancel scenarios", async function () {
      await defaultToken.connect(consigner).approve(otc.target, ethers.parseEther("10000"));
      const consignmentId = await otc.connect(consigner).createConsignment.staticCall(
        DEFAULT_TOKEN_ID,
        ethers.parseEther("10000"),
        false, 1000, 0, 0, 0, 0, 0,
        ethers.parseEther("100"),
        ethers.parseEther("1000"),
        true, false, 2000, 86400
      );
      
      await otc.connect(consigner).createConsignment(
        DEFAULT_TOKEN_ID,
        ethers.parseEther("10000"),
        false, 1000, 0, 0, 0, 0, 0,
        ethers.parseEther("100"),
        ethers.parseEther("1000"),
        true, false, 2000, 86400
      );
      
      const offerId = await otc.connect(buyer).createOfferFromConsignment.staticCall(
        consignmentId,
        ethers.parseEther("1000"),
        1000, 1, 0
      );
      
      await otc.connect(buyer).createOfferFromConsignment(
        consignmentId,
        ethers.parseEther("1000"),
        1000, 1, 0
      );
      
      // Unauthorized user cannot cancel
      await expect(
        otc.connect(attacker).cancelOffer(offerId)
      ).to.be.revertedWith("no auth");
      
      // Beneficiary cannot cancel before expiry
      await expect(
        otc.connect(buyer).cancelOffer(offerId)
      ).to.be.revertedWith("not expired");
      
      // Owner can cancel
      await otc.connect(owner).cancelOffer(offerId);
      
      // Cannot cancel already cancelled
      await expect(
        otc.connect(owner).cancelOffer(offerId)
      ).to.be.revertedWith("bad state");
    });
  });

  describe("Price Oracle Scenarios", function () {
    it("should handle all price feed scenarios", async function () {
      // Bad price (negative)
      await tokenOracle.setAnswer(-1);
      
      await defaultToken.connect(consigner).approve(otc.target, ethers.parseEther("10000"));
      const consignmentId = await otc.connect(consigner).createConsignment.staticCall(
        DEFAULT_TOKEN_ID,
        ethers.parseEther("10000"),
        false, 1000, 0, 0, 0, 0, 0,
        ethers.parseEther("100"),
        ethers.parseEther("1000"),
        true, false, 2000, 86400
      );
      
      await otc.connect(consigner).createConsignment(
        DEFAULT_TOKEN_ID,
        ethers.parseEther("10000"),
        false, 1000, 0, 0, 0, 0, 0,
        ethers.parseEther("100"),
        ethers.parseEther("1000"),
        true, false, 2000, 86400
      );
      
      await expect(
        otc.connect(buyer).createOfferFromConsignment(
          consignmentId,
          ethers.parseEther("1000"),
          1000, 1, 0
        )
      ).to.be.revertedWith("bad price");
      
      // Zero price
      await tokenOracle.setAnswer(0);
      await expect(
        otc.connect(buyer).createOfferFromConsignment(
          consignmentId,
          ethers.parseEther("1000"),
          1000, 1, 0
        )
      ).to.be.revertedWith("bad price");
      
      // Stale round
      await tokenOracle.setAnswer(10_000_000);
      await tokenOracle.setRoundData(2, 1, 0, Math.floor(Date.now() / 1000));
      await expect(
        otc.connect(buyer).createOfferFromConsignment(
          consignmentId,
          ethers.parseEther("1000"),
          1000, 1, 0
        )
      ).to.be.revertedWith("stale round");
    });

    it("should handle manual price scenarios", async function () {
      // Set manual prices
      await otc.setManualPrices(
        ethers.parseUnits("50", 8),
        ethers.parseUnits("3000", 8),
        true
      );
      
      await defaultToken.connect(consigner).approve(otc.target, ethers.parseEther("10000"));
      const consignmentId = await otc.connect(consigner).createConsignment.staticCall(
        DEFAULT_TOKEN_ID,
        ethers.parseEther("10000"),
        false, 1000, 0, 0, 0, 0, 0,
        ethers.parseEther("100"),
        ethers.parseEther("1000"),
        true, false, 2000, 86400
      );
      
      await otc.connect(consigner).createConsignment(
        DEFAULT_TOKEN_ID,
        ethers.parseEther("10000"),
        false, 1000, 0, 0, 0, 0, 0,
        ethers.parseEther("100"),
        ethers.parseEther("1000"),
        true, false, 2000, 86400
      );
      
      // Should use manual price
      const offerId = await otc.connect(buyer).createOfferFromConsignment.staticCall(
        consignmentId,
        ethers.parseEther("200"),
        1000, 1, 0
      );
      
      await otc.connect(buyer).createOfferFromConsignment(
        consignmentId,
        ethers.parseEther("200"),
        1000, 1, 0
      );
      
      const offer = await otc.offers(offerId);
      expect(offer.priceUsdPerToken).to.equal(ethers.parseUnits("50", 8));
      
      // Test stale manual price
      await time.increase(3601);
      await expect(
        otc.connect(buyer).createOfferFromConsignment(
          consignmentId,
          ethers.parseEther("200"),
          1000, 1, 0
        )
      ).to.be.revertedWith("manual price too old");
    });
  });

  describe("Emergency Recovery", function () {
    it("should test all emergency refund scenarios", async function () {
      await otc.setEmergencyRefund(true);
      await otc.setEmergencyRefundDeadline(10);
      
      await defaultToken.connect(consigner).approve(otc.target, ethers.parseEther("10000"));
      const consignmentId = await otc.connect(consigner).createConsignment.staticCall(
        DEFAULT_TOKEN_ID,
        ethers.parseEther("10000"),
        false, 1000, 30, 0, 0, 0, 0,
        ethers.parseEther("100"),
        ethers.parseEther("1000"),
        true, false, 2000, 86400
      );
      
      await otc.connect(consigner).createConsignment(
        DEFAULT_TOKEN_ID,
        ethers.parseEther("10000"),
        false, 1000, 30, 0, 0, 0, 0,
        ethers.parseEther("100"),
        ethers.parseEther("1000"),
        true, false, 2000, 86400
      );
      
      const offerId1 = await otc.connect(buyer).createOfferFromConsignment.staticCall(
        consignmentId,
        ethers.parseEther("1000"),
        1000, 1, 86400 * 30
      );
      
      await otc.connect(buyer).createOfferFromConsignment(
        consignmentId,
        ethers.parseEther("1000"),
        1000, 1, 86400 * 30
      );
      
      await otc.connect(approver).approveOffer(offerId1);
      const requiredUsdc = await otc.requiredUsdcAmount(offerId1);
      await usdc.connect(buyer).approve(otc.target, requiredUsdc);
      await otc.connect(buyer).fulfillOffer(offerId1);
      
      // Too early for refund
      await expect(
        otc.connect(buyer).emergencyRefund(offerId1)
      ).to.be.revertedWith("too early for emergency refund");
      
      // Fast forward
      await time.increase(86400 * 11);
      
      // Emergency refund for USDC payment
      await otc.connect(buyer).emergencyRefund(offerId1);
      
      // Create ETH payment offer
      const offerId2 = await otc.connect(buyer2).createOfferFromConsignment.staticCall(
        consignmentId,
        ethers.parseEther("1000"),
        1000, 0, 86400 * 30
      );
      
      await otc.connect(buyer2).createOfferFromConsignment(
        consignmentId,
        ethers.parseEther("1000"),
        1000, 0, 86400 * 30
      );
      
      await otc.connect(approver).approveOffer(offerId2);
      const requiredEth = await otc.requiredEthWei(offerId2);
      await otc.connect(buyer2).fulfillOffer(offerId2, { value: requiredEth });
      
      await time.increase(86400 * 1);
      
      // Emergency refund for ETH payment
      await otc.connect(buyer2).emergencyRefund(offerId2);
    });

    it("should test adminEmergencyWithdraw", async function () {
      await defaultToken.connect(consigner).approve(otc.target, ethers.parseEther("10000"));
      const consignmentId = await otc.connect(consigner).createConsignment.staticCall(
        DEFAULT_TOKEN_ID,
        ethers.parseEther("10000"),
        false, 1000, 30, 0, 0, 0, 0,
        ethers.parseEther("100"),
        ethers.parseEther("1000"),
        true, false, 2000, 86400
      );
      
      await otc.connect(consigner).createConsignment(
        DEFAULT_TOKEN_ID,
        ethers.parseEther("10000"),
        false, 1000, 30, 0, 0, 0, 0,
        ethers.parseEther("100"),
        ethers.parseEther("1000"),
        true, false, 2000, 86400
      );
      
      const offerId = await otc.connect(buyer).createOfferFromConsignment.staticCall(
        consignmentId,
        ethers.parseEther("1000"),
        1000, 1, 86400 * 30
      );
      
      await otc.connect(buyer).createOfferFromConsignment(
        consignmentId,
        ethers.parseEther("1000"),
        1000, 1, 86400 * 30
      );
      
      await otc.connect(approver).approveOffer(offerId);
      const requiredUsdc = await otc.requiredUsdcAmount(offerId);
      await usdc.connect(buyer).approve(otc.target, requiredUsdc);
      await otc.connect(buyer).fulfillOffer(offerId);
      
      // Too early for admin withdrawal
      await expect(
        otc.adminEmergencyWithdraw(offerId)
      ).to.be.revertedWith("too early");
      
      // Fast forward 180+ days after unlock
      await time.increase(86400 * (30 + 181));
      
      // Admin emergency withdraw
      await otc.adminEmergencyWithdraw(offerId);
    });
  });

  describe("Array Cleanup - Lines 803-806", function () {
    it("should trigger array compaction precisely", async function () {
      // This test specifically targets lines 803-806
      const consignmentIds = [];
      
      // Create multiple large consignments
      for (let i = 0; i < 5; i++) {
        await defaultToken.connect(consigner).approve(otc.target, ethers.parseEther("500000"));
        const consignmentId = await otc.connect(consigner).createConsignment.staticCall(
          DEFAULT_TOKEN_ID,
          ethers.parseEther("500000"),
          true, 0, 0, 100, 2000, 0, 30,
          ethers.parseEther("100"),
          ethers.parseEther("10000"),
          true, false, 2000, 86400
        );
        
        await otc.connect(consigner).createConsignment(
          DEFAULT_TOKEN_ID,
          ethers.parseEther("500000"),
          true, 0, 0, 100, 2000, 0, 30,
          ethers.parseEther("100"),
          ethers.parseEther("10000"),
          true, false, 2000, 86400
        );
        consignmentIds.push(consignmentId);
      }
      
      // Create exactly 1000 offers
      const offerIds = [];
      for (let i = 0; i < 1000; i++) {
        const consignmentId = consignmentIds[i % consignmentIds.length];
        try {
          const offerId = await otc.connect(buyer).createOfferFromConsignment.staticCall(
            consignmentId,
            ethers.parseEther("100"),
            500, 1, 0
          );
          
          await otc.connect(buyer).createOfferFromConsignment(
            consignmentId,
            ethers.parseEther("100"),
            500, 1, 0
          );
          offerIds.push(offerId);
        } catch (error) {
          break;
        }
      }
      
      // Cancel offers with specific pattern to trigger lines 803-806
      // Pattern: keep, keep, cancel, keep, keep, cancel...
      for (let i = 2; i < offerIds.length; i += 3) {
        await otc.connect(approver).cancelOffer(offerIds[i]);
      }
      
      // Fast forward to make cancelled offers old
      await time.increase(86400 * 2);
      
      // The 1001st offer triggers cleanup with array compaction
      const finalConsignmentId = consignmentIds[0];
      await otc.connect(buyer).createOfferFromConsignment(
        finalConsignmentId,
        ethers.parseEther("100"),
        500, 1, 0
      );
      
      const openOffers = await otc.getOpenOfferIds();
      expect(openOffers.length).to.be.lte(100);
    });
  });

  describe("View Functions Coverage", function () {
    it("should test all view functions", async function () {
      // availableTokenInventory for default token
      const availableDefault = await otc.availableTokenInventory();
      expect(availableDefault).to.equal(0);
      
      // availableTokenInventoryForToken
      const availableToken = await otc.availableTokenInventoryForToken(DEFAULT_TOKEN_ID);
      expect(availableToken).to.equal(0);
      
      // getOffersForBeneficiary
      await defaultToken.connect(consigner).approve(otc.target, ethers.parseEther("10000"));
      const consignmentId = await otc.connect(consigner).createConsignment.staticCall(
        DEFAULT_TOKEN_ID,
        ethers.parseEther("10000"),
        false, 1000, 0, 0, 0, 0, 0,
        ethers.parseEther("100"),
        ethers.parseEther("1000"),
        true, false, 2000, 86400
      );
      
      await otc.connect(consigner).createConsignment(
        DEFAULT_TOKEN_ID,
        ethers.parseEther("10000"),
        false, 1000, 0, 0, 0, 0, 0,
        ethers.parseEther("100"),
        ethers.parseEther("1000"),
        true, false, 2000, 86400
      );
      
      await otc.connect(buyer).createOfferFromConsignment(
        consignmentId,
        ethers.parseEther("1000"),
        1000, 1, 0
      );
      
      const buyerOffers = await otc.getOffersForBeneficiary(buyer.address);
      expect(buyerOffers.length).to.equal(1);
      
      // totalUsdForOffer
      const totalUsd = await otc.totalUsdForOffer(buyerOffers[0]);
      expect(totalUsd).to.be.gt(0);
      
      // requiredUsdcAmount
      const requiredUsdc = await otc.requiredUsdcAmount(buyerOffers[0]);
      expect(requiredUsdc).to.be.gt(0);
      
      // requiredEthWei for non-ETH offer (should revert)
      await expect(
        otc.requiredEthWei(buyerOffers[0])
      ).to.be.revertedWith("not ETH");
      
      // Create ETH offer
      const offerId2 = await otc.connect(buyer).createOfferFromConsignment.staticCall(
        consignmentId,
        ethers.parseEther("1000"),
        1000, 0, 0
      );
      
      await otc.connect(buyer).createOfferFromConsignment(
        consignmentId,
        ethers.parseEther("1000"),
        1000, 0, 0
      );
      
      // requiredEthWei for ETH offer
      const requiredEth = await otc.requiredEthWei(offerId2);
      expect(requiredEth).to.be.gt(0);
      
      // requiredUsdcAmount for ETH offer (should revert)
      await expect(
        otc.requiredUsdcAmount(offerId2)
      ).to.be.revertedWith("not USDC");
    });
  });

  describe("ETH Payment Edge Cases", function () {
    it("should handle ETH overpayment and refund", async function () {
      await defaultToken.connect(consigner).approve(otc.target, ethers.parseEther("10000"));
      const consignmentId = await otc.connect(consigner).createConsignment.staticCall(
        DEFAULT_TOKEN_ID,
        ethers.parseEther("10000"),
        false, 1000, 0, 0, 0, 0, 0,
        ethers.parseEther("100"),
        ethers.parseEther("1000"),
        true, false, 2000, 86400
      );
      
      await otc.connect(consigner).createConsignment(
        DEFAULT_TOKEN_ID,
        ethers.parseEther("10000"),
        false, 1000, 0, 0, 0, 0, 0,
        ethers.parseEther("100"),
        ethers.parseEther("1000"),
        true, false, 2000, 86400
      );
      
      const offerId = await otc.connect(buyer).createOfferFromConsignment.staticCall(
        consignmentId,
        ethers.parseEther("1000"),
        1000, 0, 0
      );
      
      await otc.connect(buyer).createOfferFromConsignment(
        consignmentId,
        ethers.parseEther("1000"),
        1000, 0, 0
      );
      
      await otc.connect(approver).approveOffer(offerId);
      const requiredEth = await otc.requiredEthWei(offerId);
      
      // Overpay by 2x
      const overpayment = requiredEth * 2n;
      await otc.connect(buyer).fulfillOffer(offerId, { value: overpayment });
      
      // Should have paid and refunded excess
      const offer = await otc.offers(offerId);
      expect(offer.paid).to.be.true;
      expect(offer.amountPaid).to.equal(requiredEth);
    });
  });

  describe("Cleanup Expired Offers", function () {
    it("should handle public cleanup with limits", async function () {
      await defaultToken.connect(consigner).approve(otc.target, ethers.parseEther("100000"));
      const consignmentId = await otc.connect(consigner).createConsignment.staticCall(
        DEFAULT_TOKEN_ID,
        ethers.parseEther("100000"),
        true, 0, 0, 100, 2000, 0, 30,
        ethers.parseEther("10"),
        ethers.parseEther("1000"),
        true, false, 2000, 86400
      );
      
      await otc.connect(consigner).createConsignment(
        DEFAULT_TOKEN_ID,
        ethers.parseEther("100000"),
        true, 0, 0, 100, 2000, 0, 30,
        ethers.parseEther("10"),
        ethers.parseEther("1000"),
        true, false, 2000, 86400
      );
      
      // Create many offers
      const offerIds = [];
      for (let i = 0; i < 50; i++) {
        const offerId = await otc.connect(buyer).createOfferFromConsignment.staticCall(
          consignmentId,
          ethers.parseEther("100"),
          500, 1, 0
        );
        
        await otc.connect(buyer).createOfferFromConsignment(
          consignmentId,
          ethers.parseEther("100"),
          500, 1, 0
        );
        offerIds.push(offerId);
      }
      
      // Cancel half
      for (let i = 0; i < 25; i++) {
        await otc.connect(approver).cancelOffer(offerIds[i]);
      }
      
      // Fast forward past expiry
      await time.increase(86400 * 2);
      
      // Invalid batch size
      await expect(
        otc.cleanupExpiredOffers(101)
      ).to.be.revertedWith("invalid max");
      
      // Valid cleanup
      await otc.cleanupExpiredOffers(50);
      
      const openOffers = await otc.getOpenOfferIds();
      expect(openOffers.length).to.be.lt(50);
    });
  });

  describe("Fulfill Restrictions", function () {
    it("should test all fulfillment restriction modes", async function () {
      await defaultToken.connect(consigner).approve(otc.target, ethers.parseEther("30000"));
      const consignmentId = await otc.connect(consigner).createConsignment.staticCall(
        DEFAULT_TOKEN_ID,
        ethers.parseEther("30000"),
        false, 1000, 0, 0, 0, 0, 0,
        ethers.parseEther("100"),
        ethers.parseEther("10000"),
        true, false, 2000, 86400
      );
      
      await otc.connect(consigner).createConsignment(
        DEFAULT_TOKEN_ID,
        ethers.parseEther("30000"),
        false, 1000, 0, 0, 0, 0, 0,
        ethers.parseEther("100"),
        ethers.parseEther("10000"),
        true, false, 2000, 86400
      );
      
      // Test restrictFulfillToBeneficiaryOrApprover
      await otc.setRestrictFulfill(true);
      
      const offerId1 = await otc.connect(buyer).createOfferFromConsignment.staticCall(
        consignmentId,
        ethers.parseEther("1000"),
        1000, 1, 0
      );
      
      await otc.connect(buyer).createOfferFromConsignment(
        consignmentId,
        ethers.parseEther("1000"),
        1000, 1, 0
      );
      
      await otc.connect(approver).approveOffer(offerId1);
      
      // Random user cannot fulfill
      await usdc.transfer(attacker.address, ethers.parseUnits("100000", 6));
      await usdc.connect(attacker).approve(otc.target, ethers.parseUnits("100000", 6));
      await expect(
        otc.connect(attacker).fulfillOffer(offerId1)
      ).to.be.revertedWith("fulfill restricted");
      
      // Beneficiary can fulfill
      const requiredUsdc = await otc.requiredUsdcAmount(offerId1);
      await usdc.connect(buyer).approve(otc.target, requiredUsdc);
      await otc.connect(buyer).fulfillOffer(offerId1);
      
      // Test requireApproverToFulfill
      await otc.setRequireApproverToFulfill(true);
      
      const offerId2 = await otc.connect(buyer).createOfferFromConsignment.staticCall(
        consignmentId,
        ethers.parseEther("1000"),
        1000, 1, 0
      );
      
      await otc.connect(buyer).createOfferFromConsignment(
        consignmentId,
        ethers.parseEther("1000"),
        1000, 1, 0
      );
      
      await otc.connect(approver).approveOffer(offerId2);
      
      // Beneficiary cannot fulfill
      await usdc.connect(buyer).approve(otc.target, requiredUsdc);
      await expect(
        otc.connect(buyer).fulfillOffer(offerId2)
      ).to.be.revertedWith("fulfill approver only");
      
      // Agent can fulfill
      await usdc.transfer(agent.address, requiredUsdc);
      await usdc.connect(agent).approve(otc.target, requiredUsdc);
      await otc.connect(agent).fulfillOffer(offerId2);
    });
  });

  describe("AutoClaim Batch Operations", function () {
    it("should handle autoClaim with mixed states", async function () {
      await defaultToken.connect(consigner).approve(otc.target, ethers.parseEther("100000"));
      const consignmentId = await otc.connect(consigner).createConsignment.staticCall(
        DEFAULT_TOKEN_ID,
        ethers.parseEther("100000"),
        true, 0, 0, 100, 2000, 0, 30,
        ethers.parseEther("10"),
        ethers.parseEther("1000"),
        true, false, 2000, 86400
      );
      
      await otc.connect(consigner).createConsignment(
        DEFAULT_TOKEN_ID,
        ethers.parseEther("100000"),
        true, 0, 0, 100, 2000, 0, 30,
        ethers.parseEther("10"),
        ethers.parseEther("1000"),
        true, false, 2000, 86400
      );
      
      const offerIds = [];
      
      // Create offers with different states
      for (let i = 0; i < 10; i++) {
        const offerId = await otc.connect(buyer).createOfferFromConsignment.staticCall(
          consignmentId,
          ethers.parseEther("100"),
          500, 1, 0
        );
        
        await otc.connect(buyer).createOfferFromConsignment(
          consignmentId,
          ethers.parseEther("100"),
          500, 1, 0
        );
        offerIds.push(offerId);
        
        if (i < 5) {
          // Approve and fulfill first 5
          await otc.connect(approver).approveOffer(offerId);
          const requiredUsdc = await otc.requiredUsdcAmount(offerId);
          await usdc.connect(buyer).approve(otc.target, requiredUsdc);
          await otc.connect(buyer).fulfillOffer(offerId);
        } else if (i < 7) {
          // Just approve next 2
          await otc.connect(approver).approveOffer(offerId);
        }
        // Leave last 3 unapproved
      }
      
      // Add invalid IDs
      offerIds.push(0); // Invalid
      offerIds.push(999999); // Non-existent
      
      // Batch size limit
      const tooManyIds = new Array(51).fill(offerIds[0]);
      await expect(
        otc.connect(approver).autoClaim(tooManyIds)
      ).to.be.revertedWith("batch too large");
      
      // Auto claim all
      await otc.connect(approver).autoClaim(offerIds);
      
      // Check states
      for (let i = 0; i < 5; i++) {
        const offer = await otc.offers(offerIds[i]);
        expect(offer.fulfilled).to.be.true; // Should be claimed
      }
      
      for (let i = 5; i < 10; i++) {
        const offer = await otc.offers(offerIds[i]);
        expect(offer.fulfilled).to.be.false; // Not paid, so not claimed
      }
    });
  });

  describe("Receive Function", function () {
    it("should accept ETH via receive function", async function () {
      const balanceBefore = await ethers.provider.getBalance(otc.target);
      await owner.sendTransaction({
        to: otc.target,
        value: ethers.parseEther("1")
      });
      const balanceAfter = await ethers.provider.getBalance(otc.target);
      expect(balanceAfter - balanceBefore).to.equal(ethers.parseEther("1"));
    });
  });
});


