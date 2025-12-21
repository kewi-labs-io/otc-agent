/**
 * Solana Utility Functions E2E Tests
 *
 * Tests Solana utility functions and PDA derivations.
 * Uses fail-fast patterns with strong typing.
 *
 * Run: bun test tests/solana-utils.e2e.test.ts
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { PublicKey, Connection } from "@solana/web3.js";
import { BASE_URL, expectDefined } from "./test-utils";

const TEST_TIMEOUT = 30_000;

// Flag to track if server is available
let serverAvailable = false;

/**
 * Wait for server to be ready with timeout
 */
async function waitForServer(maxWaitMs: number = 3000): Promise<boolean> {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    const res = await fetch(`${BASE_URL}/api/tokens`, {
      signal: AbortSignal.timeout(2000),
    }).catch(() => null);
    if (res && res.ok) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/**
 * Skip test if server is not available
 */
function skipIfNoServer(): boolean {
  if (!serverAvailable) {
    console.log("  (skipped: server not available)");
    return true;
  }
  return false;
}

// Well-known Solana addresses for testing
const WSOL_MINT = "So11111111111111111111111111111111111111112"; // Wrapped SOL (SPL Token)
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // USDC (SPL Token)
const SPL_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

describe("Solana Utility Functions", () => {
  beforeAll(async () => {
        if (skipIfNoServer()) return;
    serverAvailable = await waitForServer();
    if (!serverAvailable) {
      console.log("\n  Server not available - skipping Solana E2E tests.\n");
    }
  });

  // ==========================================================================
  // IDL Fetching Tests
  // ==========================================================================
  describe("IDL Fetching", () => {
    test(
      "GET /api/solana/idl returns valid IDL structure",
      async () => {
        if (skipIfNoServer()) return;
        const res = await fetch(`${BASE_URL}/api/solana/idl`);
        expect(res.ok).toBe(true);

        const idl = await res.json();

        // Verify IDL has required top-level fields
        expectDefined(idl.version, "version");
        expectDefined(idl.name, "name");
        expectDefined(idl.instructions, "instructions");
        expect(Array.isArray(idl.instructions)).toBe(true);

        // Verify key instructions exist
        const instructionNames = idl.instructions.map((i: { name: string }) => i.name);
        expect(instructionNames).toContain("createConsignment");
        expect(instructionNames).toContain("createOfferFromConsignment");
        expect(instructionNames).toContain("approveOffer");
        expect(instructionNames).toContain("fulfillOfferSol");
        expect(instructionNames).toContain("withdrawConsignment");
      },
      TEST_TIMEOUT,
    );

    test(
      "IDL contains account definitions",
      async () => {
        if (skipIfNoServer()) return;
        const res = await fetch(`${BASE_URL}/api/solana/idl`);
        const idl = await res.json();

        expectDefined(idl.accounts, "accounts");
        expect(Array.isArray(idl.accounts)).toBe(true);

        const accountNames = idl.accounts.map((a: { name: string }) => a.name);
        expect(accountNames).toContain("Desk");
        expect(accountNames).toContain("Consignment");
        expect(accountNames).toContain("Offer");
      },
      TEST_TIMEOUT,
    );
  });

  // ==========================================================================
  // PDA Derivation Tests
  // ==========================================================================
  describe("PDA Derivation", () => {
    test("TokenRegistry PDA derivation is deterministic", () => {
      const programId = new PublicKey("3uTdWzoAcBFKTVYRd2z2jDKAcuyW64rQLxa9wMreDJKo");
      const deskPk = new PublicKey("EDzQZXDT3iZcXxkp56vb7LLJ1tgaTn1gbf1CgWQuKXtY");
      const tokenMintPk = new PublicKey(WSOL_MINT);

      const [pda1] = PublicKey.findProgramAddressSync(
        [Buffer.from("registry"), deskPk.toBuffer(), tokenMintPk.toBuffer()],
        programId,
      );

      const [pda2] = PublicKey.findProgramAddressSync(
        [Buffer.from("registry"), deskPk.toBuffer(), tokenMintPk.toBuffer()],
        programId,
      );

      expect(pda1.toBase58()).toBe(pda2.toBase58());
    });

    test("Different inputs produce different PDAs", () => {
      const programId = new PublicKey("3uTdWzoAcBFKTVYRd2z2jDKAcuyW64rQLxa9wMreDJKo");
      const deskPk = new PublicKey("EDzQZXDT3iZcXxkp56vb7LLJ1tgaTn1gbf1CgWQuKXtY");

      const [pdaWsol] = PublicKey.findProgramAddressSync(
        [Buffer.from("registry"), deskPk.toBuffer(), new PublicKey(WSOL_MINT).toBuffer()],
        programId,
      );

      const [pdaUsdc] = PublicKey.findProgramAddressSync(
        [Buffer.from("registry"), deskPk.toBuffer(), new PublicKey(USDC_MINT).toBuffer()],
        programId,
      );

      expect(pdaWsol.toBase58()).not.toBe(pdaUsdc.toBase58());
    });

    test("Consignment PDA uses correct seed format", () => {
      const programId = new PublicKey("3uTdWzoAcBFKTVYRd2z2jDKAcuyW64rQLxa9wMreDJKo");
      const deskPk = new PublicKey("EDzQZXDT3iZcXxkp56vb7LLJ1tgaTn1gbf1CgWQuKXtY");
      const consignmentId = BigInt(0);

      const [pda, bump] = PublicKey.findProgramAddressSync(
        [Buffer.from("consignment"), deskPk.toBuffer(), Buffer.from(consignmentId.toString())],
        programId,
      );

      expectDefined(pda, "consignment PDA");
      expect(pda.toBase58().length).toBeGreaterThan(30);
      expect(bump).toBeGreaterThanOrEqual(0);
      expect(bump).toBeLessThanOrEqual(255);
    });

    test("Offer PDA uses correct seed format", () => {
      const programId = new PublicKey("3uTdWzoAcBFKTVYRd2z2jDKAcuyW64rQLxa9wMreDJKo");
      const deskPk = new PublicKey("EDzQZXDT3iZcXxkp56vb7LLJ1tgaTn1gbf1CgWQuKXtY");
      const offerId = BigInt(0);

      const [pda, bump] = PublicKey.findProgramAddressSync(
        [Buffer.from("offer"), deskPk.toBuffer(), Buffer.from(offerId.toString())],
        programId,
      );

      expectDefined(pda, "offer PDA");
      expect(pda.toBase58().length).toBeGreaterThan(30);
      expect(bump).toBeGreaterThanOrEqual(0);
      expect(bump).toBeLessThanOrEqual(255);
    });
  });

  // ==========================================================================
  // Address Format Validation Tests
  // ==========================================================================
  describe("Address Format Validation", () => {
    test("Solana Base58 addresses are 32-44 characters", () => {
      const validAddresses = [WSOL_MINT, USDC_MINT, SPL_TOKEN_PROGRAM, TOKEN_2022_PROGRAM];

      const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

      for (const addr of validAddresses) {
        expect(base58Regex.test(addr)).toBe(true);
      }
    });

    test("Invalid addresses fail regex", () => {
      const invalidAddresses = [
        "0x1234567890123456789012345678901234567890", // EVM address
        "invalid-address",
        "",
        "  ",
        "So1111111111111111111111111111111111111111O", // Contains O (not in Base58)
        "So1111111111111111111111111111111111111111l", // Contains l (not in Base58)
      ];

      const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

      for (const addr of invalidAddresses) {
        expect(base58Regex.test(addr)).toBe(false);
      }
    });
  });

  // ==========================================================================
  // Amount Calculation Tests
  // ==========================================================================
  describe("Amount Calculations", () => {
    test("Token amount conversion handles 9 decimals correctly", () => {
      const humanAmount = 100;
      const decimals = 9;
      const expected = BigInt(humanAmount) * BigInt(10 ** decimals);

      expect(expected).toBe(BigInt("100000000000"));
    });

    test("Token amount conversion handles 6 decimals correctly (USDC)", () => {
      const humanAmount = 100;
      const decimals = 6;
      const expected = BigInt(humanAmount) * BigInt(10 ** decimals);

      expect(expected).toBe(BigInt("100000000"));
    });

    test("Discount BPS calculation", () => {
      const discountPercent = 10; // 10%
      const discountBps = discountPercent * 100;

      expect(discountBps).toBe(1000);
    });

    test("Lockup days to seconds conversion", () => {
      const lockupDays = 365;
      const lockupSeconds = lockupDays * 24 * 60 * 60;

      expect(lockupSeconds).toBe(31536000);
    });

    test("Price with 8 decimals representation", () => {
      // $0.00340902 with 8 decimal precision
      const priceUsd = 0.00340902;
      const price8d = Math.round(priceUsd * 1e8);

      expect(price8d).toBe(340902);
    });
  });

  // ==========================================================================
  // Error Handling Tests
  // ==========================================================================
  describe("Error Handling", () => {
    test(
      "Invalid RPC URL throws error",
      async () => {
        if (skipIfNoServer()) return;
        const invalidConnection = new Connection("http://invalid-rpc.example.com");

        await expect(invalidConnection.getVersion()).rejects.toThrow();
      },
      TEST_TIMEOUT,
    );

    test("Invalid PublicKey throws", () => {
      expect(() => {
        new PublicKey("invalid");
      }).toThrow();
    });

    test("Valid PublicKey does not throw", () => {
      expect(() => {
        new PublicKey(WSOL_MINT);
      }).not.toThrow();
    });
  });
});
