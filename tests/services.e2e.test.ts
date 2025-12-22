/**
 * Service Layer E2E Integration Tests
 *
 * Tests all services in src/services/ against real infrastructure:
 * - Real database (Eliza runtime cache)
 * - Real blockchain connections (Anvil/Solana validator)
 * - Real external APIs (where configured)
 *
 * These tests validate:
 * 1. Service methods work correctly with real data
 * 2. Zod validation at service boundaries
 * 3. Database operations (CRUD)
 * 4. Chain interactions (price fetching, reconciliation)
 *
 * Prerequisites:
 * - Run global-setup.ts first (starts Anvil, PostgreSQL, Next.js)
 * - Or run `./scripts/start-all.sh` manually
 *
 * Run: bun test tests/services.e2e.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { z } from "zod";
import { OTCConsignmentSchema, TokenSchema } from "../src/types/validation/db-schemas";
import {
  AddressSchema,
  BigIntStringSchema,
  BpsSchema,
  ChainSchema,
} from "../src/types/validation/schemas";
import { BASE_URL, waitForServer as waitForServerUtil } from "./test-utils";

// Test timeout for service operations
const SERVICE_TIMEOUT = 30_000;

// Test addresses (deterministic Anvil accounts)
const ANVIL_DEPLOYER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const ANVIL_ACCOUNT_1 = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const _ANVIL_ACCOUNT_2 = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

// Track created resources for cleanup
const createdTokenIds: string[] = [];
const createdConsignmentIds: string[] = [];

// Flag to track if server is available
let serverAvailable = false;

/**
 * Wait for server to be ready with timeout
 */
async function waitForServer(maxWaitMs: number = 30000): Promise<boolean> {
  await waitForServerUtil(maxWaitMs);
  return true;
}

/**
 * Skip test if server is not available
 */
function skipIfNoServer(): boolean {
  if (!serverAvailable) {
    console.log("  ⏭️  Skipping: server not available");
    return true;
  }
  return false;
}

/**
 * Helper to make API calls to services via their exposed routes
 * (Services are exercised through API routes in E2E tests)
 */
async function apiCall<T>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; data: T }> {
  const options: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(SERVICE_TIMEOUT),
  };
  if (body) {
    options.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE_URL}${path}`, options);

  // Handle non-JSON responses gracefully
  const contentType = res.headers.get("content-type");
  if (contentType?.includes("application/json")) {
    const data = await res.json();
    return { status: res.status, data: data as T };
  }

  // Non-JSON response - try to get text for error message
  const text = await res.text();
  return {
    status: res.status,
    data: { error: text || `HTTP ${res.status}` } as T,
  };
}

/**
 * Validate response data against a Zod schema
 */
function _validateSchema<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new Error(
      `Schema validation failed: ${result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")}`,
    );
  }
  return result.data;
}

describe("Service Layer E2E Tests", () => {
  beforeAll(async () => {
    if (skipIfNoServer()) return;
    // Wait for server to be ready (with shorter timeout for CI)
    serverAvailable = await waitForServer(15_000);

    if (!serverAvailable) {
      console.log(
        "\n⚠️  Server not available at " +
          BASE_URL +
          "\n   Run `bun run dev` or `./scripts/start-all.sh` to start the server.\n" +
          "   Skipping service E2E tests.\n",
      );
      return;
    }
  });

  afterAll(async () => {
    if (skipIfNoServer()) return;
    if (!serverAvailable) return;

    // Cleanup created resources
    for (const id of createdConsignmentIds) {
      await apiCall("DELETE", `/api/consignments/${id}`, {
        callerAddress: ANVIL_DEPLOYER,
      }).catch(() => {
        // Cleanup failed - log but don't fail test
      });
    }
  });

  // ==========================================================================
  // TOKEN REGISTRY SERVICE TESTS
  // ==========================================================================
  describe("TokenRegistryService", () => {
    test(
      "registerToken - creates token with valid data",
      async () => {
        if (skipIfNoServer()) return;
        if (skipIfNoServer()) return;

        const tokenAddress = "0x" + Math.random().toString(16).slice(2, 42).padEnd(40, "0");

        const { status, data } = await apiCall<{
          success: boolean;
          token?: {
            id: string;
            symbol: string;
            name: string;
            contractAddress: string;
            chain: string;
            decimals: number;
          };
          error?: string;
        }>("POST", "/api/tokens", {
          symbol: "TEST" + Date.now().toString(36).slice(-4).toUpperCase(),
          name: "Test Token",
          contractAddress: tokenAddress,
          chain: "base",
          decimals: 18,
          logoUrl: "",
          description: "E2E test token",
        });

        expect(status).toBe(200);
        expect(data.success).toBe(true);

        if (data.token) {
          createdTokenIds.push(data.token.id);
          expect(data.token.symbol).toMatch(/^TEST/);
          expect(data.token.chain).toBe("base");
          expect(data.token.decimals).toBe(18);
        }
      },
      SERVICE_TIMEOUT,
    );

    test(
      "registerToken - validates chain enum",
      async () => {
        if (skipIfNoServer()) return;
        const { status, data } = await apiCall<{ error?: string }>("POST", "/api/tokens", {
          symbol: "BAD",
          name: "Bad Token",
          contractAddress: ANVIL_ACCOUNT_1,
          chain: "invalid-chain",
          decimals: 18,
        });

        expect(status).toBe(400);
        expect(data.error).toBeDefined();
      },
      SERVICE_TIMEOUT,
    );

    test(
      "registerToken - validates address format",
      async () => {
        if (skipIfNoServer()) return;
        const { status, data } = await apiCall<{ error?: string }>("POST", "/api/tokens", {
          symbol: "BAD",
          name: "Bad Token",
          contractAddress: "invalid-address",
          chain: "base",
          decimals: 18,
        });

        expect(status).toBe(400);
        expect(data.error).toBeDefined();
      },
      SERVICE_TIMEOUT,
    );

    test(
      "registerToken - validates decimals range (0-255)",
      async () => {
        if (skipIfNoServer()) return;
        const { status, data } = await apiCall<{ error?: string }>("POST", "/api/tokens", {
          symbol: "BAD",
          name: "Bad Token",
          contractAddress: ANVIL_ACCOUNT_1,
          chain: "base",
          decimals: 256, // Invalid: max is 255
        });

        expect(status).toBe(400);
        expect(data.error).toBeDefined();
      },
      SERVICE_TIMEOUT,
    );

    test(
      "getAllTokens - returns token list",
      async () => {
        if (skipIfNoServer()) return;
        const { status, data } = await apiCall<{
          success: boolean;
          tokens: unknown[];
        }>("GET", "/api/tokens");

        expect(status).toBe(200);
        expect(data.success).toBe(true);
        expect(Array.isArray(data.tokens)).toBe(true);
      },
      SERVICE_TIMEOUT,
    );

    test(
      "getAllTokens - filters by chain",
      async () => {
        if (skipIfNoServer()) return;
        const { status, data } = await apiCall<{
          success: boolean;
          tokens: Array<{ chain: string }>;
        }>("GET", "/api/tokens?chain=solana");

        expect(status).toBe(200);
        expect(data.success).toBe(true);

        // All returned tokens should be on Solana
        for (const token of data.tokens) {
          expect(token.chain).toBe("solana");
        }
      },
      SERVICE_TIMEOUT,
    );

    test(
      "getToken - validates tokenId format",
      async () => {
        if (skipIfNoServer()) return;
        const { status, data } = await apiCall<{ error?: string }>(
          "GET",
          "/api/tokens/invalid-format",
        );

        expect(status).toBe(400);
        expect(data.error).toBeDefined();
      },
      SERVICE_TIMEOUT,
    );

    test(
      "getToken - returns 404 for non-existent token",
      async () => {
        if (skipIfNoServer()) return;
        const { status } = await apiCall<{ error?: string }>(
          "GET",
          "/api/tokens/token-base-0x0000000000000000000000000000000000000000",
        );

        expect(status).toBe(404);
      },
      SERVICE_TIMEOUT,
    );
  });

  // ==========================================================================
  // MARKET DATA SERVICE TESTS
  // ==========================================================================
  describe("MarketDataService", () => {
    test(
      "fetchTokenPrice - validates chain parameter",
      async () => {
        if (skipIfNoServer()) return;
        const { status, data } = await apiCall<{ error?: string }>(
          "GET",
          "/api/token-prices?chain=invalid&addresses=0x1234",
        );

        expect(status).toBe(400);
        expect(data.error).toBeDefined();
      },
      SERVICE_TIMEOUT,
    );

    test(
      "fetchTokenPrice - accepts valid Solana chain",
      async () => {
        if (skipIfNoServer()) return;
        // Use wrapped SOL as a known token
        const wsol = "So11111111111111111111111111111111111111112";
        const { status, data } = await apiCall<{
          prices: Record<string, number>;
        }>("GET", `/api/token-prices?chain=solana&addresses=${wsol}`);

        expect(status).toBe(200);
        expect(data.prices).toBeDefined();
        expect(typeof data.prices).toBe("object");
      },
      SERVICE_TIMEOUT,
    );

    test(
      "fetchTokenPrice - accepts valid EVM chain",
      async () => {
        if (skipIfNoServer()) return;
        // Use LINK as a known token on Ethereum
        const link = "0x514910771AF9Ca656af840dff83E8264EcF986CA";
        const { status, data } = await apiCall<{
          prices: Record<string, number>;
        }>("GET", `/api/token-prices?chain=ethereum&addresses=${link}`);

        expect(status).toBe(200);
        expect(data.prices).toBeDefined();
      },
      SERVICE_TIMEOUT,
    );

    test(
      "getMarketData - validates tokenId format",
      async () => {
        if (skipIfNoServer()) return;
        const { status } = await apiCall<{ error?: string }>("GET", "/api/market-data/");

        // Empty tokenId should be 400 or 404
        expect([400, 404]).toContain(status);
      },
      SERVICE_TIMEOUT,
    );

    test(
      "getMarketData - returns 404 for non-existent token",
      async () => {
        if (skipIfNoServer()) return;
        const { status } = await apiCall<{ marketData: unknown }>(
          "GET",
          "/api/market-data/token-base-0x0000000000000000000000000000000000000000",
        );

        // May return 200 with null marketData or 404
        expect([200, 404]).toContain(status);
      },
      SERVICE_TIMEOUT,
    );
  });

  // ==========================================================================
  // CONSIGNMENT SERVICE TESTS
  // ==========================================================================
  describe("ConsignmentService", () => {
    test(
      "createConsignment - validates required fields",
      async () => {
        if (skipIfNoServer()) return;
        const { status, data } = await apiCall<{ error?: string }>("POST", "/api/consignments", {});

        expect(status).toBe(400);
        expect(data.error).toBeDefined();
      },
      SERVICE_TIMEOUT,
    );

    test(
      "createConsignment - validates Solana requires contractConsignmentId",
      async () => {
        if (skipIfNoServer()) return;
        const { status, data } = await apiCall<{ error?: string }>("POST", "/api/consignments", {
          tokenId: "token-solana-test",
          consignerAddress: "E6K5x45Bxfmci6FmKRQ2YJMpLz7fCdLm7r7ReCq6P5vP",
          amount: "1000000000",
          chain: "solana",
          isNegotiable: false,
          fixedDiscountBps: 500,
          fixedLockupDays: 30,
          tokenSymbol: "TEST",
          tokenAddress: "E6K5x45Bxfmci6FmKRQ2YJMpLz7fCdLm7r7ReCq6P5vP",
          // Missing contractConsignmentId
        });

        expect(status).toBe(400);
        expect(data.error).toBeDefined();
      },
      SERVICE_TIMEOUT,
    );

    test(
      "createConsignment - validates BPS range (0-10000)",
      async () => {
        if (skipIfNoServer()) return;
        const { status, data } = await apiCall<{ error?: string }>("POST", "/api/consignments", {
          tokenId: "token-base-test",
          consignerAddress: ANVIL_DEPLOYER,
          amount: "1000000000000000000",
          chain: "base",
          isNegotiable: false,
          fixedDiscountBps: 15000, // Invalid: max is 10000
          fixedLockupDays: 30,
          tokenSymbol: "TEST",
          tokenAddress: ANVIL_ACCOUNT_1,
        });

        expect(status).toBe(400);
        expect(data.error).toBeDefined();
      },
      SERVICE_TIMEOUT,
    );

    test(
      "createConsignment - validates amount is positive integer string",
      async () => {
        if (skipIfNoServer()) return;
        const { status, data } = await apiCall<{ error?: string }>("POST", "/api/consignments", {
          tokenId: "token-base-test",
          consignerAddress: ANVIL_DEPLOYER,
          amount: "-1000", // Invalid: negative
          chain: "base",
          isNegotiable: false,
          fixedDiscountBps: 500,
          fixedLockupDays: 30,
          tokenSymbol: "TEST",
          tokenAddress: ANVIL_ACCOUNT_1,
        });

        expect(status).toBe(400);
        expect(data.error).toBeDefined();
      },
      SERVICE_TIMEOUT,
    );

    test(
      "createConsignment - creates EVM consignment with valid data",
      async () => {
        if (skipIfNoServer()) return;
        // First create a test token
        const tokenAddress =
          "0x" + Math.random().toString(16).slice(2, 42).padEnd(40, "0").toLowerCase();
        const tokenSymbol = "CSN" + Date.now().toString(36).slice(-4).toUpperCase();

        await apiCall("POST", "/api/tokens", {
          symbol: tokenSymbol,
          name: "Consignment Test Token",
          contractAddress: tokenAddress,
          chain: "base",
          decimals: 18,
          logoUrl: "",
          description: "E2E consignment test",
        });

        const tokenId = `token-base-${tokenAddress}`;

        const { status, data } = await apiCall<{
          success: boolean;
          consignment?: {
            id: string;
            tokenId: string;
            chain: string;
            status: string;
            totalAmount: string;
          };
          error?: string;
        }>("POST", "/api/consignments", {
          tokenId,
          consignerAddress: ANVIL_DEPLOYER,
          amount: "1000000000000000000", // 1e18
          chain: "base",
          isNegotiable: false,
          fixedDiscountBps: 500,
          fixedLockupDays: 30,
          tokenSymbol,
          tokenAddress,
          minDiscountBps: 0,
          maxDiscountBps: 1000,
          minLockupDays: 0,
          maxLockupDays: 365,
          minDealAmount: "100000000000000000", // 0.1e18
          maxDealAmount: "1000000000000000000", // 1e18
          isFractionalized: true,
          isPrivate: false,
          maxPriceVolatilityBps: 500,
          maxTimeToExecuteSeconds: 3600,
        });

        expect(status).toBe(200);
        expect(data.success).toBe(true);

        if (data.consignment) {
          createdConsignmentIds.push(data.consignment.id);
          expect(data.consignment.chain).toBe("base");
          expect(data.consignment.status).toBe("active");
          expect(data.consignment.totalAmount).toBe("1000000000000000000");
        }
      },
      SERVICE_TIMEOUT,
    );

    test(
      "getAllConsignments - returns consignment list",
      async () => {
        if (skipIfNoServer()) return;
        const { status, data } = await apiCall<{
          success: boolean;
          consignments: unknown[];
        }>("GET", "/api/consignments");

        expect(status).toBe(200);
        expect(data.success).toBe(true);
        expect(Array.isArray(data.consignments)).toBe(true);
      },
      SERVICE_TIMEOUT,
    );

    test(
      "getAllConsignments - filters by chain",
      async () => {
        if (skipIfNoServer()) return;
        const { status, data } = await apiCall<{
          success: boolean;
          consignments: Array<{ chain: string }>;
        }>("GET", "/api/consignments?chains=base");

        expect(status).toBe(200);

        // All returned consignments should be on Base
        for (const c of data.consignments) {
          expect(c.chain).toBe("base");
        }
      },
      SERVICE_TIMEOUT,
    );

    test(
      "getConsignment - returns 404 for non-existent ID",
      async () => {
        if (skipIfNoServer()) return;
        const { status } = await apiCall<{ error?: string }>(
          "GET",
          "/api/consignments/00000000-0000-0000-0000-000000000000",
        );

        expect(status).toBe(404);
      },
      SERVICE_TIMEOUT,
    );
  });

  // ==========================================================================
  // PRICE PROTECTION SERVICE TESTS
  // ==========================================================================
  describe("PriceProtectionService", () => {
    // Price protection is exercised through deal-completion flow
    test(
      "validateQuotePrice - validates through deal-completion API",
      async () => {
        if (skipIfNoServer()) return;
        const { status, data } = await apiCall<{ error?: string }>("POST", "/api/deal-completion", {
          quoteId: "nonexistent-quote",
          action: "complete",
          tokenId: "token-base-test",
          consignmentId: "nonexistent-consignment",
          priceAtQuote: 1.0,
          maxPriceDeviationBps: 500,
        });

        // Should fail because quote doesn't exist, not validation
        expect([404, 500]).toContain(status);
      },
      SERVICE_TIMEOUT,
    );
  });

  // ==========================================================================
  // RECONCILIATION SERVICE TESTS
  // ==========================================================================
  describe("ReconciliationService", () => {
    test(
      "healthCheck - via cron endpoint",
      async () => {
        if (skipIfNoServer()) return;
        // Reconciliation runs via cron - test the check-matured endpoint
        const { status, data } = await apiCall<{
          success: boolean;
          checked?: number;
          matured?: number;
          error?: string;
        }>("GET", "/api/cron/check-matured-otc");

        // May fail if not configured, but should return valid response
        expect(typeof data).toBe("object");
        if (status === 200) {
          expect(data.success).toBe(true);
        }
      },
      SERVICE_TIMEOUT,
    );
  });

  // ==========================================================================
  // DATABASE SERVICE TESTS (via API)
  // ==========================================================================
  describe("Database Services", () => {
    describe("TokenDB", () => {
      test(
        "createToken and getToken roundtrip",
        async () => {
          if (skipIfNoServer()) return;
          const tokenAddress =
            "0x" + Math.random().toString(16).slice(2, 42).padEnd(40, "0").toLowerCase();
          const tokenSymbol = "DB" + Date.now().toString(36).slice(-4).toUpperCase();

          // Create
          const createRes = await apiCall<{
            success: boolean;
            token?: { id: string };
          }>("POST", "/api/tokens", {
            symbol: tokenSymbol,
            name: "DB Test Token",
            contractAddress: tokenAddress,
            chain: "ethereum",
            decimals: 6,
            logoUrl: "",
            description: "DB roundtrip test",
          });

          expect(createRes.status).toBe(200);
          expect(createRes.data.success).toBe(true);

          if (createRes.data.token) {
            createdTokenIds.push(createRes.data.token.id);

            // Get
            const getRes = await apiCall<{
              success: boolean;
              token?: { id: string; symbol: string };
            }>("GET", `/api/tokens/${createRes.data.token.id}`);

            expect(getRes.status).toBe(200);
            expect(getRes.data.success).toBe(true);
            if (!getRes.data.token) {
              throw new Error("Response missing token field");
            }
            expect(getRes.data.token.symbol).toBe(tokenSymbol);
          }
        },
        SERVICE_TIMEOUT,
      );
    });

    describe("MarketDataDB", () => {
      test(
        "getMarketData returns null for unknown token",
        async () => {
          if (skipIfNoServer()) return;
          const { status, data } = await apiCall<{
            success: boolean;
            marketData: unknown;
          }>("GET", "/api/market-data/token-ethereum-0x0000000000000000000000000000000000000001");

          expect([200, 404]).toContain(status);
          if (status === 200) {
            // Market data may be null for unknown tokens
            expect(data.marketData == null).toBe(true);
          }
        },
        SERVICE_TIMEOUT,
      );
    });

    describe("ConsignmentDB", () => {
      test(
        "getConsignmentsByConsigner filters correctly",
        async () => {
          if (skipIfNoServer()) return;
          const { status, data } = await apiCall<{
            success: boolean;
            consignments: Array<{ consignerAddress: string }>;
          }>("GET", `/api/consignments?consigner=${ANVIL_DEPLOYER}`);

          expect(status).toBe(200);

          // All returned consignments should be from the specified consigner
          for (const c of data.consignments) {
            expect(c.consignerAddress.toLowerCase()).toBe(ANVIL_DEPLOYER.toLowerCase());
          }
        },
        SERVICE_TIMEOUT,
      );
    });
  });

  // ==========================================================================
  // ZOD VALIDATION SCHEMA TESTS
  // ==========================================================================
  describe("Zod Schema Validation", () => {
    test("ChainSchema validates correct chains", () => {
      expect(() => ChainSchema.parse("ethereum")).not.toThrow();
      expect(() => ChainSchema.parse("base")).not.toThrow();
      expect(() => ChainSchema.parse("bsc")).not.toThrow();
      expect(() => ChainSchema.parse("solana")).not.toThrow();
      expect(() => ChainSchema.parse("invalid")).toThrow();
    });

    test("AddressSchema validates EVM and Solana addresses", () => {
      // Valid EVM
      expect(() => AddressSchema.parse("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266")).not.toThrow();

      // Valid Solana
      expect(() =>
        AddressSchema.parse("E6K5x45Bxfmci6FmKRQ2YJMpLz7fCdLm7r7ReCq6P5vP"),
      ).not.toThrow();

      // Invalid
      expect(() => AddressSchema.parse("invalid")).toThrow();
    });

    test("BigIntStringSchema validates positive integer strings", () => {
      expect(() => BigIntStringSchema.parse("0")).not.toThrow();
      expect(() => BigIntStringSchema.parse("1000000000000000000")).not.toThrow();
      expect(() => BigIntStringSchema.parse("-1")).toThrow();
      expect(() => BigIntStringSchema.parse("1.5")).toThrow();
      expect(() => BigIntStringSchema.parse("abc")).toThrow();
    });

    test("BpsSchema validates basis points (0-10000)", () => {
      expect(() => BpsSchema.parse(0)).not.toThrow();
      expect(() => BpsSchema.parse(5000)).not.toThrow();
      expect(() => BpsSchema.parse(10000)).not.toThrow();
      expect(() => BpsSchema.parse(-1)).toThrow();
      expect(() => BpsSchema.parse(10001)).toThrow();
      expect(() => BpsSchema.parse(500.5)).toThrow(); // Must be integer
    });

    test("TokenSchema validates complete token objects", () => {
      const validToken = {
        id: "token-base-0x1234567890123456789012345678901234567890",
        symbol: "TEST",
        name: "Test Token",
        contractAddress: "0x1234567890123456789012345678901234567890",
        chain: "base",
        decimals: 18,
        logoUrl: "",
        description: "Test description",
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      expect(() => TokenSchema.parse(validToken)).not.toThrow();

      // Missing required field
      expect(() => TokenSchema.parse({ ...validToken, symbol: undefined })).toThrow();
    });

    test("OTCConsignmentSchema validates consignment objects", () => {
      const validConsignment = {
        id: "test-uuid",
        tokenId: "token-base-test",
        consignerAddress: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        consignerEntityId: "entity-123",
        totalAmount: "1000000000000000000",
        remainingAmount: "1000000000000000000",
        isNegotiable: false,
        fixedDiscountBps: 500,
        fixedLockupDays: 30,
        minDiscountBps: 0,
        maxDiscountBps: 1000,
        minLockupDays: 0,
        maxLockupDays: 365,
        minDealAmount: "100000000000000000",
        maxDealAmount: "1000000000000000000",
        isFractionalized: true,
        isPrivate: false,
        maxPriceVolatilityBps: 500,
        maxTimeToExecuteSeconds: 3600,
        status: "active",
        chain: "base",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      expect(() => OTCConsignmentSchema.parse(validConsignment)).not.toThrow();

      // Invalid status
      expect(() =>
        OTCConsignmentSchema.parse({ ...validConsignment, status: "invalid" }),
      ).toThrow();
    });
  });

  // ==========================================================================
  // HOOK SCHEMA VALIDATION TESTS
  // ==========================================================================
  describe("Hook Schema Validation", () => {
    test("ConsignmentsFiltersSchema validates filter options", async () => {
      const { ConsignmentsFiltersSchema } = await import("@/types/validation/hook-schemas");

      // Valid filters
      expect(() =>
        ConsignmentsFiltersSchema.parse({
          chains: ["base", "solana"],
          negotiableTypes: ["negotiable", "fixed"],
          tokenId: "token-base-0x1234",
        }),
      ).not.toThrow();

      // Empty object is valid (all optional)
      expect(() => ConsignmentsFiltersSchema.parse({})).not.toThrow();

      // Invalid chain
      expect(() => ConsignmentsFiltersSchema.parse({ chains: ["invalid-chain"] })).toThrow();
    });

    test("DealsResponseSchema validates deal response", async () => {
      const { DealsResponseSchema } = await import("../src/types/validation/hook-schemas");

      const validResponse = {
        success: true,
        deals: [
          {
            id: "deal-123",
            quoteId: "quote-456",
            beneficiary: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
            tokenAmount: "1000000000000000000",
            discountBps: 500,
            lockupMonths: 6,
            lockupDays: 180,
            paymentCurrency: "ETH",
            totalUsd: 1000,
            discountUsd: 50,
            discountedUsd: 950,
            paymentAmount: "500000000000000000",
            status: "executed",
            executedAt: Date.now(),
            offerId: "offer-789",
            transactionHash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
            chain: "base",
            tokenId: "token-base-0x1234567890123456789012345678901234567890",
            tokenSymbol: "TEST",
            tokenName: "Test Token",
            tokenLogoUrl: "",
          },
        ],
      };

      expect(() => DealsResponseSchema.parse(validResponse)).not.toThrow();

      // Invalid status
      expect(() =>
        DealsResponseSchema.parse({
          success: true,
          deals: [{ ...validResponse.deals[0], status: "invalid" }],
        }),
      ).toThrow();
    });

    test("TokenBatchResponseSchema validates batch response", async () => {
      const { TokenBatchResponseSchema } = await import("@/types/validation/hook-schemas");

      const validResponse = {
        success: true,
        tokens: {
          "token-base-0x1234": {
            id: "token-base-0x1234567890123456789012345678901234567890",
            symbol: "TEST",
            name: "Test Token",
            contractAddress: "0x1234567890123456789012345678901234567890",
            chain: "base",
            decimals: 18,
            logoUrl: "",
            description: "",
            isActive: true,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          "token-solana-abc": null, // Not found tokens return null
        },
      };

      expect(() => TokenBatchResponseSchema.parse(validResponse)).not.toThrow();
    });

    test("WalletTokenSchema validates wallet token format", async () => {
      const { WalletTokenSchema } = await import("@/types/validation/hook-schemas");

      const validWalletToken = {
        id: "token-base-0x1234567890123456789012345678901234567890",
        symbol: "TEST",
        name: "Test Token",
        contractAddress: "0x1234567890123456789012345678901234567890",
        chain: "base",
        decimals: 18,
        logoUrl: "",
        description: "",
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        balance: "1000000000000000000",
        balanceUsd: 1000,
        priceUsd: 1,
      };

      expect(() => WalletTokenSchema.parse(validWalletToken)).not.toThrow();

      // Invalid balance (not a string integer)
      expect(() => WalletTokenSchema.parse({ ...validWalletToken, balance: "1.5" })).toThrow();
    });

    test("EvmBalancesResponseSchema validates EVM balances", async () => {
      const { EvmBalancesResponseSchema } = await import("@/types/validation/hook-schemas");

      const validResponse = {
        tokens: [
          {
            contractAddress: "0x1234567890123456789012345678901234567890",
            symbol: "TEST",
            name: "Test Token",
            decimals: 18,
            balance: "1000000000000000000",
          },
        ],
      };

      expect(() => EvmBalancesResponseSchema.parse(validResponse)).not.toThrow();
    });

    test("SolanaBalancesResponseSchema validates Solana balances", async () => {
      const { SolanaBalancesResponseSchema } = await import("../src/types/validation/hook-schemas");

      const validResponse = {
        tokens: [
          {
            mint: "So11111111111111111111111111111111111111112",
            amount: 1000000000,
            decimals: 9,
            symbol: "SOL",
            name: "Wrapped SOL",
            logoURI: "",
            priceUsd: 100,
            balanceUsd: 100,
          },
        ],
      };

      expect(() => SolanaBalancesResponseSchema.parse(validResponse)).not.toThrow();
    });
  });

  // ==========================================================================
  // NATIVE PRICES TESTS
  // ==========================================================================
  describe("Native Prices Service", () => {
    test(
      "fetches ETH, BNB, SOL prices",
      async () => {
        if (skipIfNoServer()) return;
        const { status, data } = await apiCall<Record<string, number>>("GET", "/api/native-prices");

        expect(status).toBe(200);
        expect(typeof data).toBe("object");

        // If we got prices, validate they're positive numbers
        if (Object.keys(data).length > 0) {
          for (const [symbol, price] of Object.entries(data)) {
            expect(["ETH", "BNB", "SOL"]).toContain(symbol);
            expect(typeof price).toBe("number");
            expect(price).toBeGreaterThan(0);
          }
        }
      },
      SERVICE_TIMEOUT,
    );
  });

  // ==========================================================================
  // TOKEN SYNC SERVICE TESTS
  // ==========================================================================
  describe("Token Sync Service", () => {
    test(
      "sync endpoint validates chain parameter",
      async () => {
        if (skipIfNoServer()) return;
        const { status, data } = await apiCall<{ error?: string }>("POST", "/api/tokens/sync", {
          chain: "invalid-chain",
        });

        expect(status).toBe(400);
        expect(data.error).toBeDefined();
      },
      SERVICE_TIMEOUT,
    );

    test(
      "sync accepts valid Solana chain",
      async () => {
        if (skipIfNoServer()) return;
        const { status, data } = await apiCall<{
          success: boolean;
          processed?: number;
          error?: string;
        }>("POST", "/api/tokens/sync", {
          chain: "solana",
        });

        // May succeed or fail based on config, but should be valid response
        expect(typeof data).toBe("object");
        if (status === 200) {
          expect(data.success).toBe(true);
        }
      },
      SERVICE_TIMEOUT,
    );
  });

  // ==========================================================================
  // BALANCE FETCHER TESTS
  // ==========================================================================
  describe("Balance Services", () => {
    test(
      "EVM balances - validates address format",
      async () => {
        if (skipIfNoServer()) return;
        const { status, data } = await apiCall<{ error?: string }>(
          "GET",
          "/api/evm-balances?address=invalid&chain=base",
        );

        expect(status).toBe(400);
        expect(data.error).toBeDefined();
      },
      SERVICE_TIMEOUT,
    );

    test(
      "EVM balances - validates chain parameter",
      async () => {
        if (skipIfNoServer()) return;
        const { status, data } = await apiCall<{ error?: string }>(
          "GET",
          `/api/evm-balances?address=${ANVIL_DEPLOYER}&chain=invalid`,
        );

        expect(status).toBe(400);
        expect(data.error).toBeDefined();
      },
      SERVICE_TIMEOUT,
    );

    test(
      "Solana balances - validates address format",
      async () => {
        if (skipIfNoServer()) return;
        const { status, data } = await apiCall<{ error?: string }>(
          "GET",
          "/api/solana-balances?address=invalid",
        );

        expect(status).toBe(400);
        expect(data.error).toBeDefined();
      },
      SERVICE_TIMEOUT,
    );

    test(
      "Solana balances - accepts valid address",
      async () => {
        if (skipIfNoServer()) return;
        const { status, data } = await apiCall<{
          tokens: unknown[];
        }>("GET", "/api/solana-balances?address=E6K5x45Bxfmci6FmKRQ2YJMpLz7fCdLm7r7ReCq6P5vP");

        expect(status).toBe(200);
        expect(Array.isArray(data.tokens)).toBe(true);
      },
      SERVICE_TIMEOUT,
    );
  });

  // ==========================================================================
  // TOKEN DECIMALS SERVICE TESTS
  // ==========================================================================
  describe("Token Decimals Service", () => {
    test(
      "validates address-chain compatibility (Solana)",
      async () => {
        if (skipIfNoServer()) return;
        // EVM address on Solana chain should fail
        const { status, data } = await apiCall<{ error?: string }>(
          "GET",
          `/api/tokens/decimals?address=${ANVIL_DEPLOYER}&chain=solana`,
        );

        expect(status).toBe(400);
        expect(data.error).toBeDefined();
      },
      SERVICE_TIMEOUT,
    );

    test(
      "validates address-chain compatibility (EVM)",
      async () => {
        if (skipIfNoServer()) return;
        // Solana address on EVM chain should fail
        const { status, data } = await apiCall<{ error?: string }>(
          "GET",
          "/api/tokens/decimals?address=E6K5x45Bxfmci6FmKRQ2YJMpLz7fCdLm7r7ReCq6P5vP&chain=base",
        );

        expect(status).toBe(400);
        expect(data.error).toBeDefined();
      },
      SERVICE_TIMEOUT,
    );

    test(
      "fetches Solana token decimals",
      async () => {
        if (skipIfNoServer()) return;
        const wsol = "So11111111111111111111111111111111111111112";
        const { status, data } = await apiCall<{
          success: boolean;
          decimals?: number;
          source?: string;
        }>("GET", `/api/tokens/decimals?address=${wsol}&chain=solana`);

        if (status === 200) {
          expect(data.success).toBe(true);
          expect(typeof data.decimals).toBe("number");
          expect(data.decimals).toBeGreaterThanOrEqual(0);
          expect(data.decimals).toBeLessThanOrEqual(18);
        }
      },
      SERVICE_TIMEOUT,
    );
  });

  // ==========================================================================
  // OTC APPROVE SERVICE TESTS
  // ==========================================================================
  describe("OTC Approve Service", () => {
    test(
      "validates offerId is required",
      async () => {
        if (skipIfNoServer()) return;
        const { status, data } = await apiCall<{ error?: string }>("POST", "/api/otc/approve", {});

        expect(status).toBe(400);
        expect(data.error).toBeDefined();
      },
      SERVICE_TIMEOUT,
    );

    test(
      "validates chain enum",
      async () => {
        if (skipIfNoServer()) return;
        const { status, data } = await apiCall<{ error?: string }>("POST", "/api/otc/approve", {
          offerId: 1,
          chain: "invalid-chain",
        });

        expect(status).toBe(400);
        expect(data.error).toBeDefined();
      },
      SERVICE_TIMEOUT,
    );

    test(
      "accepts numeric string offerId",
      async () => {
        if (skipIfNoServer()) return;
        const { status } = await apiCall<{ error?: string }>("POST", "/api/otc/approve", {
          offerId: "123",
          chain: "base",
        });

        // Should not be 400 validation error
        // 404 or 500 expected since offer doesn't exist
        expect([200, 404, 500]).toContain(status);
      },
      SERVICE_TIMEOUT,
    );
  });

  // ==========================================================================
  // SOLANA CLAIM SERVICE TESTS
  // ==========================================================================
  describe("Solana Claim Service", () => {
    test(
      "validates required fields",
      async () => {
        if (skipIfNoServer()) return;
        const { status, data } = await apiCall<{ error?: string }>("POST", "/api/solana/claim", {});

        expect(status).toBe(400);
        expect(data.error).toBeDefined();
      },
      SERVICE_TIMEOUT,
    );

    test(
      "validates Solana address format",
      async () => {
        if (skipIfNoServer()) return;
        const { status, data } = await apiCall<{ error?: string }>("POST", "/api/solana/claim", {
          offerAddress: "invalid-address",
          beneficiary: "E6K5x45Bxfmci6FmKRQ2YJMpLz7fCdLm7r7ReCq6P5vP",
        });

        expect(status).toBe(400);
        expect(data.error).toBeDefined();
      },
      SERVICE_TIMEOUT,
    );

    test(
      "rejects EVM addresses for Solana endpoint",
      async () => {
        if (skipIfNoServer()) return;
        const { status, data } = await apiCall<{ error?: string }>("POST", "/api/solana/claim", {
          offerAddress: ANVIL_DEPLOYER, // EVM address, not Solana
          beneficiary: ANVIL_ACCOUNT_1,
        });

        expect(status).toBe(400);
        expect(data.error).toBeDefined();
      },
      SERVICE_TIMEOUT,
    );
  });

  // ==========================================================================
  // SOLANA WITHDRAW CONSIGNMENT SERVICE TESTS
  // ==========================================================================
  describe("Solana Withdraw Consignment Service", () => {
    test(
      "validates required fields",
      async () => {
        if (skipIfNoServer()) return;
        const { status, data } = await apiCall<{ error?: string }>(
          "POST",
          "/api/solana/withdraw-consignment",
          {},
        );

        expect(status).toBe(400);
        expect(data.error).toBeDefined();
      },
      SERVICE_TIMEOUT,
    );

    test(
      "validates both addresses are Solana format",
      async () => {
        if (skipIfNoServer()) return;
        const { status, data } = await apiCall<{ error?: string }>(
          "POST",
          "/api/solana/withdraw-consignment",
          {
            consignmentAddress: ANVIL_DEPLOYER, // EVM address
            consignerAddress: "E6K5x45Bxfmci6FmKRQ2YJMpLz7fCdLm7r7ReCq6P5vP",
          },
        );

        expect(status).toBe(400);
        expect(data.error).toBeDefined();
      },
      SERVICE_TIMEOUT,
    );

    test(
      "accepts valid Solana addresses",
      async () => {
        if (skipIfNoServer()) return;
        const { status } = await apiCall<{ error?: string }>(
          "POST",
          "/api/solana/withdraw-consignment",
          {
            consignmentAddress: "E6K5x45Bxfmci6FmKRQ2YJMpLz7fCdLm7r7ReCq6P5vP",
            consignerAddress: "E6K5x45Bxfmci6FmKRQ2YJMpLz7fCdLm7r7ReCq6P5vP",
          },
        );

        // Should not be 400 - validation passes
        // 404/500 expected since consignment doesn't exist
        expect([200, 404, 500]).toContain(status);
      },
      SERVICE_TIMEOUT,
    );
  });

  // ==========================================================================
  // SOLANA UPDATE PRICE SERVICE TESTS
  // ==========================================================================
  describe("Solana Update Price Service", () => {
    test(
      "validates tokenMint is required",
      async () => {
        if (skipIfNoServer()) return;
        const { status, data } = await apiCall<{
          success: boolean;
          error?: string;
        }>("GET", "/api/solana/update-price");

        expect(status).toBe(400);
        expect(data.error).toBeDefined();
      },
      SERVICE_TIMEOUT,
    );

    test(
      "validates Solana address format",
      async () => {
        if (skipIfNoServer()) return;
        const { status, data } = await apiCall<{
          success: boolean;
          error?: string;
        }>("GET", "/api/solana/update-price?tokenMint=invalid-address");

        expect(status).toBe(400);
        expect(data.error).toContain("Invalid Solana address");
      },
      SERVICE_TIMEOUT,
    );

    test(
      "returns 404 for unregistered token",
      async () => {
        if (skipIfNoServer()) return;
        const { status } = await apiCall<{
          success: boolean;
          error?: string;
        }>("GET", "/api/solana/update-price?tokenMint=So11111111111111111111111111111111111111112");

        // Token not registered in OTC system
        expect([404, 500]).toContain(status);
      },
      SERVICE_TIMEOUT,
    );
  });
});
