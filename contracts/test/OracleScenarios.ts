import { expect } from "chai";
import hre from "hardhat";

describe("Oracle Failure Scenarios", function () {
  async function deploy() {
    const [owner, user] = await hre.ethers.getSigners();

    const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
    const eliza = await MockERC20.deploy("elizaOS", "ELIZA", 18, hre.ethers.parseEther("1000000"));
    const usdc = await MockERC20.deploy("USD Coin", "USDC", 6, 1_000_000n * 10n ** 6n);

    const MockAgg = await hre.ethers.getContractFactory("MockAggregatorV3");
    const now = (await hre.ethers.provider.getBlock("latest")).timestamp;
    const tokenFeed = await MockAgg.deploy(8, 50_000n); // $0.0005 (8d)
    const ethFeed = await MockAgg.deploy(8, 3_500_00000000n); // $3500 (8d)
    await tokenFeed.setRoundData(1, 50_000, now, now);
    await ethFeed.setRoundData(1, 3_500_00000000, now, now);

    const OTC = await hre.ethers.getContractFactory("OTC");
    const otc = await OTC.deploy(
      owner.address,
      await eliza.getAddress(),
      await usdc.getAddress(),
      await tokenFeed.getAddress(),
      await ethFeed.getAddress(),
      owner.address
    );

    await eliza.approve(await otc.getAddress(), hre.ethers.parseEther("1000000"));
    await otc.depositTokens(hre.ethers.parseEther("1000000"));
    await otc.setLimits(5_00000000n, hre.ethers.parseEther("10000"), 30 * 60, 0);

    return { otc, eliza, usdc, tokenFeed, ethFeed, owner, user };
  }

  it("rejects stale oracle data", async function () {
    const { otc, tokenFeed, user } = await deploy();
    const now = (await hre.ethers.provider.getBlock("latest")).timestamp;
    await tokenFeed.setRoundData(1, 50_000, now - 7200, now - 7200);

    await expect(
      otc.connect(user).createOffer(hre.ethers.parseEther("1000"), 1000, 1, 7 * 24 * 60 * 60)
    ).to.be.revertedWith("stale price");
  });

  it("uses manual prices when enabled", async function () {
    const { otc, user } = await deploy();
    await otc.setManualPrices(1_000_000, 400_00000000, true); // $0.01 token, $4000 ETH

    const tx = await otc.connect(user).createOffer(hre.ethers.parseEther("1000"), 0, 1, 7 * 24 * 60 * 60);
    const receipt = await tx.wait();
    const event = receipt?.logs.find((log: any) => log.fragment?.name === "OfferCreated");
    const offerId = (event as any)?.args?.[0];
    const offer = await otc.offers(offerId);
    expect(offer.priceUsdPerToken).to.equal(1_000_000n);
  });

  it("rejects expired manual prices", async function () {
    const { otc, user } = await deploy();
    await otc.setManualPrices(100_000, 400_00000000, true);
    await hre.network.provider.send("evm_increaseTime", [7200]);
    await hre.network.provider.send("evm_mine");

    await expect(
      otc.connect(user).createOffer(hre.ethers.parseEther("1000"), 1000, 1, 7 * 24 * 60 * 60)
    ).to.be.revertedWith("manual price too old");
  });
});

