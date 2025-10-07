import { expect } from "chai";
import { ethers } from "hardhat";
import type { OTC, MockERC20, MockAggregatorV3 } from "../typechain-types";

describe("Multi-Approver", function () {
  let otc: OTC;
  let usdc: MockERC20;
  let tokenFeed: MockAggregatorV3;
  let ethFeed: MockAggregatorV3;

  before(async function () {
    const [owner] = await ethers.getSigners();
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const token = await MockERC20.deploy("elizaOS", "ELIZA", 18, ethers.parseEther("1000000"));
    usdc = await MockERC20.deploy("USD Coin", "USDC", 6, 1_000_000n * 10n ** 6n);

    const MockAgg = await ethers.getContractFactory("MockAggregatorV3");
    tokenFeed = await MockAgg.deploy(8, 2_000_000n); // $0.02
    ethFeed = await MockAgg.deploy(8, 3_500_00000000n);

    const OTC = await ethers.getContractFactory("OTC");
    otc = (await OTC.deploy(
      owner.address,
      await token.getAddress(),
      await usdc.getAddress(),
      await tokenFeed.getAddress(),
      await ethFeed.getAddress(),
      owner.address
    )) as any;

    await token.approve(await otc.getAddress(), ethers.parseEther("1000000"));
    await otc.depositTokens(ethers.parseEther("1000000"));
    // Ensure fresh feed timestamps
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await tokenFeed.setRoundData(1, 2_000_000, now, now);
    await ethFeed.setRoundData(1, 3_500_00000000, now, now);
  });

  it("should require 3 approvals when threshold is 3", async function () {
    const [owner, approver1, approver2, approver3, user] = await ethers.getSigners();

    // Setup 3 approvers (as owner)
    await otc.connect(owner).setApprover(approver1.address, true);
    await otc.connect(owner).setApprover(approver2.address, true);
    await otc.connect(owner).setApprover(approver3.address, true);

    // Set threshold (as owner)
    const setTx = await otc.connect(owner).setRequiredApprovals(3);
    await setTx.wait(); // Wait for transaction to be mined
    const required = await otc.requiredApprovals();
    expect(required).to.equal(3n);

    // Create offer
    const tx = await otc.connect(user).createOffer(
      ethers.parseEther("5000"),
      1000,
      1,
      30 * 24 * 60 * 60
    );
    const receipt = await tx.wait();
    const event = receipt?.logs.find((log: any) => log.fragment?.name === "OfferCreated");
    const offerId = (event as any)?.args?.[0];

    // Check initial state
    let offer = await otc.offers(offerId);
    let count = await otc.approvalCount(offerId);
    expect(offer.approved).to.be.false;
    expect(count).to.equal(0n);

    // Approval 1
    const approveTx1 = await otc.connect(approver1).approveOffer(offerId);
    await approveTx1.wait();
    offer = await otc.offers(offerId);
    count = await otc.approvalCount(offerId);
    expect(offer.approved).to.be.false;
    expect(count).to.equal(1n);

    // Approval 2
    const approveTx2 = await otc.connect(approver2).approveOffer(offerId);
    await approveTx2.wait();
    offer = await otc.offers(offerId);
    count = await otc.approvalCount(offerId);
    expect(offer.approved).to.be.false;
    expect(count).to.equal(2n);

    // Approval 3 - THRESHOLD REACHED
    const approveTx3 = await otc.connect(approver3).approveOffer(offerId);
    await approveTx3.wait();
    offer = await otc.offers(offerId);
    count = await otc.approvalCount(offerId);
    expect(offer.approved).to.be.true;
    expect(count).to.equal(3n);
  });

  it("should prevent double-approval", async function () {
    const [owner, approver1, user] = await ethers.getSigners();
    const setTx = await otc.connect(owner).setRequiredApprovals(2);
    await setTx.wait();

    const tx = await otc.connect(user).createOffer(
      ethers.parseEther("1000"),
      500,
      1,
      7 * 24 * 60 * 60
    );
    const receipt = await tx.wait();
    const event = receipt?.logs.find((log: any) => log.fragment?.name === "OfferCreated");
    const offerId = (event as any)?.args?.[0];

    const approveTx = await otc.connect(approver1).approveOffer(offerId);
    await approveTx.wait();

    await expect(
      otc.connect(approver1).approveOffer(offerId)
    ).to.be.revertedWith("already approved by you");

  });

  it("should work with threshold of 1 (backward compatible)", async function () {
    const [owner, approver1, user] = await ethers.getSigners();
    
    const setTx = await otc.connect(owner).setRequiredApprovals(1);
    await setTx.wait();

    const tx = await otc.connect(user).createOffer(
      ethers.parseEther("500"),
      300,
      1,
      7 * 24 * 60 * 60
    );
    const receipt = await tx.wait();
    const event = receipt?.logs.find((log: any) => log.fragment?.name === "OfferCreated");
    const offerId = (event as any)?.args?.[0];

    const approveTx = await otc.connect(approver1).approveOffer(offerId);
    await approveTx.wait();

    const offer = await otc.offers(offerId);
    expect(offer.approved).to.be.true;

  });
});
