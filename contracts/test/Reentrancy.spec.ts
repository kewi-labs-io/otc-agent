import { expect } from "chai";
import hre from "hardhat";

describe("Reentrancy defenses", () => {
  it("refund path cannot reenter cancelOffer", async () => {
    const [owner, agent, user, approver, attackerEOA] = await hre.ethers.getSigners();

    const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
    const token = await MockERC20.deploy("ElizaOS", "ELIZA", 18, hre.ethers.parseEther("1000000"));
    const usdc = await MockERC20.deploy("USD Coin", "USDC", 6, 1_000_000n * 10n ** 6n);

    const MockAgg = await hre.ethers.getContractFactory("MockAggregatorV3");
    const tokenFeed = await MockAgg.deploy(8, 1_000_000n); // $0.01 (8d)
    const ethFeed = await MockAgg.deploy(8, 3_000_00000000n); // $3000 (8d)

    const Desk = await hre.ethers.getContractFactory("OTC");
    const desk = await Desk.deploy(
      owner.address,
      await token.getAddress(),
      await usdc.getAddress(),
      await tokenFeed.getAddress(),
      await ethFeed.getAddress(),
      agent.address
    );

    await token.approve(await desk.getAddress(), hre.ethers.parseEther("1000000"));
    await desk.depositTokens(hre.ethers.parseEther("1000000"));
    await desk.setApprover(approver.address, true);

    const Attacker = await hre.ethers.getContractFactory("ReentrantAttacker");
    const attacker = await Attacker.deploy(await desk.getAddress());

    // Attacker creates ETH offer
    const createTx = await attacker.connect(attackerEOA).makeOffer(hre.ethers.parseEther("1000"));
    await createTx.wait();
    const [offerId] = await desk.getOpenOfferIds();

    // Approver approves
    await desk.connect(approver).approveOffer(offerId);

    // Compute required eth and send excess to trigger refund
    const required = await desk.requiredEthWei(offerId);
    const extra = hre.ethers.parseEther("0.5");

    await expect(
      attacker.connect(attackerEOA).payWithExcess(offerId, required, extra, { value: required + extra })
    ).to.not.be.reverted;

    // Offer should be marked paid and not cancelled
    const offer = await desk.offers(offerId);
    expect(offer.paid).to.be.true;
    expect(offer.cancelled).to.be.false;
  });
});


