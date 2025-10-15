import { expect } from "chai";
import { ethers } from "hardhat";
import { OTC, MockERC20, MockAggregatorV3 } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("OTC Refactored Tests - Using Consignment System", function () {
  let otc: OTC;
  let defaultToken: MockERC20;
  let usdc: MockERC20;
  let tokenOracle: MockAggregatorV3;
  let ethOracle: MockAggregatorV3;
  let owner: SignerWithAddress;
  let agent: SignerWithAddress;
  let approver: SignerWithAddress;
  let consigner: SignerWithAddress;
  let buyer: SignerWithAddress;

  // Create a tokenId for the default token (legacy support)
  const DEFAULT_TOKEN_ID = ethers.keccak256(ethers.toUtf8Bytes("DEFAULT_TOKEN"));

  async function createConsignmentAndOffer(
    tokenId: string,
    consignmentAmount: bigint,
    offerAmount: bigint,
    discount: number = 1000,
    currency: number = 1, // 0=ETH, 1=USDC
    lockupDays: number = 0
  ) {
    // Register token if not already registered
    const registeredToken = await otc.tokens(tokenId);
    if (registeredToken.tokenAddress === ethers.ZeroAddress) {
      await otc.registerToken(tokenId, defaultToken.target, tokenOracle.target);
    }

    // Approve and create consignment
    await defaultToken.connect(consigner).approve(otc.target, consignmentAmount);
    
    const consignmentId = await otc.connect(consigner).createConsignment.staticCall(
      tokenId,
      consignmentAmount,
      false, // not negotiable
      discount, // fixed discount
      lockupDays, // fixed lockup
      0, 0, 0, 0, // no ranges
      offerAmount / 2n, // min deal
      consignmentAmount, // max deal
      true, // fractionalized
      false, // not private
      2000, // 20% max volatility
      86400 // 1 day to execute
    );

    await otc.connect(consigner).createConsignment(
      tokenId,
      consignmentAmount,
      false, discount, lockupDays, 0, 0, 0, 0,
      offerAmount / 2n, consignmentAmount,
      true, false, 2000, 86400
    );

    // Create offer from consignment
    const offerId = await otc.connect(buyer).createOfferFromConsignment.staticCall(
      consignmentId,
      offerAmount,
      discount,
      currency,
      lockupDays * 86400
    );

    await otc.connect(buyer).createOfferFromConsignment(
      consignmentId,
      offerAmount,
      discount,
      currency,
      lockupDays * 86400
    );

    return { consignmentId, offerId };
  }

  beforeEach(async function () {
    [owner, agent, approver, consigner, buyer] = await ethers.getSigners();

    // Deploy tokens
    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    defaultToken = await MockERC20Factory.deploy("ELIZA", "ELIZA", 18, ethers.parseEther("10000000"));
    usdc = await MockERC20Factory.deploy("USDC", "USDC", 6, ethers.parseUnits("10000000", 6));

    // Deploy oracles
    const MockOracleFactory = await ethers.getContractFactory("MockAggregatorV3");
    tokenOracle = await MockOracleFactory.deploy(8, 10_000_000); // $0.10
    ethOracle = await MockOracleFactory.deploy(8, 2500_00_000_000); // $2500

    // Deploy OTC
    const OTCFactory = await ethers.getContractFactory("OTC");
    otc = await OTCFactory.deploy(
      owner.address,
      defaultToken.target,
      usdc.target,
      tokenOracle.target,
      ethOracle.target,
      agent.address
    );

    // Setup
    await otc.setApprover(approver.address, true);
    
    // Fund accounts
    await defaultToken.transfer(consigner.address, ethers.parseEther("1000000"));
    await defaultToken.transfer(buyer.address, ethers.parseEther("100000"));
    await usdc.transfer(buyer.address, ethers.parseUnits("1000000", 6));
  });

  describe("Basic Flow Tests", function () {
    it("should create offer, approve, fulfill with USDC, and claim", async function () {
      const { offerId } = await createConsignmentAndOffer(
        DEFAULT_TOKEN_ID,
        ethers.parseEther("10000"),
        ethers.parseEther("1000"),
        1000, // 10% discount
        1, // USDC
        0 // no lockup
      );

      // Approve
      await otc.connect(approver).approveOffer(offerId);

      // Fulfill with USDC
      const requiredUsdc = await otc.requiredUsdcAmount(offerId);
      await usdc.connect(buyer).approve(otc.target, requiredUsdc);
      await otc.connect(buyer).fulfillOffer(offerId);

      // Claim immediately (no lockup)
      await otc.connect(buyer).claim(offerId);

      const offer = await otc.offers(offerId);
      expect(offer.fulfilled).to.be.true;
    });

    it("should enforce minimum $5 USD requirement", async function () {
      // Try to create offer below minimum
      const registeredToken = await otc.tokens(DEFAULT_TOKEN_ID);
      if (registeredToken.tokenAddress === ethers.ZeroAddress) {
        const registeredToken = await otc.tokens(DEFAULT_TOKEN_ID);
      if (registeredToken.tokenAddress === ethers.ZeroAddress) {
        await otc.registerToken(DEFAULT_TOKEN_ID, defaultToken.target, tokenOracle.target);
      }
      }
      await defaultToken.connect(consigner).approve(otc.target, ethers.parseEther("100"));
      
      const consignmentId = await otc.connect(consigner).createConsignment.staticCall(
        DEFAULT_TOKEN_ID,
        ethers.parseEther("100"),
        false, 1000, 0, 0, 0, 0, 0,
        ethers.parseEther("1"), // min deal $0.10 (too low)
        ethers.parseEther("100"),
        true, false, 2000, 86400
      );

      await otc.connect(consigner).createConsignment(
        DEFAULT_TOKEN_ID,
        ethers.parseEther("100"),
        false, 1000, 0, 0, 0, 0, 0,
        ethers.parseEther("1"),
        ethers.parseEther("100"),
        true, false, 2000, 86400
      );

      // Try to create offer below $5
      await expect(
        otc.connect(buyer).createOfferFromConsignment(
          consignmentId,
          ethers.parseEther("10"), // $1 at $0.10/token
          1000, 1, 0
        )
      ).to.be.revertedWith("min usd not met");

      // Should work with enough tokens
      await otc.connect(buyer).createOfferFromConsignment(
        consignmentId,
        ethers.parseEther("60"), // $6 at $0.10/token with 10% discount = $5.40
        1000, 1, 0
      );
    });

    it("should allow user to cancel after expiry, approver anytime", async function () {
      const { offerId } = await createConsignmentAndOffer(
        DEFAULT_TOKEN_ID,
        ethers.parseEther("10000"),
        ethers.parseEther("1000"),
        1000, 1, 0
      );

      // User cannot cancel before expiry
      await expect(
        otc.connect(buyer).cancelOffer(offerId)
      ).to.be.revertedWith("not expired");

      // Approver can cancel anytime
      await otc.connect(approver).cancelOffer(offerId);

      // Verify cancelled
      const offer = await otc.offers(offerId);
      expect(offer.cancelled).to.be.true;
    });

    it("should allow zero lockup for immediate claim", async function () {
      const { offerId } = await createConsignmentAndOffer(
        DEFAULT_TOKEN_ID,
        ethers.parseEther("10000"),
        ethers.parseEther("1000"),
        1000, 1, 0 // zero lockup
      );

      await otc.connect(approver).approveOffer(offerId);
      
      const requiredUsdc = await otc.requiredUsdcAmount(offerId);
      await usdc.connect(buyer).approve(otc.target, requiredUsdc);
      await otc.connect(buyer).fulfillOffer(offerId);

      // Should be able to claim immediately
      await otc.connect(buyer).claim(offerId);
      
      const offer = await otc.offers(offerId);
      expect(offer.fulfilled).to.be.true;
    });

    it("should enforce lockup period", async function () {
      const { offerId } = await createConsignmentAndOffer(
        DEFAULT_TOKEN_ID,
        ethers.parseEther("10000"),
        ethers.parseEther("1000"),
        1000, 1, 30 // 30 day lockup
      );

      await otc.connect(approver).approveOffer(offerId);
      
      const requiredUsdc = await otc.requiredUsdcAmount(offerId);
      await usdc.connect(buyer).approve(otc.target, requiredUsdc);
      await otc.connect(buyer).fulfillOffer(offerId);

      // Should not be able to claim before lockup
      await expect(
        otc.connect(buyer).claim(offerId)
      ).to.be.revertedWith("locked");

      // Fast forward past lockup
      await time.increase(86400 * 31);

      // Now should be able to claim
      await otc.connect(buyer).claim(offerId);
      
      const offer = await otc.offers(offerId);
      expect(offer.fulfilled).to.be.true;
    });

    it("should handle ETH payments", async function () {
      const { offerId } = await createConsignmentAndOffer(
        DEFAULT_TOKEN_ID,
        ethers.parseEther("10000"),
        ethers.parseEther("1000"),
        1000, 
        0, // ETH payment
        0
      );

      await otc.connect(approver).approveOffer(offerId);
      
      const requiredEth = await otc.requiredEthWei(offerId);
      await otc.connect(buyer).fulfillOffer(offerId, { value: requiredEth });

      await otc.connect(buyer).claim(offerId);
      
      const offer = await otc.offers(offerId);
      expect(offer.fulfilled).to.be.true;
    });
  });

  describe("Batch Operations", function () {
    it("should handle autoClaim for multiple offers", async function () {
      const offerIds = [];
      
      // Create multiple offers
      for (let i = 0; i < 5; i++) {
        const { offerId } = await createConsignmentAndOffer(
          DEFAULT_TOKEN_ID,
          ethers.parseEther("10000"),
          ethers.parseEther("100"),
          500, 1, 0 // no lockup for instant claim
        );
        offerIds.push(offerId);
        
        await otc.connect(approver).approveOffer(offerId);
        const requiredUsdc = await otc.requiredUsdcAmount(offerId);
        await usdc.connect(buyer).approve(otc.target, requiredUsdc);
        await otc.connect(buyer).fulfillOffer(offerId);
      }

      // Auto claim all
      await otc.connect(approver).autoClaim(offerIds);

      // Verify all claimed
      for (const id of offerIds) {
        const offer = await otc.offers(id);
        expect(offer.fulfilled).to.be.true;
      }
    });
  });

  describe("Price Feed Tests", function () {
    it("should reject stale price data", async function () {
      // Set stale price
      await tokenOracle.setRoundData(1, 2, 0, Math.floor(Date.now() / 1000) - 7200);

      const registeredToken = await otc.tokens(DEFAULT_TOKEN_ID);
      if (registeredToken.tokenAddress === ethers.ZeroAddress) {
        await otc.registerToken(DEFAULT_TOKEN_ID, defaultToken.target, tokenOracle.target);
      }
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

      // Should fail with stale price
      await expect(
        otc.connect(buyer).createOfferFromConsignment(
          consignmentId,
          ethers.parseEther("1000"),
          1000, 1, 0
        )
      ).to.be.revertedWith("stale price");
    });

    it("should round up USDC amounts", async function () {
      // Set a price that would result in fractional cents
      await tokenOracle.setAnswer(33_333); // $0.00033333

      const { offerId } = await createConsignmentAndOffer(
        DEFAULT_TOKEN_ID,
        ethers.parseEther("100000"),
        ethers.parseEther("20000"),
        1000, 1, 0
      );

      await otc.connect(approver).approveOffer(offerId);
      
      const requiredUsdc = await otc.requiredUsdcAmount(offerId);
      
      // Should be rounded up to nearest cent
      expect(requiredUsdc % 10000n).to.equal(0n);
    });
  });

  describe("Access Control", function () {
    it("should honor restrictFulfill settings", async function () {
      await otc.setRestrictFulfill(true);

      const { offerId } = await createConsignmentAndOffer(
        DEFAULT_TOKEN_ID,
        ethers.parseEther("10000"),
        ethers.parseEther("1000"),
        1000, 1, 0
      );

      await otc.connect(approver).approveOffer(offerId);

      // Buyer (beneficiary) should be able to fulfill
      const requiredUsdc = await otc.requiredUsdcAmount(offerId);
      await usdc.connect(buyer).approve(otc.target, requiredUsdc);
      await otc.connect(buyer).fulfillOffer(offerId);
    });

    it("should enforce approver-only fulfillment when enabled", async function () {
      await otc.setRequireApproverToFulfill(true);

      const { offerId } = await createConsignmentAndOffer(
        DEFAULT_TOKEN_ID,
        ethers.parseEther("10000"),
        ethers.parseEther("1000"),
        1000, 1, 0
      );

      await otc.connect(approver).approveOffer(offerId);

      // Buyer should not be able to fulfill
      const requiredUsdc = await otc.requiredUsdcAmount(offerId);
      await usdc.connect(buyer).approve(otc.target, requiredUsdc);
      await expect(
        otc.connect(buyer).fulfillOffer(offerId)
      ).to.be.revertedWith("fulfill approver only");

      // Approver should be able to fulfill
      await usdc.transfer(approver.address, requiredUsdc);
      await usdc.connect(approver).approve(otc.target, requiredUsdc);
      await otc.connect(approver).fulfillOffer(offerId);
    });
  });

  describe("View Functions", function () {
    it("should return open offer IDs", async function () {
      const initialCount = (await otc.getOpenOfferIds()).length;

      // Create some offers
      for (let i = 0; i < 3; i++) {
        await createConsignmentAndOffer(
          DEFAULT_TOKEN_ID,
          ethers.parseEther("10000"),
          ethers.parseEther("1000"),
          1000, 1, 0
        );
      }

      const openOffers = await otc.getOpenOfferIds();
      expect(openOffers.length).to.equal(initialCount + 3);
    });
  });

  describe("Emergency Recovery", function () {
    it("should handle emergency refunds when enabled", async function () {
      await otc.setEmergencyRefund(true);
      await otc.setEmergencyRefundDeadline(1); // 1 day for testing

      const { offerId } = await createConsignmentAndOffer(
        DEFAULT_TOKEN_ID,
        ethers.parseEther("10000"),
        ethers.parseEther("1000"),
        1000, 1, 30
      );

      await otc.connect(approver).approveOffer(offerId);
      
      const requiredUsdc = await otc.requiredUsdcAmount(offerId);
      await usdc.connect(buyer).approve(otc.target, requiredUsdc);
      await otc.connect(buyer).fulfillOffer(offerId);

      // Fast forward past emergency deadline
      await time.increase(86400 * 2);

      // Should be able to emergency refund
      const buyerBalanceBefore = await usdc.balanceOf(buyer.address);
      await otc.connect(buyer).emergencyRefund(offerId);
      const buyerBalanceAfter = await usdc.balanceOf(buyer.address);
      
      expect(buyerBalanceAfter).to.be.gt(buyerBalanceBefore);
    });
  });

  describe("Multi-Token Support", function () {
    it("should handle multiple token types", async function () {
      const tokenAId = ethers.keccak256(ethers.toUtf8Bytes("TOKEN_A"));
      const tokenBId = ethers.keccak256(ethers.toUtf8Bytes("TOKEN_B"));

      // Deploy additional tokens
      const MockERC20Factory = await ethers.getContractFactory("MockERC20");
      const tokenA = await MockERC20Factory.deploy("TokenA", "TKA", 18, ethers.parseEther("10000000"));
      const tokenB = await MockERC20Factory.deploy("TokenB", "TKB", 18, ethers.parseEther("10000000"));

      const MockOracleFactory = await ethers.getContractFactory("MockAggregatorV3");
      const tokenAOracle = await MockOracleFactory.deploy(8, 100_000_000); // $1
      const tokenBOracle = await MockOracleFactory.deploy(8, 500_000_000); // $5

      // Register tokens
      await otc.registerToken(tokenAId, tokenA.target, tokenAOracle.target);
      await otc.registerToken(tokenBId, tokenB.target, tokenBOracle.target);

      // Fund consigner
      await tokenA.transfer(consigner.address, ethers.parseEther("10000"));
      await tokenB.transfer(consigner.address, ethers.parseEther("10000"));

      // Create consignments for both tokens
      await tokenA.connect(consigner).approve(otc.target, ethers.parseEther("1000"));
      await otc.connect(consigner).createConsignment(
        tokenAId,
        ethers.parseEther("1000"),
        false, 1000, 0, 0, 0, 0, 0,
        ethers.parseEther("10"),
        ethers.parseEther("100"),
        true, false, 2000, 86400
      );

      await tokenB.connect(consigner).approve(otc.target, ethers.parseEther("100"));
      await otc.connect(consigner).createConsignment(
        tokenBId,
        ethers.parseEther("100"),
        false, 1000, 0, 0, 0, 0, 0,
        ethers.parseEther("1"),
        ethers.parseEther("10"),
        true, false, 2000, 86400
      );

      // Both consignments should be active
      const consignment1 = await otc.consignments(1);
      const consignment2 = await otc.consignments(2);
      expect(consignment1.isActive).to.be.true;
      expect(consignment2.isActive).to.be.true;
    });
  });

  describe("Consignment Management", function () {
    it("should allow withdrawal of active consignments", async function () {
      const registeredToken = await otc.tokens(DEFAULT_TOKEN_ID);
      if (registeredToken.tokenAddress === ethers.ZeroAddress) {
        await otc.registerToken(DEFAULT_TOKEN_ID, defaultToken.target, tokenOracle.target);
      }
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

      const balanceBefore = await defaultToken.balanceOf(consigner.address);
      await otc.connect(consigner).withdrawConsignment(consignmentId);
      const balanceAfter = await defaultToken.balanceOf(consigner.address);
      
      expect(balanceAfter - balanceBefore).to.equal(ethers.parseEther("10000"));

      // Should not be able to withdraw again
      await expect(
        otc.connect(consigner).withdrawConsignment(consignmentId)
      ).to.be.revertedWith("not active");
    });

    it("should handle negotiable consignments", async function () {
      const registeredToken = await otc.tokens(DEFAULT_TOKEN_ID);
      if (registeredToken.tokenAddress === ethers.ZeroAddress) {
        await otc.registerToken(DEFAULT_TOKEN_ID, defaultToken.target, tokenOracle.target);
      }
      await defaultToken.connect(consigner).approve(otc.target, ethers.parseEther("10000"));
      
      const consignmentId = await otc.connect(consigner).createConsignment.staticCall(
        DEFAULT_TOKEN_ID,
        ethers.parseEther("10000"),
        true, // negotiable
        0, 0, // no fixed values
        500, 2000, // 5-20% discount range
        0, 60, // 0-60 day lockup range
        ethers.parseEther("100"),
        ethers.parseEther("1000"),
        true, false, 2000, 86400
      );

      await otc.connect(consigner).createConsignment(
        DEFAULT_TOKEN_ID,
        ethers.parseEther("10000"),
        true, 0, 0, 500, 2000, 0, 60,
        ethers.parseEther("100"),
        ethers.parseEther("1000"),
        true, false, 2000, 86400
      );

      // Create offer within negotiable range
      await otc.connect(buyer).createOfferFromConsignment(
        consignmentId,
        ethers.parseEther("500"),
        1500, // 15% discount (within 5-20% range)
        1,
        86400 * 30 // 30 days (within 0-60 range)
      );

      // Try to create offer outside range (should fail)
      await expect(
        otc.connect(buyer).createOfferFromConsignment(
          consignmentId,
          ethers.parseEther("500"),
          2500, // 25% discount (outside range)
          1,
          86400 * 30
        )
      ).to.be.revertedWith("discount out of range");
    });
  });

  describe("Storage Cleanup", function () {
    it("should clean up expired offers", async function () {
      // Create many offers
      const offerIds = [];
      for (let i = 0; i < 10; i++) {
        const { offerId } = await createConsignmentAndOffer(
          DEFAULT_TOKEN_ID,
          ethers.parseEther("100000"),
          ethers.parseEther("100"),
          1000, 1, 0
        );
        offerIds.push(offerId);
      }

      // Cancel some
      for (let i = 0; i < 5; i++) {
        await otc.connect(approver).cancelOffer(offerIds[i]);
      }

      // Fast forward past expiry
      await time.increase(86400 * 2);

      // Cleanup
      await otc.cleanupExpiredOffers(10);

      // Open offers should be reduced
      const openOffers = await otc.getOpenOfferIds();
      expect(openOffers.length).to.be.lt(10);
    });
  });
});
