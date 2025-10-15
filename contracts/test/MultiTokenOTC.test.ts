import { expect } from "chai";
import { ethers } from "hardhat";
import { OTC, MockERC20 } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("Multi-Token OTC", function () {
  let otc: OTC;
  let usdc: MockERC20;
  let tokenA: MockERC20;
  let tokenB: MockERC20;
  let owner: SignerWithAddress;
  let agent: SignerWithAddress;
  let consigner: SignerWithAddress;
  let buyer: SignerWithAddress;

  const tokenAId = ethers.keccak256(ethers.toUtf8Bytes("TOKEN_A"));
  const tokenBId = ethers.keccak256(ethers.toUtf8Bytes("TOKEN_B"));

  beforeEach(async function () {
    [owner, agent, consigner, buyer] = await ethers.getSigners();

    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    usdc = await MockERC20Factory.deploy("USDC", "USDC", 6, ethers.parseUnits("1000000", 6));
    tokenA = await MockERC20Factory.deploy("TokenA", "TKA", 18, ethers.parseEther("1000000"));
    tokenB = await MockERC20Factory.deploy("TokenB", "TKB", 18, ethers.parseEther("1000000"));

    const MockOracleFactory = await ethers.getContractFactory("MockAggregatorV3");
    const tokenAOracle = await MockOracleFactory.deploy(8, 100000000);
    const tokenBOracle = await MockOracleFactory.deploy(8, 200000000);
    const ethOracle = await MockOracleFactory.deploy(8, 250000000000);

    const defaultToken = await MockERC20Factory.deploy("ELIZA", "ELIZA", 18, ethers.parseEther("1000000"));
    const defaultOracle = await MockOracleFactory.deploy(8, 100000000);

    const OTCFactory = await ethers.getContractFactory("OTC");
    otc = await OTCFactory.deploy(
      owner.address,
      defaultToken.target,
      usdc.target,
      defaultOracle.target,
      ethOracle.target,
      agent.address
    );

    await otc.registerToken(tokenAId, tokenA.target, tokenAOracle.target);
    await otc.registerToken(tokenBId, tokenB.target, tokenBOracle.target);
  });

  describe("Token Registration", function () {
    it("should register a new token", async function () {
      const registered = await otc.tokens(tokenAId);
      expect(registered.tokenAddress).to.equal(tokenA.target);
      expect(registered.isActive).to.be.true;
    });

    it("should not allow duplicate registration", async function () {
      await expect(
        otc.registerToken(tokenAId, tokenA.target, ethers.ZeroAddress)
      ).to.be.revertedWith("token exists");
    });
  });

  describe("Consignment Creation", function () {
    beforeEach(async function () {
      await tokenA.transfer(consigner.address, ethers.parseEther("10000"));
      await tokenA.connect(consigner).approve(otc.target, ethers.parseEther("10000"));
    });

    it("should create negotiable consignment", async function () {
      await otc.connect(consigner).createConsignment(
        tokenAId,
        ethers.parseEther("10000"),
        true,
        0,
        0,
        500,
        2000,
        7,
        365,
        ethers.parseEther("100"),
        ethers.parseEther("5000"),
        true,
        false,
        1000,
        1800
      );

      const consignment = await otc.consignments(1);
      expect(consignment.consigner).to.equal(consigner.address);
      expect(consignment.totalAmount).to.equal(ethers.parseEther("10000"));
      expect(consignment.isNegotiable).to.be.true;
    });

    it("should create fixed-price consignment", async function () {
      await otc.connect(consigner).createConsignment(
        tokenAId,
        ethers.parseEther("5000"),
        false,
        1000,
        180,
        0,
        0,
        0,
        0,
        ethers.parseEther("100"),
        ethers.parseEther("5000"),
        false,
        false,
        500,
        1800
      );

      const consignment = await otc.consignments(1);
      expect(consignment.isNegotiable).to.be.false;
      expect(consignment.fixedDiscountBps).to.equal(1000);
    });
  });

  describe("Offer Creation from Consignment", function () {
    beforeEach(async function () {
      await tokenA.transfer(consigner.address, ethers.parseEther("10000"));
      await tokenA.connect(consigner).approve(otc.target, ethers.parseEther("10000"));
      
      await otc.connect(consigner).createConsignment(
        tokenAId,
        ethers.parseEther("10000"),
        true,
        0,
        0,
        500,
        2000,
        7,
        365,
        ethers.parseEther("100"),
        ethers.parseEther("5000"),
        true,
        false,
        1000,
        1800
      );
    });

    it("should create offer within consignment limits", async function () {
      await otc.connect(buyer).createOfferFromConsignment(
        1,
        ethers.parseEther("1000"),
        1000,
        0,
        30 * 24 * 60 * 60
      );

      const offer = await otc.offers(1);
      expect(offer.beneficiary).to.equal(buyer.address);
      expect(offer.tokenAmount).to.equal(ethers.parseEther("1000"));
      expect(offer.consignmentId).to.equal(1);
    });

    it("should reject offer outside discount range", async function () {
      await expect(
        otc.connect(buyer).createOfferFromConsignment(
          1,
          ethers.parseEther("1000"),
          3000,
          0,
          30 * 24 * 60 * 60
        )
      ).to.be.revertedWith("discount out of range");
    });

    it("should update consignment remaining amount", async function () {
      await otc.connect(buyer).createOfferFromConsignment(
        1,
        ethers.parseEther("1000"),
        1000,
        0,
        30 * 24 * 60 * 60
      );

      const consignment = await otc.consignments(1);
      expect(consignment.remainingAmount).to.equal(ethers.parseEther("9000"));
    });
  });

  describe("Price Volatility Protection", function () {
    it("should reject fulfillment if price moved too much", async function () {
      await tokenA.transfer(consigner.address, ethers.parseEther("10000"));
      await tokenA.connect(consigner).approve(otc.target, ethers.parseEther("10000"));
      
      await otc.connect(consigner).createConsignment(
        tokenAId,
        ethers.parseEther("10000"),
        false,
        1000,
        30,
        0,
        0,
        0,
        0,
        ethers.parseEther("100"),
        ethers.parseEther("5000"),
        false,
        false,
        500,
        1800
      );

      const offerId = await otc.connect(buyer).createOfferFromConsignment.staticCall(
        1,
        ethers.parseEther("1000"),
        1000,
        0,
        30 * 24 * 60 * 60
      );
      
      await otc.connect(buyer).createOfferFromConsignment(
        1,
        ethers.parseEther("1000"),
        1000,
        0,
        30 * 24 * 60 * 60
      );

      await otc.connect(agent).approveOffer(offerId);
    });
  });
});

