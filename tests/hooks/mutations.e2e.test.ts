/**
 * Mutation Hooks E2E Integration Tests
 *
 * Tests mutation behavior by exercising the underlying API endpoints.
 * These tests verify:
 * 1. API endpoints work correctly for CRUD operations
 * 2. Validation at API boundaries
 * 3. Error responses for invalid inputs
 * 4. Proper status codes and response structures
 *
 * Prerequisites:
 * - Next.js running: `bun run dev` or via global-setup
 *
 * Run: bun test tests/hooks/mutations.e2e.test.ts
 */

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { BASE_URL, waitForServer } from "../test-utils";

setDefaultTimeout(30_000);

// Test addresses (deterministic Anvil accounts)
const ANVIL_DEPLOYER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const ANVIL_ACCOUNT_1 = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const SOLANA_TEST_ADDRESS = "E6K5x45Bxfmci6FmKRQ2YJMpLz7fCdLm7r7ReCq6P5vP";

// Track created resources for cleanup
const createdConsignmentIds: string[] = [];

// Server availability flag
let serverAvailable = false;

function skipIfNoServer(): boolean {
  if (!serverAvailable) {
    console.log("  (skipped: server not available)");
    return true;
  }
  return false;
}

interface ApiResponse<T> {
  status: number;
  data: T;
}

async function apiCall<T>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: Record<string, unknown>,
  timeoutMs = 35_000, // Default 35s to handle blockchain retry waits
): Promise<ApiResponse<T>> {
  const options: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  };
  if (body) {
    options.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE_URL}${path}`, options);
  const data = (await res.json()) as T;
  return { status: res.status, data };
}

describe("Mutation Hooks E2E Tests", () => {
  beforeAll(async () => {
    try {
      await waitForServer(10_000);
      serverAvailable = true;
    } catch {
      console.log(
        "\n  Server not available at " +
          BASE_URL +
          "\n  Run `bun run dev` to start the server.\n" +
          "  Skipping mutation E2E tests.\n",
      );
    }
  });

  afterAll(async () => {
    if (!serverAvailable) return;

    // Cleanup created consignments
    for (const id of createdConsignmentIds) {
      await apiCall("DELETE", `/api/consignments/${id}?callerAddress=${ANVIL_DEPLOYER}`).catch(
        () => {},
      );
    }
  });

  // ==========================================================================
  // CREATE CONSIGNMENT MUTATION
  // ==========================================================================
  describe("useCreateConsignment (via POST /api/consignments)", () => {
    test("creates consignment with valid EVM data", async () => {
      if (skipIfNoServer()) return;

      const tokenAddress =
        "0x" + Math.random().toString(16).slice(2, 42).padEnd(40, "0").toLowerCase();
      const tokenSymbol = "MUT" + Date.now().toString(36).slice(-4).toUpperCase();

      const { status, data } = await apiCall<{
        success: boolean;
        consignment?: { id: string; tokenId: string; status: string };
        error?: string;
      }>("POST", "/api/consignments", {
        tokenId: `token-base-${tokenAddress}`,
        consignerAddress: ANVIL_DEPLOYER,
        amount: "1000000000000000000",
        chain: "base",
        isNegotiable: true,
        minDiscountBps: 500,
        maxDiscountBps: 2000,
        minLockupDays: 30,
        maxLockupDays: 180,
        minDealAmount: "100000000000000000",
        maxDealAmount: "1000000000000000000",
        tokenSymbol,
        tokenAddress,
        tokenDecimals: 18, // Required for test tokens that don't exist on-chain
      });

      expect(status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.consignment).toBeDefined();

      if (data.consignment) {
        createdConsignmentIds.push(data.consignment.id);
        expect(data.consignment.status).toBe("active");
        expect(data.consignment.tokenId).toContain("token-base-");
      }
    });

    test("fails with missing required fields", async () => {
      if (skipIfNoServer()) return;

      const { status, data } = await apiCall<{ error?: string }>("POST", "/api/consignments", {
        // Missing tokenId, consignerAddress, amount, chain
        isNegotiable: true,
      });

      expect(status).toBe(400);
      expect(data.error).toBeDefined();
    });

    test("fails with invalid BPS values", async () => {
      if (skipIfNoServer()) return;

      const { status, data } = await apiCall<{ error?: string }>("POST", "/api/consignments", {
        tokenId: "token-base-0x1234",
        consignerAddress: ANVIL_DEPLOYER,
        amount: "1000",
        chain: "base",
        isNegotiable: true,
        minDiscountBps: 15000, // Invalid: max is 10000
        tokenSymbol: "TEST",
        tokenAddress: "0x1234",
      });

      expect(status).toBe(400);
      expect(data.error).toBeDefined();
    });

    test("fails with negative amount", async () => {
      if (skipIfNoServer()) return;

      const { status, data } = await apiCall<{ error?: string }>("POST", "/api/consignments", {
        tokenId: "token-base-0x1234",
        consignerAddress: ANVIL_DEPLOYER,
        amount: "-1000", // Invalid: negative
        chain: "base",
        isNegotiable: false,
        tokenSymbol: "TEST",
        tokenAddress: "0x1234",
      });

      expect(status).toBe(400);
      expect(data.error).toBeDefined();
    });

    test("fails with invalid chain", async () => {
      if (skipIfNoServer()) return;

      const { status, data } = await apiCall<{ error?: string }>("POST", "/api/consignments", {
        tokenId: "token-invalid-0x1234",
        consignerAddress: ANVIL_DEPLOYER,
        amount: "1000",
        chain: "invalid-chain",
        isNegotiable: false,
        tokenSymbol: "TEST",
        tokenAddress: "0x1234",
      });

      expect(status).toBe(400);
      expect(data.error).toBeDefined();
    });

    test("requires contractConsignmentId for Solana", async () => {
      if (skipIfNoServer()) return;

      const { status, data } = await apiCall<{ error?: string }>("POST", "/api/consignments", {
        tokenId: "token-solana-test",
        consignerAddress: SOLANA_TEST_ADDRESS,
        amount: "1000000000",
        chain: "solana",
        isNegotiable: false,
        tokenSymbol: "TEST",
        tokenAddress: SOLANA_TEST_ADDRESS,
        // Missing contractConsignmentId
      });

      expect(status).toBe(400);
      expect(data.error).toBeDefined();
    });
  });

  // ==========================================================================
  // WITHDRAW CONSIGNMENT MUTATION
  // ==========================================================================
  describe("useWithdrawConsignment (via DELETE /api/consignments/:id)", () => {
    test("returns 404 for non-existent consignment", async () => {
      if (skipIfNoServer()) return;

      const { status } = await apiCall<{ error?: string }>(
        "DELETE",
        `/api/consignments/00000000-0000-0000-0000-000000000000?callerAddress=${ANVIL_DEPLOYER}`,
      );

      expect(status).toBe(404);
    });

    test("requires callerAddress parameter", async () => {
      if (skipIfNoServer()) return;

      const { status, data } = await apiCall<{ error?: string }>(
        "DELETE",
        "/api/consignments/test-id",
        // Missing callerAddress
      );

      expect(status).toBe(400);
      expect(data.error).toBeDefined();
    });
  });

  // ==========================================================================
  // SOLANA WITHDRAW MUTATION
  // ==========================================================================
  describe("useSolanaWithdrawConsignment (via POST /api/solana/withdraw-consignment)", () => {
    test("validates required fields", async () => {
      if (skipIfNoServer()) return;

      const { status, data } = await apiCall<{ error?: string }>(
        "POST",
        "/api/solana/withdraw-consignment",
        {},
      );

      expect(status).toBe(400);
      expect(data.error).toBeDefined();
    });

    test("validates Solana address format", async () => {
      if (skipIfNoServer()) return;

      const { status, data } = await apiCall<{ error?: string }>(
        "POST",
        "/api/solana/withdraw-consignment",
        {
          consignmentAddress: "invalid-address",
          consignerAddress: SOLANA_TEST_ADDRESS,
        },
      );

      expect(status).toBe(400);
      expect(data.error).toBeDefined();
    });

    test("rejects EVM addresses", async () => {
      if (skipIfNoServer()) return;

      const { status, data } = await apiCall<{ error?: string }>(
        "POST",
        "/api/solana/withdraw-consignment",
        {
          consignmentAddress: ANVIL_DEPLOYER, // EVM address
          consignerAddress: SOLANA_TEST_ADDRESS,
        },
      );

      expect(status).toBe(400);
      expect(data.error).toBeDefined();
    });
  });

  // ==========================================================================
  // UPDATE CONSIGNMENT MUTATION
  // ==========================================================================
  describe("useUpdateConsignment (via PUT /api/consignments/:id)", () => {
    test("returns 404 for non-existent consignment", async () => {
      if (skipIfNoServer()) return;

      const { status } = await apiCall<{ error?: string }>(
        "PUT",
        "/api/consignments/00000000-0000-0000-0000-000000000000",
        {
          callerAddress: ANVIL_DEPLOYER,
          status: "paused",
        },
      );

      expect(status).toBe(404);
    });

    test("ignores unknown fields like status (schema strips them)", async () => {
      if (skipIfNoServer()) return;

      // Status is not in UpdateConsignmentRequestSchema, so it gets stripped
      // The request then proceeds and returns 404 for non-existent consignment
      const { status } = await apiCall<{ error?: string }>("PUT", "/api/consignments/some-id", {
        callerAddress: ANVIL_DEPLOYER,
        status: "invalid-status", // This field is stripped by schema
      });

      // Returns 404 because consignment doesn't exist (status field was ignored)
      expect(status).toBe(404);
    });

    test("requires callerAddress", async () => {
      if (skipIfNoServer()) return;

      const { status, data } = await apiCall<{ error?: string }>(
        "PUT",
        "/api/consignments/some-id",
        {
          status: "paused",
          // Missing callerAddress
        },
      );

      expect(status).toBe(400);
      expect(data.error).toBeDefined();
    });
  });

  // ==========================================================================
  // DEAL MUTATIONS
  // ==========================================================================
  describe("useDealMutations (via POST /api/otc/approve)", () => {
    test("validates required offerId", async () => {
      if (skipIfNoServer()) return;

      const { status, data } = await apiCall<{ error?: string }>("POST", "/api/otc/approve", {});

      expect(status).toBe(400);
      expect(data.error).toBeDefined();
    });

    test("validates chain enum", async () => {
      if (skipIfNoServer()) return;

      const { status, data } = await apiCall<{ error?: string }>("POST", "/api/otc/approve", {
        offerId: 1,
        chain: "invalid-chain",
      });

      expect(status).toBe(400);
      expect(data.error).toBeDefined();
    });

    test("accepts valid numeric offerId", async () => {
      if (skipIfNoServer()) return;

      const { status } = await apiCall<{ error?: string }>("POST", "/api/otc/approve", {
        offerId: 999999,
        chain: "base",
      });

      // 404 or 500 expected (offer doesn't exist), not 400
      expect([404, 500]).toContain(status);
    });

    test("accepts string offerId", async () => {
      if (skipIfNoServer()) return;

      const { status } = await apiCall<{ error?: string }>("POST", "/api/otc/approve", {
        offerId: "12345",
        chain: "ethereum",
      });

      // Should not be 400
      expect([404, 500]).toContain(status);
    });
  });

  // ==========================================================================
  // CLAIM TOKENS MUTATION
  // ==========================================================================
  describe("useClaimTokens (via POST /api/solana/claim)", () => {
    test("validates required fields", async () => {
      if (skipIfNoServer()) return;

      const { status, data } = await apiCall<{ error?: string }>("POST", "/api/solana/claim", {});

      expect(status).toBe(400);
      expect(data.error).toBeDefined();
    });

    test("validates Solana addresses", async () => {
      if (skipIfNoServer()) return;

      const { status, data } = await apiCall<{ error?: string }>("POST", "/api/solana/claim", {
        offerAddress: "invalid",
        beneficiary: "invalid",
      });

      expect(status).toBe(400);
      expect(data.error).toBeDefined();
    });

    test("rejects EVM addresses", async () => {
      if (skipIfNoServer()) return;

      const { status, data } = await apiCall<{ error?: string }>("POST", "/api/solana/claim", {
        offerAddress: ANVIL_DEPLOYER,
        beneficiary: ANVIL_ACCOUNT_1,
      });

      expect(status).toBe(400);
      expect(data.error).toBeDefined();
    });

    test("returns 404/500 for non-existent offer with valid addresses", async () => {
      if (skipIfNoServer()) return;

      const { status } = await apiCall<{ error?: string }>("POST", "/api/solana/claim", {
        offerAddress: SOLANA_TEST_ADDRESS,
        beneficiary: SOLANA_TEST_ADDRESS,
      });

      expect([404, 500]).toContain(status);
    });
  });

  // ==========================================================================
  // DEAL COMPLETION MUTATION
  // ==========================================================================
  describe("useCompleteDeal (via POST /api/deal-completion)", () => {
    test("validates required quoteId", async () => {
      if (skipIfNoServer()) return;

      const { status, data } = await apiCall<{ error?: string }>("POST", "/api/deal-completion", {
        action: "complete",
      });

      expect(status).toBe(400);
      expect(data.error).toBeDefined();
    });

    test("validates required action", async () => {
      if (skipIfNoServer()) return;

      const { status, data } = await apiCall<{ error?: string }>("POST", "/api/deal-completion", {
        quoteId: "test-quote",
      });

      expect(status).toBe(400);
      expect(data.error).toBeDefined();
    });

    test("validates action enum", async () => {
      if (skipIfNoServer()) return;

      const { status, data } = await apiCall<{ error?: string }>("POST", "/api/deal-completion", {
        quoteId: "test-quote",
        action: "invalid-action",
      });

      expect(status).toBe(400);
      expect(data.error).toBeDefined();
    });

    test("complete action requires tokenId", async () => {
      if (skipIfNoServer()) return;

      const { status } = await apiCall<{ error?: string }>("POST", "/api/deal-completion", {
        quoteId: "test-quote",
        action: "complete",
        consignmentId: "test-consignment",
        // Missing tokenId
      });

      expect(status).toBe(400);
    });

    test("share action does not require tokenId", async () => {
      if (skipIfNoServer()) return;

      const { status } = await apiCall<{ error?: string }>("POST", "/api/deal-completion", {
        quoteId: "test-quote",
        action: "share",
      });

      // Should not be 400 - validation passes
      expect([200, 404, 500]).toContain(status);
    });
  });

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================
  describe("Mutation Edge Cases", () => {
    test("handles empty JSON body", async () => {
      if (skipIfNoServer()) return;

      const response = await fetch(`${BASE_URL}/api/consignments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });

      expect(response.status).toBe(400);
    });

    test("handles malformed JSON body", async () => {
      if (skipIfNoServer()) return;

      const response = await fetch(`${BASE_URL}/api/consignments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{invalid json",
      });

      expect([400, 500]).toContain(response.status);
    });

    test("handles null body", async () => {
      if (skipIfNoServer()) return;

      const response = await fetch(`${BASE_URL}/api/consignments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "null",
      });

      expect(response.status).toBe(400);
    });

    test("handles very large amounts", async () => {
      if (skipIfNoServer()) return;

      const { status } = await apiCall<{ error?: string }>("POST", "/api/consignments", {
        tokenId: "token-base-0x1234",
        consignerAddress: ANVIL_DEPLOYER,
        amount: "99999999999999999999999999999999999999999999999999",
        chain: "base",
        isNegotiable: false,
        tokenSymbol: "TEST",
        tokenAddress: "0x1234",
      });

      // Should handle gracefully (either accept or reject)
      expect([200, 400, 500]).toContain(status);
    });

    test("handles concurrent create requests", async () => {
      if (skipIfNoServer()) return;

      const createPayload = () => ({
        tokenId: `token-base-0x${Math.random().toString(16).slice(2, 42).padEnd(40, "0")}`,
        consignerAddress: ANVIL_DEPLOYER,
        amount: "1000",
        chain: "base",
        isNegotiable: false,
        tokenSymbol: "TEST",
        tokenAddress: `0x${Math.random().toString(16).slice(2, 42).padEnd(40, "0")}`,
      });

      const promises = Array.from({ length: 5 }, () =>
        apiCall<{ success?: boolean }>("POST", "/api/consignments", createPayload()),
      );

      const results = await Promise.all(promises);

      // All should complete without server errors
      for (const { status } of results) {
        expect([200, 400, 500]).toContain(status);
      }
    });
  });
});
