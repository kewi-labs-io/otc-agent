/**
 * React Query Hooks E2E Integration Tests
 *
 * Tests React Query hooks against a running Next.js server.
 * These tests verify:
 * 1. Hook data fetching works correctly
 * 2. Caching behavior
 * 3. Error handling
 * 4. Edge cases (empty data, invalid IDs, etc.)
 *
 * Prerequisites:
 * - Next.js running: `bun run dev` or via global-setup
 *
 * Run: bun test tests/hooks/react-query-hooks.e2e.test.ts
 */

import { beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { BASE_URL } from "../test-utils";

// Set default timeout for all tests in this file
setDefaultTimeout(30_000);

const TEST_TIMEOUT = 30_000;

// Test addresses
const TEST_EVM_ADDRESS = "0x514910771AF9Ca656af840dff83E8264EcF986CA"; // LINK on Ethereum
const TEST_SOLANA_ADDRESS = "So11111111111111111111111111111111111111112"; // Wrapped SOL
// Use a clearly non-existent token ID (not the zero address which may be seeded)
const INVALID_TOKEN_ID = "token-base-0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
const INVALID_UUID = "00000000-0000-0000-0000-000000000000";

// Flag to track server availability
let serverAvailable = false;

/**
 * Wait for server to be ready
 */
async function waitForServer(maxWaitMs: number = 15000): Promise<boolean> {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    const res = await fetch(`${BASE_URL}/api/tokens`, {
      signal: AbortSignal.timeout(1000), // Short timeout per request
    }).catch(() => null);
    if (res?.ok) return true;
    await new Promise((r) => setTimeout(r, 200)); // Quick retry
  }
  return false;
}

function skipIfNoServer(): boolean {
  if (!serverAvailable) {
    console.log("  (skipped: server not available)");
    return true;
  }
  return false;
}

/**
 * Type-safe fetch helper
 */
async function fetchJson<T>(
  url: string,
  options?: RequestInit,
): Promise<{ status: number; data: T }> {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(TEST_TIMEOUT - 1000),
  });
  const data = (await response.json()) as T;
  return { status: response.status, data };
}

// =============================================================================
// TESTS
// =============================================================================

describe("React Query Hooks Integration Tests", () => {
  beforeAll(async () => {
    serverAvailable = await waitForServer(5_000); // Reduced timeout for faster skip
    if (!serverAvailable) {
      console.log(
        "\n  Server not available at " +
          BASE_URL +
          "\n  Run `bun run dev` to start the server.\n" +
          "  Skipping React Query hook tests.\n",
      );
    }
  });

  // ==========================================================================
  // useToken - Token fetching tests
  // ==========================================================================
  describe("useToken behavior (via /api/tokens/[tokenId])", () => {
    test(
      "returns 404 for non-existent token",
      async () => {
        if (skipIfNoServer()) return;

        const { status } = await fetchJson(`${BASE_URL}/api/tokens/${INVALID_TOKEN_ID}`);
        expect(status).toBe(404);
      },
      TEST_TIMEOUT,
    );

    test(
      "returns 400 for invalid tokenId format",
      async () => {
        if (skipIfNoServer()) return;

        const { status } = await fetchJson(`${BASE_URL}/api/tokens/invalid-format`);
        expect(status).toBe(400);
      },
      TEST_TIMEOUT,
    );

    test(
      "caches token data (multiple requests same result)",
      async () => {
        if (skipIfNoServer()) return;

        // Make two requests and verify same structure
        const { status: status1, data: data1 } = await fetchJson<{ success: boolean }>(
          `${BASE_URL}/api/tokens`,
        );
        const { status: status2, data: data2 } = await fetchJson<{ success: boolean }>(
          `${BASE_URL}/api/tokens`,
        );

        expect(status1).toBe(200);
        expect(status2).toBe(200);
        expect(data1.success).toBe(data2.success);
      },
      TEST_TIMEOUT,
    );
  });

  // ==========================================================================
  // useMarketData - Market data fetching tests
  // ==========================================================================
  describe("useMarketData behavior (via /api/market-data/[tokenId])", () => {
    test(
      "returns 404 or null for non-existent token",
      async () => {
        if (skipIfNoServer()) return;

        const { status, data } = await fetchJson<{ success: boolean; marketData: unknown }>(
          `${BASE_URL}/api/market-data/${INVALID_TOKEN_ID}`,
        );

        // Either 404 (not found) or 200 with null marketData
        if (status === 200) {
          expect(data.marketData).toBeNull();
        } else {
          expect(status).toBe(404);
        }
      },
      TEST_TIMEOUT,
    );

    test(
      "accepts valid tokenId format",
      async () => {
        if (skipIfNoServer()) return;

        const { status } = await fetchJson(
          `${BASE_URL}/api/market-data/token-ethereum-${TEST_EVM_ADDRESS}`,
        );

        // Should not be 400 (validation error)
        expect([200, 404]).toContain(status);
      },
      TEST_TIMEOUT,
    );
  });

  // ==========================================================================
  // usePoolCheck - Pool validation tests
  // ==========================================================================
  describe("usePoolCheck behavior (via /api/token-pool-check)", () => {
    test(
      "returns 400 without required params",
      async () => {
        if (skipIfNoServer()) return;

        const { status } = await fetchJson(`${BASE_URL}/api/token-pool-check`);
        expect(status).toBe(400);
      },
      TEST_TIMEOUT,
    );

    test(
      "skips pool check for Solana (returns success)",
      async () => {
        if (skipIfNoServer()) return;

        const { status, data } = await fetchJson<{ success: boolean; chain: string }>(
          `${BASE_URL}/api/token-pool-check?tokenAddress=${TEST_SOLANA_ADDRESS}&chain=solana`,
        );

        expect(status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.chain).toBe("solana");
      },
      TEST_TIMEOUT,
    );

    test(
      "validates EVM address format",
      async () => {
        if (skipIfNoServer()) return;

        const { status } = await fetchJson(
          `${BASE_URL}/api/token-pool-check?tokenAddress=invalid&chain=base`,
        );

        expect(status).toBe(400);
      },
      TEST_TIMEOUT,
    );

    test(
      "checks pool for valid EVM token",
      async () => {
        if (skipIfNoServer()) return;

        const { status, data } = await fetchJson<{
          success: boolean;
          hasPool?: boolean;
          pools?: unknown[];
        }>(`${BASE_URL}/api/token-pool-check?tokenAddress=${TEST_EVM_ADDRESS}&chain=ethereum`);

        // May succeed or fail based on pool availability
        if (status === 200) {
          expect(typeof data.success).toBe("boolean");
          if (data.hasPool !== undefined) {
            expect(typeof data.hasPool).toBe("boolean");
          }
        }
      },
      TEST_TIMEOUT,
    );
  });

  // ==========================================================================
  // useNativePrices - Native price fetching tests
  // ==========================================================================
  describe("useNativePrices behavior (via /api/native-prices)", () => {
    test(
      "returns prices object",
      async () => {
        if (skipIfNoServer()) return;

        const { status, data } = await fetchJson<Record<string, number>>(
          `${BASE_URL}/api/native-prices`,
        );

        expect(status).toBe(200);
        expect(typeof data).toBe("object");
      },
      TEST_TIMEOUT,
    );

    test(
      "returns positive numbers for available prices",
      async () => {
        if (skipIfNoServer()) return;

        const { status, data } = await fetchJson<Record<string, number>>(
          `${BASE_URL}/api/native-prices`,
        );

        expect(status).toBe(200);

        for (const [symbol, price] of Object.entries(data)) {
          if (typeof price === "number") {
            expect(price).toBeGreaterThan(0);
            expect(["ETH", "BNB", "SOL"]).toContain(symbol);
          }
        }
      },
      TEST_TIMEOUT,
    );
  });

  // ==========================================================================
  // useConsignment - Consignment fetching tests
  // ==========================================================================
  describe("useConsignment behavior (via /api/consignments/[id])", () => {
    test(
      "returns 404 for non-existent consignment",
      async () => {
        if (skipIfNoServer()) return;

        const { status } = await fetchJson(`${BASE_URL}/api/consignments/${INVALID_UUID}`);
        expect(status).toBe(404);
      },
      TEST_TIMEOUT,
    );

    test(
      "supports callerAddress query param",
      async () => {
        if (skipIfNoServer()) return;

        const { status } = await fetchJson(
          `${BASE_URL}/api/consignments/${INVALID_UUID}?callerAddress=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`,
        );

        // Should not fail due to callerAddress, just 404 for non-existent
        expect(status).toBe(404);
      },
      TEST_TIMEOUT,
    );
  });

  // ==========================================================================
  // useTokenLookup - Token lookup tests
  // ==========================================================================
  describe("useTokenLookup behavior (via /api/token-lookup)", () => {
    test(
      "returns 400 without address param",
      async () => {
        if (skipIfNoServer()) return;

        const { status } = await fetchJson(`${BASE_URL}/api/token-lookup`);
        expect(status).toBe(400);
      },
      TEST_TIMEOUT,
    );

    test(
      "auto-detects Solana addresses",
      async () => {
        if (skipIfNoServer()) return;

        const { status } = await fetchJson(
          `${BASE_URL}/api/token-lookup?address=${TEST_SOLANA_ADDRESS}`,
        );

        // 503 if API not configured, 200/404 if working
        expect([200, 404, 503]).toContain(status);
      },
      TEST_TIMEOUT,
    );

    test(
      "auto-detects EVM addresses",
      async () => {
        if (skipIfNoServer()) return;

        const { status, data } = await fetchJson<{
          success?: boolean;
          token?: { symbol?: string; decimals?: number };
        }>(`${BASE_URL}/api/token-lookup?address=${TEST_EVM_ADDRESS}`);

        // 503 = API not configured, 502 = external API error
        if (status === 503 || status === 502) return;
        expect([200, 404]).toContain(status);

        if (status === 200 && data.token) {
          expect(data.success).toBe(true);
          expect(data.token.symbol).toBeDefined();
          expect(typeof data.token.decimals).toBe("number");
        }
      },
      TEST_TIMEOUT,
    );

    test(
      "validates address format",
      async () => {
        if (skipIfNoServer()) return;

        const { status } = await fetchJson(`${BASE_URL}/api/token-lookup?address=invalid`);
        expect(status).toBe(400);
      },
      TEST_TIMEOUT,
    );

    test(
      "respects chain parameter",
      async () => {
        if (skipIfNoServer()) return;

        const { status } = await fetchJson(
          `${BASE_URL}/api/token-lookup?address=${TEST_EVM_ADDRESS}&chain=ethereum`,
        );

        // Should not be 400 for valid params
        expect([200, 404, 503]).toContain(status);
      },
      TEST_TIMEOUT,
    );
  });

  // ==========================================================================
  // useExecutedQuote - Quote fetching tests
  // ==========================================================================
  describe("useExecutedQuote behavior (via /api/quote/executed/[id])", () => {
    test(
      "returns 404 for non-existent quote",
      async () => {
        if (skipIfNoServer()) return;

        const { status } = await fetchJson(`${BASE_URL}/api/quote/executed/${INVALID_UUID}`);
        expect(status).toBe(404);
      },
      TEST_TIMEOUT,
    );
  });

  // ==========================================================================
  // Mutation Endpoints - POST validation tests
  // ==========================================================================
  describe("Mutation endpoint validation", () => {
    test(
      "POST /api/consignments validates required fields",
      async () => {
        if (skipIfNoServer()) return;

        const { status, data } = await fetchJson<{ error?: string }>(
          `${BASE_URL}/api/consignments`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          },
        );

        expect(status).toBe(400);
        expect(data.error).toBeDefined();
      },
      TEST_TIMEOUT,
    );

    test(
      "POST /api/deal-completion validates action field",
      async () => {
        if (skipIfNoServer()) return;

        const { status, data } = await fetchJson<{ error?: string }>(
          `${BASE_URL}/api/deal-completion`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ quoteId: "test" }), // Missing action
          },
        );

        expect(status).toBe(400);
        expect(data.error).toBeDefined();
      },
      TEST_TIMEOUT,
    );

    test(
      "POST /api/otc/approve validates chain field",
      async () => {
        if (skipIfNoServer()) return;

        const { status, data } = await fetchJson<{ error?: string }>(
          `${BASE_URL}/api/otc/approve`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ offerId: 1, chain: "invalid-chain" }),
          },
        );

        expect(status).toBe(400);
        expect(data.error).toBeDefined();
      },
      TEST_TIMEOUT,
    );

    test(
      "POST /api/solana/claim validates Solana addresses",
      async () => {
        if (skipIfNoServer()) return;

        const { status, data } = await fetchJson<{ error?: string }>(
          `${BASE_URL}/api/solana/claim`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              offerAddress: "invalid",
              beneficiary: "invalid",
            }),
          },
        );

        expect(status).toBe(400);
        expect(data.error).toBeDefined();
      },
      TEST_TIMEOUT,
    );

    test(
      "POST /api/solana/withdraw-consignment validates addresses",
      async () => {
        if (skipIfNoServer()) return;

        const { status, data } = await fetchJson<{ error?: string }>(
          `${BASE_URL}/api/solana/withdraw-consignment`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              consignmentAddress: "0x123", // EVM address, not Solana
              consignerAddress: TEST_SOLANA_ADDRESS,
            }),
          },
        );

        expect(status).toBe(400);
        expect(data.error).toBeDefined();
      },
      TEST_TIMEOUT,
    );
  });

  // ==========================================================================
  // Edge Cases - Boundary conditions
  // ==========================================================================
  describe("Edge cases and boundary conditions", () => {
    test(
      "handles empty tokenId gracefully",
      async () => {
        if (skipIfNoServer()) return;

        const { status } = await fetchJson(`${BASE_URL}/api/tokens/`);
        // Either redirect to list (200) or 404
        expect([200, 404]).toContain(status);
      },
      TEST_TIMEOUT,
    );

    test(
      "handles URL-encoded special characters",
      async () => {
        if (skipIfNoServer()) return;

        const encoded = encodeURIComponent("token-base-0x<script>");
        const { status } = await fetchJson(`${BASE_URL}/api/tokens/${encoded}`);
        expect(status).toBe(400); // Invalid format
      },
      TEST_TIMEOUT,
    );

    test(
      "handles concurrent requests to same endpoint",
      async () => {
        if (skipIfNoServer()) return;

        // Fire multiple requests concurrently
        const requests = Array(5)
          .fill(null)
          .map(() => fetchJson(`${BASE_URL}/api/native-prices`));

        const results = await Promise.all(requests);

        // All should succeed
        for (const { status } of results) {
          expect(status).toBe(200);
        }
      },
      TEST_TIMEOUT,
    );

    test(
      "handles very long query parameters",
      async () => {
        if (skipIfNoServer()) return;

        const longIds = Array(100).fill("token-id").join(",");
        const { status } = await fetchJson(`${BASE_URL}/api/tokens/batch?ids=${longIds}`);

        // Should return 400 (batch limit exceeded) not 500
        expect([200, 400]).toContain(status);
      },
      TEST_TIMEOUT,
    );

    test(
      "handles missing Content-Type header for POST",
      async () => {
        if (skipIfNoServer()) return;

        const response = await fetch(`${BASE_URL}/api/consignments`, {
          method: "POST",
          body: JSON.stringify({ tokenId: "test" }),
          // No Content-Type header
        });

        // Should fail gracefully
        expect([400, 415]).toContain(response.status);
      },
      TEST_TIMEOUT,
    );

    test(
      "handles empty JSON body",
      async () => {
        if (skipIfNoServer()) return;

        const { status } = await fetchJson(`${BASE_URL}/api/consignments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });

        expect(status).toBe(400);
      },
      TEST_TIMEOUT,
    );

    test(
      "handles malformed JSON body",
      async () => {
        if (skipIfNoServer()) return;

        const response = await fetch(`${BASE_URL}/api/consignments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{invalid json",
        });

        expect([400, 500]).toContain(response.status);
      },
      TEST_TIMEOUT,
    );
  });

  // ==========================================================================
  // Cache invalidation patterns
  // ==========================================================================
  describe("Cache invalidation patterns", () => {
    test(
      "token list endpoint returns consistent structure",
      async () => {
        if (skipIfNoServer()) return;

        const { status, data } = await fetchJson<{
          success: boolean;
          tokens: unknown[];
        }>(`${BASE_URL}/api/tokens`);

        expect(status).toBe(200);
        expect(data.success).toBe(true);
        expect(Array.isArray(data.tokens)).toBe(true);
      },
      TEST_TIMEOUT,
    );

    test(
      "consignment list endpoint returns consistent structure",
      async () => {
        if (skipIfNoServer()) return;

        const { status, data } = await fetchJson<{
          success: boolean;
          consignments: unknown[];
        }>(`${BASE_URL}/api/consignments`);

        expect(status).toBe(200);
        expect(data.success).toBe(true);
        expect(Array.isArray(data.consignments)).toBe(true);
      },
      TEST_TIMEOUT,
    );

    test(
      "token batch endpoint returns map structure",
      async () => {
        if (skipIfNoServer()) return;

        const { status, data } = await fetchJson<{
          success: boolean;
          tokens: Record<string, unknown>;
        }>(`${BASE_URL}/api/tokens/batch`);

        expect(status).toBe(200);
        expect(data.success).toBe(true);
        expect(typeof data.tokens).toBe("object");
        expect(data.tokens).not.toBeNull();
      },
      TEST_TIMEOUT,
    );
  });
});
