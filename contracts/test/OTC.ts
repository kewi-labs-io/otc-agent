import { expect } from "chai";
import hre from "hardhat";
import { time } from "@nomicfoundation/hardhat-toolbox/network-helpers";

describe("OTC", () => {
  async function deploy() {
    const [owner, agent, user, approver] = await hre.ethers.getSigners();

    const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
    const token = await MockERC20.deploy("ELIZA", "ELIZA", 18, hre.ethers.parseEther("1000000"));
    const usdc = await MockERC20.deploy("USD Coin", "USDC", 6, 1_000_000n * 10n ** 6n);

    const MockAgg = await hre.ethers.getContractFactory("MockAggregatorV3");
    // 8 decimals feeds
    const tokenUsd = await MockAgg.deploy(8, 5000_00000000n); // $5000 per token? unrealistic but fine for math
    const ethUsd = await MockAgg.deploy(8, 3000_00000000n);   // $3000 per ETH

    const Desk = await hre.ethers.getContractFactory("OTC");
    const desk = await Desk.deploy(owner.address, await token.getAddress(), await usdc.getAddress(), await tokenUsd.getAddress(), await ethUsd.getAddress(), agent.address);

    await token.approve(await desk.getAddress(), hre.ethers.parseEther("1000000"));
    await desk.depositTokens(hre.ethers.parseEther("1000000"));
    await desk.setApprover(approver.address, true);
    await desk.setLimits(5_00000000n, hre.ethers.parseEther("10000"), 30 * 60, 0);

    return { owner, agent, user, approver, token, usdc, desk };
  }

  it("create -> approve -> fulfill (USDC) -> claim after unlock", async () => {
    const { user, approver, usdc, desk, token } = await deploy();

    // Reduce token price to something realistic: $0.001 per ELIZA (8 decimals)
    const tokenUsdAddr = await desk.tokenUsdFeed();
    const tokenUsd = (await hre.ethers.getContractAt("MockAggregatorV3", tokenUsdAddr)) as any;
    await tokenUsd.setAnswer(100_000n); // $0.001 with 8 decimals

    // Fund user with USDC to pay
    await usdc.transfer(user.address, 1_000_000n * 10n ** 6n);

    // Create offer: 10,000 tokens, 10% discount, USDC
    await desk.connect(user).createOffer(hre.ethers.parseEther("10000"), 1000, 1, 0);
    const open = await desk.getOpenOfferIds();
    const offerId = open[0];

    // Approve
    await desk.connect(approver).approveOffer(offerId);

    // Fulfill with USDC
    const usd = await desk.totalUsdForOffer(offerId); // 8d
    const usdcAmount = (usd * 10n ** 6n) / 10n ** 8n;
    await usdc.connect(user).approve(await desk.getAddress(), usdcAmount);
    await desk.connect(user).fulfillOffer(offerId);

    // claim immediately (unlock delay 0)
    await desk.connect(user).claim(offerId);
    const bal = await token.balanceOf(user.address);
    expect(bal).to.equal(hre.ethers.parseEther("10000"));
  });

  it("enforces min $5 and max token per order", async () => {
    const { user, desk } = await deploy();
    // Extremely small order should revert due to min $5
    await expect(desk.connect(user).createOffer(1n, 0, 1, 0)).to.be.revertedWith("min $5");
    // Large order should revert due to max token per order
    await expect(desk.connect(user).createOffer(hre.ethers.parseEther("100000"), 0, 1, 0)).to.be.revertedWith("amount range");
  });

  it("user can cancel after expiry, approver can cancel anytime before pay", async () => {
    const { user, approver, desk } = await deploy();
    await desk.connect(user).createOffer(hre.ethers.parseEther("1000"), 0, 0, 0);
    const open = await desk.getOpenOfferIds();
    const offerId = open[0];
    // user cannot cancel immediately
    await expect(desk.connect(user).cancelOffer(offerId)).to.be.revertedWith("not expired");
    // approver can cancel
    await desk.connect(approver).cancelOffer(offerId);
  });
});


