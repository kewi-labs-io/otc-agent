import type { Program } from "@coral-xyz/anchor";
import pkg from "@coral-xyz/anchor";
import { createMint, getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount, mintTo, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { assert } from "chai";
import type { Otc } from "../target/types/otc";

// ESM/CJS compatibility
const { AnchorProvider, setProvider, workspace, BN } = pkg as typeof import("@coral-xyz/anchor");

// Helper to assert promise rejects
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
  let deskTokenTreasury: PublicKey;
  let deskUsdcTreasury: PublicKey;
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

    deskTokenTreasury = getAssociatedTokenAddressSync(tokenMint, desk.publicKey, true);
    deskUsdcTreasury = getAssociatedTokenAddressSync(usdcMint, desk.publicKey, true);
    tokenRegistry = getTokenRegistryPda(desk.publicKey, tokenMint);

    await getOrCreateAssociatedTokenAccount(provider.connection, owner, tokenMint, desk.publicKey, true);
    await getOrCreateAssociatedTokenAccount(provider.connection, owner, usdcMint, desk.publicKey, true);

    // Initialize desk
    await program.methods
      .initDesk(new BN(500000000), new BN(1800))
      .accounts({ owner: owner.publicKey, agent: owner.publicKey, usdcMint, desk: desk.publicKey, payer: owner.publicKey })
      .signers([owner, desk])
      .rpc();

    // Register the token with desk
    await program.methods
      .registerToken(new Array(32).fill(0), tokenMint, 0)
      .accounts({ desk: desk.publicKey, payer: owner.publicKey, tokenMint })
      .signers([owner])
      .rpc();

    // Set token price
    await program.methods
      .setManualTokenPrice(new BN(1_000_000_000))
      .accounts({ tokenRegistry, desk: desk.publicKey, owner: owner.publicKey })
      .signers([owner])
      .rpc();

    // Set desk prices
    await program.methods.setPrices(new BN(1_000_000_000), new BN(100_000_000_00), new BN(0), new BN(3600))
      .accounts({ desk: desk.publicKey })
      .signers([owner])
      .rpc();

    // Setup attacker desk
    const attackerDeskTokenTreasury = getAssociatedTokenAddressSync(tokenMint, attackerDesk.publicKey, true);
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

    // Set MUCH LOWER price on attacker registry
    await program.methods
      .setManualTokenPrice(new BN(10_000_000)) // $0.10 instead of $10
      .accounts({ tokenRegistry: attackerRegistry, desk: attackerDesk.publicKey, owner: attacker.publicKey })
      .signers([attacker])
      .rpc();
  });

  it("prevents registry cross-desk price manipulation", async () => {
    // Attacker tries to use owner's registry with their own desk
    await expectRejectedWith(
      program.methods
        .setManualTokenPrice(new BN(1))
        .accounts({
          tokenRegistry: tokenRegistry, // Owner's registry
          desk: attackerDesk.publicKey, // Attacker's desk
          owner: attacker.publicKey,
        })
        .signers([attacker])
        .rpc(),
      "BadState"
    );
  });

  it("enforces desk ownership for treasury operations", async () => {
    // Attacker desk has no tokens, try to withdraw from owner's desk using attacker credentials
    await expectRejectedWith(
      program.methods
        .withdrawSol(new BN(1000000))
        .accounts({
          desk: desk.publicKey, // Owner's desk
          deskSigner: attackerDesk.publicKey, // Wrong signer
          owner: attacker.publicKey, // Wrong owner
          to: attacker.publicKey,
        })
        .signers([attacker, attackerDesk])
        .rpc(),
      "constraint" // or "owner" - depends on which check fails first
    );
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
          tokenRegistry: tokenRegistry, // Owner's registry
          desk: attackerDesk.publicKey, // Attacker's desk
          owner: attacker.publicKey,
        })
        .signers([attacker])
        .rpc(),
      "BadState"
    );
  });

  it("prevents non-owner from setting pyth feeds", async () => {
    const fakeFeed = new Array(32).fill(1);
    
    try {
      await program.methods
        .setPythFeeds(fakeFeed, fakeFeed)
        .accounts({ desk: desk.publicKey })
        .signers([attacker])
        .rpc();
      assert.fail("Expected to fail");
    } catch (error) {
      const msg = String(error).toLowerCase();
      assert.isTrue(msg.includes("constraint") || msg.includes("signer"));
    }
  });

  it("prevents non-owner from changing agent", async () => {
    try {
      await program.methods
        .setAgent(attacker.publicKey)
        .accounts({ desk: desk.publicKey })
        .signers([attacker])
        .rpc();
      assert.fail("Expected to fail");
    } catch (error) {
      const msg = String(error).toLowerCase();
      assert.isTrue(msg.includes("constraint") || msg.includes("signer"));
    }
  });

  it("prevents non-owner from setting restrict fulfill", async () => {
    try {
      await program.methods
        .setRestrictFulfill(true)
        .accounts({ desk: desk.publicKey })
        .signers([attacker])
        .rpc();
      assert.fail("Expected to fail");
    } catch (error) {
      const msg = String(error).toLowerCase();
      assert.isTrue(msg.includes("constraint") || msg.includes("signer"));
    }
  });

  it("validates approver count limit", async () => {
    // Try to add more than 32 approvers
    for (let i = 0; i < 32; i++) {
      const approver = Keypair.generate();
      await program.methods
        .setApprover(approver.publicKey, true)
        .accounts({ desk: desk.publicKey })
        .signers([owner])
        .rpc();
    }

    // 33rd approver should fail
    const extraApprover = Keypair.generate();
    await expectRejectedWith(
      program.methods
        .setApprover(extraApprover.publicKey, true)
        .accounts({ desk: desk.publicKey })
        .signers([owner])
        .rpc(),
      "TooManyApprovers"
    );
  });
});
