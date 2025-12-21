import type { Program } from "@coral-xyz/anchor";
import pkg from "@coral-xyz/anchor";
import { createMint, getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { assert } from "chai";
import type { Otc } from "../target/types/otc";

const { AnchorProvider, setProvider, workspace, BN } = pkg as typeof import("@coral-xyz/anchor");

async function expectRejectedWith(promise: Promise<unknown>, expectedError: string): Promise<void> {
  try {
    await promise;
    assert.fail("Expected promise to reject but it resolved");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    assert.include(errorMessage, expectedError, `Expected "${expectedError}" but got: ${errorMessage}`);
  }
}

describe("otc adversarial", () => {
  const provider = AnchorProvider.env();
  setProvider(provider);
  const program = workspace.Otc as Program<Otc>;

  const airdrop = async (pk: PublicKey, lamports: number) => {
    const sig = await provider.connection.requestAirdrop(pk, lamports);
    await provider.connection.confirmTransaction(sig, "confirmed");
  };

  const getTokenRegistryPda = (desk: PublicKey, tokenMint: PublicKey) => {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("registry"), desk.toBuffer(), tokenMint.toBuffer()],
      program.programId
    )[0];
  };

  let owner: Keypair;
  let attacker: Keypair;
  let tokenMint: PublicKey;
  let usdcMint: PublicKey;
  let desk: Keypair;
  let attackerDesk: Keypair;
  let tokenRegistry: PublicKey;
  let attackerRegistry: PublicKey;

  beforeEach(async () => {
    owner = Keypair.generate();
    attacker = Keypair.generate();
    desk = Keypair.generate();
    attackerDesk = Keypair.generate();

    await Promise.all([
      airdrop(owner.publicKey, 2 * LAMPORTS_PER_SOL),
      airdrop(attacker.publicKey, 2 * LAMPORTS_PER_SOL),
    ]);
    await new Promise(r => setTimeout(r, 500));

    tokenMint = await createMint(provider.connection, owner, owner.publicKey, null, 9);
    usdcMint = await createMint(provider.connection, owner, owner.publicKey, null, 6);

    tokenRegistry = getTokenRegistryPda(desk.publicKey, tokenMint);

    await getOrCreateAssociatedTokenAccount(provider.connection, owner, tokenMint, desk.publicKey, true);
    await getOrCreateAssociatedTokenAccount(provider.connection, owner, usdcMint, desk.publicKey, true);

    await program.methods
      .initDesk(new BN(500000000), new BN(1800))
      .accounts({ owner: owner.publicKey, agent: owner.publicKey, usdcMint, desk: desk.publicKey, payer: owner.publicKey })
      .signers([owner, desk])
      .rpc();

    await program.methods
      .registerToken(new Array(32).fill(0), tokenMint, 0)
      .accounts({ desk: desk.publicKey, payer: owner.publicKey, tokenMint })
      .signers([owner])
      .rpc();

    await program.methods
      .setManualTokenPrice(new BN(1_000_000_000))
      .accounts({ tokenRegistry, desk: desk.publicKey, owner: owner.publicKey })
      .signers([owner])
      .rpc();

    await program.methods.setPrices(new BN(1_000_000_000), new BN(100_000_000_00), new BN(0), new BN(3600))
      .accounts({ desk: desk.publicKey, owner: owner.publicKey })
      .signers([owner])
      .rpc();

    await getOrCreateAssociatedTokenAccount(provider.connection, attacker, tokenMint, attackerDesk.publicKey, true);
    await getOrCreateAssociatedTokenAccount(provider.connection, attacker, usdcMint, attackerDesk.publicKey, true);

    await program.methods
      .initDesk(new BN(100000000), new BN(1800))
      .accounts({ owner: attacker.publicKey, agent: attacker.publicKey, usdcMint, desk: attackerDesk.publicKey, payer: attacker.publicKey })
      .signers([attacker, attackerDesk])
      .rpc();

    attackerRegistry = getTokenRegistryPda(attackerDesk.publicKey, tokenMint);

    await program.methods
      .registerToken(new Array(32).fill(0), tokenMint, 0)
      .accounts({ desk: attackerDesk.publicKey, payer: attacker.publicKey, tokenMint })
      .signers([attacker])
      .rpc();

    await program.methods
      .setManualTokenPrice(new BN(10_000_000))
      .accounts({ tokenRegistry: attackerRegistry, desk: attackerDesk.publicKey, owner: attacker.publicKey })
      .signers([attacker])
      .rpc();
  });

  it("prevents registry cross-desk price manipulation", async () => {
    await expectRejectedWith(
      program.methods
        .setManualTokenPrice(new BN(1))
        .accounts({
          tokenRegistry: tokenRegistry,
          desk: attackerDesk.publicKey,
          owner: attacker.publicKey,
        })
        .signers([attacker])
        .rpc(),
      "BadState"
    );
  });

  it("enforces desk ownership for treasury operations", async () => {
    // This should fail because attacker is not the owner of the desk
    try {
      await program.methods
        .withdrawSol(new BN(1000000))
        .accounts({
          desk: desk.publicKey,
          deskSigner: attackerDesk.publicKey,
          owner: attacker.publicKey,
          to: attacker.publicKey,
        })
        .signers([attacker, attackerDesk])
        .rpc();
      assert.fail("Expected to fail");
    } catch (error) {
      const msg = String(error).toLowerCase();
      assert.isTrue(
        msg.includes("constraint") || msg.includes("owner") || msg.includes("notowner"),
        `Expected ownership error but got: ${msg}`
      );
    }
  });

  it("prevents configuring oracle on wrong registry", async () => {
    await expectRejectedWith(
      program.methods
        .configurePoolOracle(
          new BN(10_000 * 1e6),
          500,
          new BN(60)
        )
        .accounts({
          tokenRegistry: tokenRegistry,
          desk: attackerDesk.publicKey,
          owner: attacker.publicKey,
        })
        .signers([attacker])
        .rpc(),
      "BadState"
    );
  });

  it("prevents non-owner from setting pyth feeds", async () => {
    const fakeFeed = new Array(32).fill(1);
    
    await expectRejectedWith(
      program.methods
        .setPythFeeds(fakeFeed, fakeFeed)
        .accounts({ desk: desk.publicKey, owner: attacker.publicKey })
        .signers([attacker])
        .rpc(),
      "Constraint"
    );
  });

  it("prevents non-owner from changing agent", async () => {
    await expectRejectedWith(
      program.methods
        .setAgent(attacker.publicKey)
        .accounts({ desk: desk.publicKey, owner: attacker.publicKey })
        .signers([attacker])
        .rpc(),
      "Constraint"
    );
  });

  it("prevents non-owner from setting restrict fulfill", async () => {
    await expectRejectedWith(
      program.methods
        .setRestrictFulfill(true)
        .accounts({ desk: desk.publicKey, owner: attacker.publicKey })
        .signers([attacker])
        .rpc(),
      "Constraint"
    );
  });

  it("validates approver count limit", async () => {
    for (let i = 0; i < 32; i++) {
      const approver = Keypair.generate();
      await program.methods
        .setApprover(approver.publicKey, true)
        .accounts({ desk: desk.publicKey, owner: owner.publicKey })
        .signers([owner])
        .rpc();
    }

    const extraApprover = Keypair.generate();
    await expectRejectedWith(
      program.methods
        .setApprover(extraApprover.publicKey, true)
        .accounts({ desk: desk.publicKey, owner: owner.publicKey })
        .signers([owner])
        .rpc(),
      "TooManyApprovers"
    );
  });
});
