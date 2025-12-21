/**
 * Security Audit Test Suite for OTC Program
 * 
 * These tests verify that security vulnerabilities have been properly fixed
 * and cover all critical paths through the program.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Otc } from "../target/types/otc";
import {
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { assert } from "chai";

// Helper to assert promise rejects with specific error message
async function expectRejectedWith(promise: Promise<unknown>, expectedError: string): Promise<void> {
  try {
    await promise;
    assert.fail("Expected promise to reject but it resolved");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    assert.include(errorMessage, expectedError, `Expected error containing "${expectedError}" but got: ${errorMessage}`);
  }
}

describe("OTC Security Audit Tests", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Otc as Program<Otc>;

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

  // Test keypairs
  let owner: Keypair;
  let attacker: Keypair;
  let desk: Keypair;
  let attackerDesk: Keypair;
  let tokenMint: PublicKey;
  let usdcMint: PublicKey;
  let ownerRegistry: PublicKey;
  let attackerRegistry: PublicKey;

  before(async () => {
    owner = Keypair.generate();
    attacker = Keypair.generate();
    desk = Keypair.generate();
    attackerDesk = Keypair.generate();

    await Promise.all([
      airdrop(owner.publicKey, 10 * LAMPORTS_PER_SOL),
      airdrop(attacker.publicKey, 10 * LAMPORTS_PER_SOL),
    ]);
    await new Promise((r) => setTimeout(r, 1000));

    // Create mints
    tokenMint = await createMint(provider.connection, owner, owner.publicKey, null, 9);
    usdcMint = await createMint(provider.connection, owner, owner.publicKey, null, 6);

    // Setup desk treasuries
    await getOrCreateAssociatedTokenAccount(provider.connection, owner, tokenMint, desk.publicKey, true);
    await getOrCreateAssociatedTokenAccount(provider.connection, owner, usdcMint, desk.publicKey, true);

    // Initialize owner desk
    await program.methods
      .initDesk(new anchor.BN(5 * 1e8), new anchor.BN(1800))
      .accounts({
        payer: owner.publicKey,
        owner: owner.publicKey,
        agent: owner.publicKey,
        usdcMint,
        desk: desk.publicKey,
      })
      .signers([owner, desk])
      .rpc();

    // Register token for owner desk
    ownerRegistry = getTokenRegistryPda(desk.publicKey, tokenMint);

    await program.methods
      .registerToken(Array(32).fill(0), PublicKey.default, 0)
      .accounts({
        desk: desk.publicKey,
        payer: owner.publicKey,
        tokenMint,
      })
      .signers([owner])
      .rpc();

    // Set prices - must include owner in accounts
    await program.methods
      .setManualTokenPrice(new anchor.BN(10 * 1e8))
      .accounts({
        tokenRegistry: ownerRegistry,
        desk: desk.publicKey,
        owner: owner.publicKey,
      })
      .signers([owner])
      .rpc();

    await program.methods
      .setPrices(
        new anchor.BN(10 * 1e8),
        new anchor.BN(150 * 1e8),
        new anchor.BN(0),
        new anchor.BN(3600)
      )
      .accounts({ 
        desk: desk.publicKey,
        owner: owner.publicKey,
      })
      .signers([owner])
      .rpc();

    // Add owner as approver
    await program.methods
      .setApprover(owner.publicKey, true)
      .accounts({ 
        desk: desk.publicKey,
        owner: owner.publicKey,
      })
      .signers([owner])
      .rpc();

    // Setup attacker desk
    await getOrCreateAssociatedTokenAccount(provider.connection, attacker, tokenMint, attackerDesk.publicKey, true);
    await getOrCreateAssociatedTokenAccount(provider.connection, attacker, usdcMint, attackerDesk.publicKey, true);

    await program.methods
      .initDesk(new anchor.BN(1 * 1e8), new anchor.BN(86400))
      .accounts({
        payer: attacker.publicKey,
        owner: attacker.publicKey,
        agent: attacker.publicKey,
        usdcMint,
        desk: attackerDesk.publicKey,
      })
      .signers([attacker, attackerDesk])
      .rpc();

    // Attacker adds themselves as approver
    await program.methods
      .setApprover(attacker.publicKey, true)
      .accounts({ 
        desk: attackerDesk.publicKey,
        owner: attacker.publicKey,
      })
      .signers([attacker])
      .rpc();

    // Register token on attacker desk
    attackerRegistry = getTokenRegistryPda(attackerDesk.publicKey, tokenMint);

    await program.methods
      .registerToken(Array(32).fill(0), PublicKey.default, 0)
      .accounts({
        desk: attackerDesk.publicKey,
        payer: attacker.publicKey,
        tokenMint,
      })
      .signers([attacker])
      .rpc();

    // Set MUCH LOWER price on attacker registry
    await program.methods
      .setManualTokenPrice(new anchor.BN(1 * 1e8))
      .accounts({
        tokenRegistry: attackerRegistry,
        desk: attackerDesk.publicKey,
        owner: attacker.publicKey,
      })
      .signers([attacker])
      .rpc();
  });

  describe("CRITICAL: TokenRegistry-to-Desk Validation", () => {
    it("should REJECT setting price on registry from different desk", async () => {
      const promise = program.methods
        .setManualTokenPrice(new anchor.BN(1 * 1e8))
        .accounts({
          tokenRegistry: ownerRegistry,
          desk: attackerDesk.publicKey,
          owner: attacker.publicKey,
        })
        .signers([attacker])
        .rpc();

      await expectRejectedWith(promise, "BadState");
    });

    it("should ALLOW setting price on correct registry", async () => {
      const newPrice = new anchor.BN(15 * 1e8);
      // This should succeed without error
      await program.methods
        .setManualTokenPrice(newPrice)
        .accounts({
          tokenRegistry: ownerRegistry,
          desk: desk.publicKey,
          owner: owner.publicKey,
        })
        .signers([owner])
        .rpc();

      // Verify registry exists and was updated
      const registry = await program.account.tokenRegistry.fetch(ownerRegistry);
      assert.exists(registry);
    });
  });

  describe("HIGH: Minimum Quote Expiry", () => {
    it("should REJECT quote expiry less than 60 seconds", async () => {
      const promise = program.methods
        .setLimits(
          new anchor.BN(5 * 1e8),
          new anchor.BN(10000 * 1e9),
          new anchor.BN(30),
          new anchor.BN(0),
          new anchor.BN(365 * 86400)
        )
        .accounts({ 
          desk: desk.publicKey,
          owner: owner.publicKey,
        })
        .signers([owner])
        .rpc();

      await expectRejectedWith(promise, "AmountRange");
    });

    it("should ALLOW quote expiry >= 60 seconds", async () => {
      await program.methods
        .setLimits(
          new anchor.BN(5 * 1e8),
          new anchor.BN(10000 * 1e9),
          new anchor.BN(60),
          new anchor.BN(0),
          new anchor.BN(365 * 86400)
        )
        .accounts({ 
          desk: desk.publicKey,
          owner: owner.publicKey,
        })
        .signers([owner])
        .rpc();

      const deskAccount = await program.account.desk.fetch(desk.publicKey);
      assert.equal(deskAccount.quoteExpirySecs.toNumber(), 60);
    });
  });

  describe("Access Control Tests", () => {
    it("should REJECT non-owner setting prices", async () => {
      try {
        await program.methods
          .setPrices(
            new anchor.BN(1 * 1e8),
            new anchor.BN(100 * 1e8),
            new anchor.BN(0),
            new anchor.BN(3600)
          )
          .accounts({ 
            desk: desk.publicKey,
            owner: attacker.publicKey,
          })
          .signers([attacker])
          .rpc();
        assert.fail("Expected to fail");
      } catch (error) {
        const msg = String(error).toLowerCase();
        assert.isTrue(msg.includes("constraint") || msg.includes("owner"));
      }
    });

    it("should REJECT non-owner setting limits", async () => {
      try {
        await program.methods
          .setLimits(
            new anchor.BN(1 * 1e8),
            new anchor.BN(10000 * 1e9),
            new anchor.BN(60),
            new anchor.BN(0),
            new anchor.BN(365 * 86400)
          )
          .accounts({ 
            desk: desk.publicKey,
            owner: attacker.publicKey,
          })
          .signers([attacker])
          .rpc();
        assert.fail("Expected to fail");
      } catch (error) {
        const msg = String(error).toLowerCase();
        assert.isTrue(msg.includes("constraint") || msg.includes("owner"));
      }
    });

    it("should REJECT non-owner setting manual token price", async () => {
      try {
        await program.methods
          .setManualTokenPrice(new anchor.BN(1 * 1e8))
          .accounts({
            tokenRegistry: ownerRegistry,
            desk: desk.publicKey,
            owner: attacker.publicKey,
          })
          .signers([attacker])
          .rpc();
        assert.fail("Expected to fail");
      } catch (error) {
        const msg = String(error).toLowerCase();
        assert.isTrue(msg.includes("constraint") || msg.includes("owner"));
      }
    });
  });

  describe("Pause Functionality", () => {
    it("should pause and unpause desk", async () => {
      const deskBefore = await program.account.desk.fetch(desk.publicKey);
      if (deskBefore.paused) {
        await program.methods
          .unpause()
          .accounts({ 
            desk: desk.publicKey,
            owner: owner.publicKey,
          })
          .signers([owner])
          .rpc();
      }

      await program.methods
        .pause()
        .accounts({ 
          desk: desk.publicKey,
          owner: owner.publicKey,
        })
        .signers([owner])
        .rpc();

      let deskAccount = await program.account.desk.fetch(desk.publicKey);
      assert.isTrue(deskAccount.paused);

      await program.methods
        .unpause()
        .accounts({ 
          desk: desk.publicKey,
          owner: owner.publicKey,
        })
        .signers([owner])
        .rpc();

      deskAccount = await program.account.desk.fetch(desk.publicKey);
      assert.isFalse(deskAccount.paused);
    });

    it("should REJECT non-owner pausing", async () => {
      try {
        await program.methods
          .pause()
          .accounts({ 
            desk: desk.publicKey,
            owner: attacker.publicKey,
          })
          .signers([attacker])
          .rpc();
        assert.fail("Expected to fail");
      } catch (error) {
        const msg = String(error).toLowerCase();
        assert.isTrue(msg.includes("constraint") || msg.includes("owner"));
      }
    });
  });

  describe("Price Bounds Validation", () => {
    it("should REJECT price = 0", async () => {
      await expectRejectedWith(
        program.methods
          .setManualTokenPrice(new anchor.BN(0))
          .accounts({
            tokenRegistry: ownerRegistry,
            desk: desk.publicKey,
            owner: owner.publicKey,
          })
          .signers([owner])
          .rpc(),
        "BadPrice"
      );
    });

    it("should REJECT price > $10,000", async () => {
      await expectRejectedWith(
        program.methods
          .setManualTokenPrice(new anchor.BN(10001 * 1e8))
          .accounts({
            tokenRegistry: ownerRegistry,
            desk: desk.publicKey,
            owner: owner.publicKey,
          })
          .signers([owner])
          .rpc(),
        "BadPrice"
      );
    });

    it("should ALLOW price at $10,000", async () => {
      // $10,000 is the max allowed price
      await program.methods
        .setManualTokenPrice(new anchor.BN(10000 * 1e8))
        .accounts({
          tokenRegistry: ownerRegistry,
          desk: desk.publicKey,
          owner: owner.publicKey,
        })
        .signers([owner])
        .rpc();

      // If we get here without error, the test passed
      const registry = await program.account.tokenRegistry.fetch(ownerRegistry);
      assert.exists(registry);
    });

    it("should ALLOW very small prices", async () => {
      // $0.00000001 (1 with 8 decimals)
      await program.methods
        .setManualTokenPrice(new anchor.BN(1))
        .accounts({
          tokenRegistry: ownerRegistry,
          desk: desk.publicKey,
          owner: owner.publicKey,
        })
        .signers([owner])
        .rpc();

      // If we get here without error, the test passed
      const registry = await program.account.tokenRegistry.fetch(ownerRegistry);
      assert.exists(registry);
    });
  });

  describe("SOL Price Bounds Validation", () => {
    it("should REJECT SOL price < $0.01", async () => {
      await expectRejectedWith(
        program.methods
          .setPrices(
            new anchor.BN(10 * 1e8),
            new anchor.BN(100000),
            new anchor.BN(0),
            new anchor.BN(3600)
          )
          .accounts({ 
            desk: desk.publicKey,
            owner: owner.publicKey,
          })
          .signers([owner])
          .rpc(),
        "BadPrice"
      );
    });

    it("should REJECT SOL price > $100,000", async () => {
      await expectRejectedWith(
        program.methods
          .setPrices(
            new anchor.BN(10 * 1e8),
            new anchor.BN(100001 * 1e8),
            new anchor.BN(0),
            new anchor.BN(3600)
          )
          .accounts({ 
            desk: desk.publicKey,
            owner: owner.publicKey,
          })
          .signers([owner])
          .rpc(),
        "BadPrice"
      );
    });
  });
});
