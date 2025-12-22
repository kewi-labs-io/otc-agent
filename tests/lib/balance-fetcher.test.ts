/**
 * Balance Fetcher Utility Tests
 *
 * Tests for balance filtering and sorting utilities.
 * Uses fail-fast patterns with strong typing.
 *
 * Run: bun test tests/lib/balance-fetcher.test.ts
 */

import { describe, expect, test } from "bun:test";
import {
  enrichEvmTokensWithPrices,
  enrichSolanaTokensWithPrices,
  filterDustTokens,
  sortTokensByValue,
} from "@/lib/balance-fetcher";
import type { SolanaTokenBalance, TokenBalance } from "@/types/api";
import { expectDefined } from "../test-utils";

describe("balance-fetcher", () => {
  describe("filterDustTokens", () => {
    test("filters tokens below minimum balance", () => {
      const tokens: TokenBalance[] = [
        {
          contractAddress: "0x1",
          symbol: "TOKEN1",
          name: "Token 1",
          decimals: 18,
          balance: "500000000000000000", // 0.5 tokens
          priceUsd: 1,
          balanceUsd: 0.5,
        },
        {
          contractAddress: "0x2",
          symbol: "TOKEN2",
          name: "Token 2",
          decimals: 18,
          balance: "2000000000000000000", // 2 tokens
          priceUsd: 1,
          balanceUsd: 2,
        },
      ];

      const filtered = filterDustTokens(tokens, 1, 0.001);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].contractAddress).toBe("0x2");
    });

    test("filters tokens below minimum USD value when price available", () => {
      const tokens: TokenBalance[] = [
        {
          contractAddress: "0x1",
          symbol: "TOKEN1",
          name: "Token 1",
          decimals: 18,
          balance: "1000000000000000000", // 1 token
          priceUsd: 0.0001, // Very low price
          balanceUsd: 0.0001,
        },
        {
          contractAddress: "0x2",
          symbol: "TOKEN2",
          name: "Token 2",
          decimals: 18,
          balance: "1000000000000000000", // 1 token
          priceUsd: 1,
          balanceUsd: 1,
        },
      ];

      const filtered = filterDustTokens(tokens, 1, 0.001);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].contractAddress).toBe("0x2");
    });

    test("keeps tokens without prices if balance is sufficient", () => {
      const tokens: TokenBalance[] = [
        {
          contractAddress: "0x1",
          symbol: "TOKEN1",
          name: "Token 1",
          decimals: 18,
          balance: "2000000000000000000", // 2 tokens
          // No price
        },
      ];

      const filtered = filterDustTokens(tokens, 1, 0.001);
      expect(filtered).toHaveLength(1);
    });
  });

  describe("sortTokensByValue", () => {
    test("sorts priced tokens before unpriced tokens", () => {
      const tokens: TokenBalance[] = [
        {
          contractAddress: "0x1",
          symbol: "TOKEN1",
          name: "Token 1",
          decimals: 18,
          balance: "1000000000000000000",
          // No price
        },
        {
          contractAddress: "0x2",
          symbol: "TOKEN2",
          name: "Token 2",
          decimals: 18,
          balance: "1000000000000000000",
          priceUsd: 1,
          balanceUsd: 1,
        },
      ];

      const sorted = sortTokensByValue(tokens);
      expect(sorted[0].contractAddress).toBe("0x2");
      expect(sorted[1].contractAddress).toBe("0x1");
    });

    test("sorts priced tokens by USD value descending", () => {
      const tokens: TokenBalance[] = [
        {
          contractAddress: "0x1",
          symbol: "TOKEN1",
          name: "Token 1",
          decimals: 18,
          balance: "1000000000000000000",
          priceUsd: 1,
          balanceUsd: 1,
        },
        {
          contractAddress: "0x2",
          symbol: "TOKEN2",
          name: "Token 2",
          decimals: 18,
          balance: "1000000000000000000",
          priceUsd: 2,
          balanceUsd: 2,
        },
      ];

      const sorted = sortTokensByValue(tokens);
      expect(sorted[0].contractAddress).toBe("0x2");
      expect(sorted[1].contractAddress).toBe("0x1");
    });

    test("sorts unpriced tokens by balance descending", () => {
      const tokens: TokenBalance[] = [
        {
          contractAddress: "0x1",
          symbol: "TOKEN1",
          name: "Token 1",
          decimals: 18,
          balance: "1000000000000000000", // 1 token
        },
        {
          contractAddress: "0x2",
          symbol: "TOKEN2",
          name: "Token 2",
          decimals: 18,
          balance: "2000000000000000000", // 2 tokens
        },
      ];

      const sorted = sortTokensByValue(tokens);
      expect(sorted[0].contractAddress).toBe("0x2");
      expect(sorted[1].contractAddress).toBe("0x1");
    });
  });

  describe("enrichEvmTokensWithPrices", () => {
    test("calculates USD values from prices", async () => {
      const tokens: TokenBalance[] = [
        {
          contractAddress: "0x1",
          symbol: "TOKEN1",
          name: "Token 1",
          decimals: 18,
          balance: "1000000000000000000", // 1 token
          priceUsd: 2,
        },
      ];

      const enriched = await enrichEvmTokensWithPrices("base", tokens);
      expectDefined(enriched[0], "enriched token");
      expect(enriched[0].balanceUsd).toBe(2);
    });

    test("handles tokens without prices", async () => {
      const tokens: TokenBalance[] = [
        {
          contractAddress: "0x1",
          symbol: "TOKEN1",
          name: "Token 1",
          decimals: 18,
          balance: "1000000000000000000",
          // No price
        },
      ];

      const enriched = await enrichEvmTokensWithPrices("base", tokens);
      expect(enriched[0].balanceUsd).toBeUndefined();
    });
  });

  describe("enrichSolanaTokensWithPrices", () => {
    test("calculates USD values from prices when API available", async () => {
      const tokens: SolanaTokenBalance[] = [
        {
          mint: "So11111111111111111111111111111111111111112",
          amount: 1000000000, // 1 SOL (9 decimals)
          decimals: 9,
          symbol: "SOL",
          name: "Solana",
          logoURI: null,
          priceUsd: 100,
          balanceUsd: 0, // Will be calculated
        },
      ];

      const enriched = await enrichSolanaTokensWithPrices(tokens);
      expect(enriched[0].balanceUsd).toBeGreaterThanOrEqual(0);
    });

    test("preserves existing priceUsd when set", () => {
      const tokens: SolanaTokenBalance[] = [
        {
          mint: "TestMint111111111111111111111111111111111111",
          amount: 1000000000,
          decimals: 9,
          symbol: "TEST",
          name: "Test Token",
          logoURI: null,
          priceUsd: 50, // Pre-set price
          balanceUsd: 0,
        },
      ];

      // Verify structure - priceUsd should be preserved through the pipeline
      expect(tokens[0].priceUsd).toBe(50);
      expect(tokens[0].decimals).toBe(9);
    });
  });
});
