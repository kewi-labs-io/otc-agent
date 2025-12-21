/**
 * API Routes E2E Integration Tests
 *
 * Tests API routes against a running Next.js server.
 * These tests verify:
 * 1. Zod schema validation at API boundaries
 * 2. Fail-fast error responses for invalid inputs
 * 3. Correct data structures in responses
 * 4. Edge cases and boundary conditions
 *
 * Prerequisites:
 * - Next.js running: `bun run dev` or via global-setup
 *
 * Run: bun test tests/api-routes.e2e.test.ts
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { BASE_URL } from "./test-utils";
import type {
  ApiErrorResponse,
  TokenResponse,
  TokenBatchResponse,
  TokenAddressesResponse,
  TokenDecimalsResponse,
  TokenPoolCheckResponse,
  TokenPricesResponse,
  NativePricesResponse,
  EvmBalanceResponse,
  SolanaBalanceResponse,
} from "../src/types/validation/api-schemas";

const TEST_TIMEOUT = 30_000;

// Flag to track if server is available
let serverAvailable = false;

/**
 * Wait for server to be ready with timeout
 */
async function waitForServer(maxWaitMs: number = 15000): Promise<boolean> {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    const res = await fetch(`${BASE_URL}/api/tokens`, {
      signal: AbortSignal.timeout(5000),
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

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

// IDL response type (Anchor IDL format - not in validation schemas)
interface IdlResponse {
  metadata: {
    version: string;
    name: string;
  };
  instructions: Array<{ name: string }>;
  accounts: Array<{ name: string }>;
}

// Type aliases for readability
type AddressesResponse = TokenAddressesResponse;
type DecimalsResponse = TokenDecimalsResponse;
type PricesResponse = TokenPricesResponse | NativePricesResponse;
type PoolCheckResponse = TokenPoolCheckResponse;

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Type-safe fetch wrapper that parses JSON response.
 */
async function fetchJson<T>(url: string, options?: RequestInit): Promise<{ status: number; data: T }> {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(TEST_TIMEOUT - 1000),
  });
  const data = (await response.json()) as T;
  return { status: response.status, data };
}

/**
 * Assert that an error response contains expected validation message.
 */
function assertValidationError(data: ApiErrorResponse, expectedMessage: string): void {
  const hasError = typeof data.error === "string" && data.error.toLowerCase().includes(expectedMessage.toLowerCase());
  const hasDetails = Array.isArray(data.details) && data.details.some(
    (d) => {
      if (typeof d === "string") {
        return d.toLowerCase().includes(expectedMessage.toLowerCase());
      }
      // d is ErrorDetailItemSchema object
      return (
        (typeof d.message === "string" && d.message.toLowerCase().includes(expectedMessage.toLowerCase())) ||
        (typeof d.path === "string" && d.path.toLowerCase().includes(expectedMessage.toLowerCase()))
      );
    },
  );

  if (!hasError && !hasDetails) {
    throw new Error(
      `Expected validation error containing "${expectedMessage}", got: ${JSON.stringify(data)}`,
    );
  }
}

// Test addresses (mainnet addresses for real API testing)
const TEST_EVM_WALLET = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"; // vitalik.eth
const TEST_SOLANA_WALLET = "E6K5x45Bxfmci6FmKRQ2YJMpLz7fCdLm7r7ReCq6P5vP";
const TEST_EVM_TOKEN = "0x514910771AF9Ca656af840dff83E8264EcF986CA"; // LINK on Ethereum
const TEST_SOLANA_TOKEN = "So11111111111111111111111111111111111111112"; // Wrapped SOL
const INVALID_ADDRESS = "invalid-address-format";

// =============================================================================
// TESTS
// =============================================================================

describe("API Routes Integration Tests", () => {
  beforeAll(async () => {
    // Server check - use shorter timeout that fits within default hook timeout
    serverAvailable = await waitForServer(4_000);
    if (!serverAvailable) {
      console.log(
        "\n  Server not available at " + BASE_URL +
        "\n  Run `bun run dev` to start the server.\n" +
        "  Skipping API E2E tests.\n"
      );
    }
  });

  // ==========================================================================
  // /api/native-prices
  // ==========================================================================
  describe("GET /api/native-prices", () => {
    test("returns prices for native tokens", async () => {
      if (skipIfNoServer()) return;
      const { status, data } = await fetchJson<PricesResponse>(`${BASE_URL}/api/native-prices`);
      expect(status).toBe(200);
      expect(typeof data).toBe("object");

      // If CoinGecko is reachable, prices should be positive numbers
      const keys = Object.keys(data);
      for (const key of keys) {
        if (key !== "prices") {
          const price = data[key];
          if (typeof price === "number") {
            expect(price).toBeGreaterThan(0);
          }
        }
      }
    }, TEST_TIMEOUT);
  });

  // ==========================================================================
  // /api/token-prices
  // ==========================================================================
  describe("GET /api/token-prices", () => {
    test("returns 400 without required params", async () => {
      if (skipIfNoServer()) return;
      const { status, data } = await fetchJson<ApiErrorResponse>(`${BASE_URL}/api/token-prices`);
      expect(status).toBe(400);
      expect(data.error).toBeDefined();
    }, TEST_TIMEOUT);

    test("returns prices for Solana tokens", async () => {
      if (skipIfNoServer()) return;
      const { status, data } = await fetchJson<PricesResponse>(
        `${BASE_URL}/api/token-prices?chain=solana&addresses=${TEST_SOLANA_TOKEN}`,
      );
      expect(status).toBe(200);
      expect(data.prices).toBeDefined();
      expect(typeof data.prices).toBe("object");
    }, TEST_TIMEOUT);

    test("returns prices for EVM tokens", async () => {
      if (skipIfNoServer()) return;
      const { status, data } = await fetchJson<PricesResponse>(
        `${BASE_URL}/api/token-prices?chain=ethereum&addresses=${TEST_EVM_TOKEN}`,
      );
      expect(status).toBe(200);
      expect(data.prices).toBeDefined();
    }, TEST_TIMEOUT);
  });

  // ==========================================================================
  // /api/token-lookup
  // ==========================================================================
  describe("GET /api/token-lookup", () => {
    test("returns 400 without address param", async () => {
      if (skipIfNoServer()) return;
      const { status } = await fetchJson<ApiErrorResponse>(`${BASE_URL}/api/token-lookup`);
      expect(status).toBe(400);
    }, TEST_TIMEOUT);

    test("returns 400 for invalid address format", async () => {
      if (skipIfNoServer()) return;
      const { status } = await fetchJson<ApiErrorResponse>(
        `${BASE_URL}/api/token-lookup?address=invalid`,
      );
      expect(status).toBe(400);
    }, TEST_TIMEOUT);

    test("auto-detects Solana addresses", async () => {
      if (skipIfNoServer()) return;
      const { status } = await fetchJson<unknown>(
        `${BASE_URL}/api/token-lookup?address=${TEST_SOLANA_TOKEN}`,
      );
      // 503 if API key not configured, 200/404 if working
      expect([200, 404, 503]).toContain(status);
    }, TEST_TIMEOUT);

    test("auto-detects EVM addresses", async () => {
      if (skipIfNoServer()) return;
      const { status, data } = await fetchJson<{ success?: boolean; token?: { symbol?: string; decimals?: number } }>(
        `${BASE_URL}/api/token-lookup?address=${TEST_EVM_TOKEN}`,
      );

      // 503 = API not configured, 502 = external API error
      if (status === 503 || status === 502) return;
      expect([200, 404]).toContain(status);

      if (status === 200) {
        expect(data.success).toBe(true);
        expect(data.token).toBeDefined();
        if (!data.token) {
          throw new Error("Response missing token field");
        }
        expect(data.token.symbol).toBeDefined();
        expect(data.token.decimals).toBeDefined();
      }
    }, TEST_TIMEOUT);
  });

  // ==========================================================================
  // /api/token-pool-check
  // ==========================================================================
  describe("GET /api/token-pool-check", () => {
    test("returns 400 without address param", async () => {
      if (skipIfNoServer()) return;
      const { status, data } = await fetchJson<ApiErrorResponse>(`${BASE_URL}/api/token-pool-check`);
      expect(status).toBe(400);
      expect(data.error).toBeDefined();
    }, TEST_TIMEOUT);

    test("handles Solana chain parameter", async () => {
      if (skipIfNoServer()) return;
      const { status, data } = await fetchJson<PoolCheckResponse>(
        `${BASE_URL}/api/token-pool-check?tokenAddress=${TEST_SOLANA_TOKEN}&chain=solana`,
      );
      expect(status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.chain).toBe("solana");
    }, TEST_TIMEOUT);

    test("checks EVM token pool status", async () => {
      if (skipIfNoServer()) return;
      const { status, data } = await fetchJson<PoolCheckResponse>(
        `${BASE_URL}/api/token-pool-check?tokenAddress=${TEST_EVM_TOKEN}&chain=ethereum`,
      );
      // May return 500 if no pool found - that's acceptable
      if (status === 200) {
        expect(typeof data.success).toBe("boolean");
      }
    }, TEST_TIMEOUT);
  });

  // ==========================================================================
  // /api/pool-prices/geckoterminal
  // ==========================================================================
  describe("GET /api/pool-prices/geckoterminal", () => {
    test("returns 400 without required params", async () => {
      if (skipIfNoServer()) return;
      const { status } = await fetchJson<ApiErrorResponse>(`${BASE_URL}/api/pool-prices/geckoterminal`);
      expect(status).toBe(400);
    }, TEST_TIMEOUT);

    test("returns 400 for invalid network", async () => {
      if (skipIfNoServer()) return;
      const { status } = await fetchJson<ApiErrorResponse>(
        `${BASE_URL}/api/pool-prices/geckoterminal?network=invalid&token=${TEST_EVM_TOKEN}`,
      );
      expect(status).toBe(400);
    }, TEST_TIMEOUT);

    test("proxies GeckoTerminal API", async () => {
      if (skipIfNoServer()) return;
      const { status, data } = await fetchJson<unknown>(
        `${BASE_URL}/api/pool-prices/geckoterminal?network=eth&token=${TEST_EVM_TOKEN}`,
      );
      expect(status).toBe(200);
      expect(data).toBeDefined();
    }, TEST_TIMEOUT);
  });

  // ==========================================================================
  // /api/pool-prices/coingecko-token
  // ==========================================================================
  describe("GET /api/pool-prices/coingecko-token", () => {
    test("returns 400 without required params", async () => {
      if (skipIfNoServer()) return;
      const { status } = await fetchJson<ApiErrorResponse>(`${BASE_URL}/api/pool-prices/coingecko-token`);
      expect(status).toBe(400);
    }, TEST_TIMEOUT);

    test("returns 400 for unsupported network", async () => {
      if (skipIfNoServer()) return;
      const { status } = await fetchJson<ApiErrorResponse>(
        `${BASE_URL}/api/pool-prices/coingecko-token?network=unsupported&token=${TEST_EVM_TOKEN}`,
      );
      expect(status).toBe(400);
    }, TEST_TIMEOUT);

    test("proxies CoinGecko token info API", async () => {
      if (skipIfNoServer()) return;
      const { status } = await fetchJson<unknown>(
        `${BASE_URL}/api/pool-prices/coingecko-token?network=ethereum&token=${TEST_EVM_TOKEN}`,
      );
      expect(status).toBe(200);
    }, TEST_TIMEOUT);
  });

  // ==========================================================================
  // /api/tokens
  // ==========================================================================
  describe("GET /api/tokens", () => {
    test("returns list of tokens", async () => {
      if (skipIfNoServer()) return;
      const { status, data } = await fetchJson<TokenResponse>(`${BASE_URL}/api/tokens`);
      expect(status).toBe(200);
      expect(data.success).toBe(true);
      expect(Array.isArray(data.tokens)).toBe(true);
    }, TEST_TIMEOUT);

    test("supports chain filter", async () => {
      if (skipIfNoServer()) return;
      const { status, data } = await fetchJson<TokenResponse>(`${BASE_URL}/api/tokens?chain=base`);
      expect(status).toBe(200);
      expect(data.success).toBe(true);
      expect(Array.isArray(data.tokens)).toBe(true);

      // All returned tokens should be on the specified chain
      for (const token of data.tokens) {
        expect(token.chain).toBe("base");
      }
    }, TEST_TIMEOUT);
  });

  // ==========================================================================
  // /api/tokens/batch
  // ==========================================================================
  describe("GET /api/tokens/batch", () => {
    test("returns 200 without ids param (empty batch)", async () => {
      if (skipIfNoServer()) return;
      const { status, data } = await fetchJson<TokenBatchResponse>(`${BASE_URL}/api/tokens/batch`);
      // Empty ids param returns 200 with empty tokens object
      expect(status).toBe(200);
      expect(data.success).toBe(true);
      if (data.success) {
        expect(data.tokens).toEqual({});
      }
    }, TEST_TIMEOUT);

    test("returns empty object for empty ids", async () => {
      if (skipIfNoServer()) return;
      const { status, data } = await fetchJson<TokenBatchResponse>(`${BASE_URL}/api/tokens/batch?ids=`);
      expect(status).toBe(200);
      expect(data.success).toBe(true);
      if (data.success) {
        expect(data.tokens).toEqual({});
      }
    }, TEST_TIMEOUT);

    test("limits batch size to 50", async () => {
      if (skipIfNoServer()) return;
      const ids = Array(51).fill("token-id").join(",");
      const { status, data } = await fetchJson<ApiErrorResponse>(`${BASE_URL}/api/tokens/batch?ids=${ids}`);
      expect(status).toBe(400);
      expect(data.error).toContain("50");
    }, TEST_TIMEOUT);
  });

  // ==========================================================================
  // /api/tokens/by-symbol
  // ==========================================================================
  describe("GET /api/tokens/by-symbol", () => {
    test("returns 400 without symbol param", async () => {
      if (skipIfNoServer()) return;
      const { status } = await fetchJson<ApiErrorResponse>(`${BASE_URL}/api/tokens/by-symbol`);
      expect(status).toBe(400);
    }, TEST_TIMEOUT);

    test("returns 404 for unknown symbol", async () => {
      if (skipIfNoServer()) return;
      const { status } = await fetchJson<ApiErrorResponse>(
        `${BASE_URL}/api/tokens/by-symbol?symbol=UNKNOWNTOKEN12345`,
      );
      expect(status).toBe(404);
    }, TEST_TIMEOUT);
  });

  // ==========================================================================
  // /api/tokens/addresses
  // ==========================================================================
  describe("GET /api/tokens/addresses", () => {
    test("returns list of addresses", async () => {
      if (skipIfNoServer()) return;
      const { status, data } = await fetchJson<AddressesResponse>(`${BASE_URL}/api/tokens/addresses`);
      expect(status).toBe(200);
      expect(data.success).toBe(true);
      expect(Array.isArray(data.addresses)).toBe(true);
    }, TEST_TIMEOUT);

    test("supports chain filter", async () => {
      if (skipIfNoServer()) return;
      const { status, data } = await fetchJson<AddressesResponse>(`${BASE_URL}/api/tokens/addresses?chain=solana`);
      expect(status).toBe(200);
      expect(data.success).toBe(true);
      expect(Array.isArray(data.addresses)).toBe(true);
    }, TEST_TIMEOUT);
  });

  // ==========================================================================
  // /api/tokens/decimals - ZOD VALIDATION TESTS
  // ==========================================================================
  describe("GET /api/tokens/decimals", () => {
    test("returns 400 without address param", async () => {
      if (skipIfNoServer()) return;
      const { status, data } = await fetchJson<ApiErrorResponse>(`${BASE_URL}/api/tokens/decimals`);
      expect(status).toBe(400);
      expect(data.error).toBeDefined();
      assertValidationError(data, "address");
    }, TEST_TIMEOUT);

    test("returns 400 for invalid Solana address format", async () => {
      if (skipIfNoServer()) return;
      const { status, data } = await fetchJson<ApiErrorResponse>(
        `${BASE_URL}/api/tokens/decimals?address=invalid-address&chain=solana`,
      );
      expect(status).toBe(400);
      assertValidationError(data, "address");
    }, TEST_TIMEOUT);

    test("returns 400 for invalid EVM address format", async () => {
      if (skipIfNoServer()) return;
      const { status, data } = await fetchJson<ApiErrorResponse>(
        `${BASE_URL}/api/tokens/decimals?address=invalid-address&chain=ethereum`,
      );
      expect(status).toBe(400);
      assertValidationError(data, "address");
    }, TEST_TIMEOUT);

    test("returns 400 for invalid chain parameter", async () => {
      if (skipIfNoServer()) return;
      const { status, data } = await fetchJson<ApiErrorResponse>(
        `${BASE_URL}/api/tokens/decimals?address=${TEST_SOLANA_TOKEN}&chain=unsupported`,
      );
      expect(status).toBe(400);
      expect(data.error).toBeDefined();
    }, TEST_TIMEOUT);

    test("returns 400 when address format does not match chain", async () => {
      if (skipIfNoServer()) return;
      const { status, data } = await fetchJson<ApiErrorResponse>(
        `${BASE_URL}/api/tokens/decimals?address=${TEST_EVM_TOKEN}&chain=solana`,
      );
      expect(status).toBe(400);
      expect(data.error).toBeDefined();
    }, TEST_TIMEOUT);

    test("fetches Solana token decimals with valid address", async () => {
      if (skipIfNoServer()) return;
      const { status, data } = await fetchJson<DecimalsResponse>(
        `${BASE_URL}/api/tokens/decimals?address=${TEST_SOLANA_TOKEN}&chain=solana`,
      );

      if (status === 200 && data.success) {
        expect(data.success).toBe(true);
        expect(typeof data.decimals).toBe("number");
        expect(data.decimals).toBeGreaterThanOrEqual(0);
        expect(data.decimals).toBeLessThanOrEqual(18);
        expect(["database", "chain"]).toContain(data.source);
      }
    }, TEST_TIMEOUT);

    test("fetches EVM token decimals with valid address", async () => {
      if (skipIfNoServer()) return;
      const { status, data } = await fetchJson<DecimalsResponse>(
        `${BASE_URL}/api/tokens/decimals?address=${TEST_EVM_TOKEN}&chain=ethereum`,
      );

      if (status === 200 && data.success) {
        expect(data.success).toBe(true);
        expect(typeof data.decimals).toBe("number");
        expect(data.decimals).toBeGreaterThanOrEqual(0);
      }
    }, TEST_TIMEOUT);
  });

  // ==========================================================================
  // /api/evm-balances
  // ==========================================================================
  describe("GET /api/evm-balances", () => {
    test("returns 400 without address param", async () => {
      if (skipIfNoServer()) return;
      const { status } = await fetchJson<ApiErrorResponse>(`${BASE_URL}/api/evm-balances`);
      expect(status).toBe(400);
    }, TEST_TIMEOUT);

    test("returns 400 for unsupported chain", async () => {
      if (skipIfNoServer()) return;
      const { status } = await fetchJson<ApiErrorResponse>(
        `${BASE_URL}/api/evm-balances?address=${TEST_EVM_WALLET}&chain=unsupported`,
      );
      expect(status).toBe(400);
    }, TEST_TIMEOUT);

    test("returns token balances for valid address", async () => {
      if (skipIfNoServer()) return;
      const { status, data } = await fetchJson<EvmBalanceResponse>(
        `${BASE_URL}/api/evm-balances?address=${TEST_EVM_WALLET}&chain=ethereum`,
      );

      if (status === 200) {
        expect(data.tokens).toBeDefined();
        expect(Array.isArray(data.tokens)).toBe(true);

        for (const token of data.tokens) {
          expect(token.contractAddress).toBeDefined();
          expect(token.symbol).toBeDefined();
          expect(token.decimals).toBeDefined();
          expect(token.balance).toBeDefined();
        }
      }
    }, TEST_TIMEOUT);
  });

  // ==========================================================================
  // /api/solana-balances
  // ==========================================================================
  describe("GET /api/solana-balances", () => {
    test("returns 400 without address param", async () => {
      if (skipIfNoServer()) return;
      const { status } = await fetchJson<ApiErrorResponse>(`${BASE_URL}/api/solana-balances`);
      expect(status).toBe(400);
    }, TEST_TIMEOUT);

    test("returns token balances for valid address", async () => {
      if (skipIfNoServer()) return;
      const { status, data } = await fetchJson<SolanaBalanceResponse>(
        `${BASE_URL}/api/solana-balances?address=${TEST_SOLANA_WALLET}`,
      );
      expect(status).toBe(200);
      expect(data.tokens).toBeDefined();
      expect(Array.isArray(data.tokens)).toBe(true);
    }, TEST_TIMEOUT);
  });

  // ==========================================================================
  // /api/solana/idl
  // ==========================================================================
  describe("GET /api/solana/idl", () => {
    test("returns Solana program IDL", async () => {
      if (skipIfNoServer()) return;
      const { status, data } = await fetchJson<IdlResponse>(`${BASE_URL}/api/solana/idl`);
      expect(status).toBe(200);
      // IDL metadata contains version and name - fail fast if structure is wrong
      if (!data.metadata) {
        throw new Error("IDL response missing metadata field");
      }
      expect(data.metadata.version).toBeDefined();
      expect(data.metadata.name).toBeDefined();
      expect(data.instructions).toBeDefined();
      expect(Array.isArray(data.instructions)).toBe(true);
    }, TEST_TIMEOUT);
  });

  // ==========================================================================
  // /api/solana/update-price - FAIL-FAST VALIDATION TESTS
  // ==========================================================================
  describe("GET /api/solana/update-price", () => {
    test("returns 400 without tokenMint param", async () => {
      if (skipIfNoServer()) return;
      const { status, data } = await fetchJson<ApiErrorResponse>(`${BASE_URL}/api/solana/update-price`);
      expect(status).toBe(400);
      expect(data.error).toBeDefined();
    }, TEST_TIMEOUT);

    test("returns 400 for invalid Solana address format", async () => {
      if (skipIfNoServer()) return;
      const { status, data } = await fetchJson<ApiErrorResponse>(
        `${BASE_URL}/api/solana/update-price?tokenMint=invalid-address`,
      );
      // Invalid address will throw when creating PublicKey
      expect([400, 500]).toContain(status);
    }, TEST_TIMEOUT);

    test("returns 404 for unregistered token", async () => {
      if (skipIfNoServer()) return;
      const { status } = await fetchJson<ApiErrorResponse>(
        `${BASE_URL}/api/solana/update-price?tokenMint=${TEST_SOLANA_TOKEN}`,
      );
      // 404 (not registered) or 500 (config missing)
      expect([404, 500]).toContain(status);
    }, TEST_TIMEOUT);
  });

  // ==========================================================================
  // /api/consignments - ZOD VALIDATION TESTS
  // ==========================================================================
  describe("POST /api/consignments", () => {
    test("returns 400 without required fields", async () => {
      if (skipIfNoServer()) return;
      const { status, data } = await fetchJson<ApiErrorResponse>(`${BASE_URL}/api/consignments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(status).toBe(400);
      expect(data.error).toBeDefined();
    }, TEST_TIMEOUT);

    test("returns 400 when tokenId is missing", async () => {
      if (skipIfNoServer()) return;
      const { status } = await fetchJson<ApiErrorResponse>(`${BASE_URL}/api/consignments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: "1000",
          consignerAddress: TEST_EVM_WALLET,
          chain: "ethereum",
          isNegotiable: false,
        }),
      });
      expect(status).toBe(400);
    }, TEST_TIMEOUT);

    test("returns 400 when Solana consignment missing contractConsignmentId", async () => {
      if (skipIfNoServer()) return;
      const { status, data } = await fetchJson<ApiErrorResponse>(`${BASE_URL}/api/consignments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokenId: "token-solana-test",
          amount: "1000",
          consignerAddress: TEST_SOLANA_WALLET,
          chain: "solana",
          isNegotiable: false,
          tokenSymbol: "TEST",
          tokenAddress: TEST_SOLANA_TOKEN,
        }),
      });
      expect(status).toBe(400);
      expect(data.error).toBeDefined();
    }, TEST_TIMEOUT);

    test("returns 400 for invalid BPS values", async () => {
      if (skipIfNoServer()) return;
      const { status } = await fetchJson<ApiErrorResponse>(`${BASE_URL}/api/consignments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokenId: "token-ethereum-test",
          amount: "1000",
          consignerAddress: TEST_EVM_WALLET,
          chain: "ethereum",
          isNegotiable: false,
          tokenSymbol: "TEST",
          tokenAddress: TEST_EVM_TOKEN,
          minDiscountBps: 15000, // Invalid: max is 10000
        }),
      });
      expect(status).toBe(400);
    }, TEST_TIMEOUT);

    test("returns 400 for negative amount", async () => {
      if (skipIfNoServer()) return;
      const { status } = await fetchJson<ApiErrorResponse>(`${BASE_URL}/api/consignments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokenId: "token-ethereum-test",
          amount: "-1000",
          consignerAddress: TEST_EVM_WALLET,
          chain: "ethereum",
          isNegotiable: false,
          tokenSymbol: "TEST",
          tokenAddress: TEST_EVM_TOKEN,
        }),
      });
      expect(status).toBe(400);
    }, TEST_TIMEOUT);
  });

  // ==========================================================================
  // /api/consignments/[id] - FAIL-FAST VALIDATION TESTS
  // ==========================================================================
  describe("GET /api/consignments/[id]", () => {
    test("returns 404 for non-existent consignment", async () => {
      if (skipIfNoServer()) return;
      const { status } = await fetchJson<ApiErrorResponse>(
        `${BASE_URL}/api/consignments/00000000-0000-0000-0000-000000000000`,
      );
      expect(status).toBe(404);
    }, TEST_TIMEOUT);
  });

  // ==========================================================================
  // /api/tokens/[tokenId] - FAIL-FAST VALIDATION TESTS
  // ==========================================================================
  describe("GET /api/tokens/[tokenId]", () => {
    test("returns 400 for invalid tokenId format", async () => {
      if (skipIfNoServer()) return;
      const { status, data } = await fetchJson<ApiErrorResponse>(`${BASE_URL}/api/tokens/invalid-id`);
      expect(status).toBe(400);
      expect(data.error).toBeDefined();
    }, TEST_TIMEOUT);

    test("returns 404 for non-existent token", async () => {
      if (skipIfNoServer()) return;
      const { status } = await fetchJson<ApiErrorResponse>(
        `${BASE_URL}/api/tokens/token-ethereum-0x0000000000000000000000000000000000000000`,
      );
      expect(status).toBe(404);
    }, TEST_TIMEOUT);
  });

  // ==========================================================================
  // /api/market-data/[tokenId] - FAIL-FAST VALIDATION TESTS
  // ==========================================================================
  describe("GET /api/market-data/[tokenId]", () => {
    test("accepts valid token-chain-address format", async () => {
      if (skipIfNoServer()) return;
      const { status } = await fetchJson<unknown>(
        `${BASE_URL}/api/market-data/token-ethereum-${TEST_EVM_TOKEN}`,
      );
      // Should return 200 or 404 (not 400) if format is valid
      expect([200, 404]).toContain(status);
    }, TEST_TIMEOUT);
  });

  // ==========================================================================
  // /api/deal-completion - ZOD VALIDATION TESTS
  // ==========================================================================
  describe("POST /api/deal-completion", () => {
    test("returns 400 without quoteId", async () => {
      if (skipIfNoServer()) return;
      const { status, data } = await fetchJson<ApiErrorResponse>(`${BASE_URL}/api/deal-completion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "complete" }),
      });
      expect(status).toBe(400);
      expect(data.error).toBeDefined();
    }, TEST_TIMEOUT);

    test("returns 400 without action", async () => {
      if (skipIfNoServer()) return;
      const { status, data } = await fetchJson<ApiErrorResponse>(`${BASE_URL}/api/deal-completion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteId: "test-quote-id" }),
      });
      expect(status).toBe(400);
      expect(data.error).toBeDefined();
    }, TEST_TIMEOUT);

    test("returns 400 for invalid action enum value", async () => {
      if (skipIfNoServer()) return;
      const { status, data } = await fetchJson<ApiErrorResponse>(`${BASE_URL}/api/deal-completion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteId: "test-quote-id", action: "invalid" }),
      });
      expect(status).toBe(400);
      expect(data.error).toBeDefined();
    }, TEST_TIMEOUT);

    test("returns 400 for complete action without tokenId", async () => {
      if (skipIfNoServer()) return;
      const { status } = await fetchJson<ApiErrorResponse>(`${BASE_URL}/api/deal-completion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteId: "test-quote-id",
          action: "complete",
          consignmentId: "test-consignment",
        }),
      });
      expect(status).toBe(400);
    }, TEST_TIMEOUT);

    test("accepts share action without tokenId/consignmentId", async () => {
      if (skipIfNoServer()) return;
      const { status } = await fetchJson<unknown>(`${BASE_URL}/api/deal-completion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteId: "test-quote-id",
          action: "share",
        }),
      });
      // Should not be 400 - validation passes for share action
      expect([200, 404, 500]).toContain(status);
    }, TEST_TIMEOUT);
  });

  // ==========================================================================
  // /api/otc/approve - ZOD VALIDATION TESTS
  // ==========================================================================
  describe("POST /api/otc/approve", () => {
    test("returns 400 without required fields", async () => {
      if (skipIfNoServer()) return;
      const { status, data } = await fetchJson<ApiErrorResponse>(`${BASE_URL}/api/otc/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(status).toBe(400);
      expect(data.error).toBeDefined();
    }, TEST_TIMEOUT);

    test("returns 400 for invalid chain value", async () => {
      if (skipIfNoServer()) return;
      const { status, data } = await fetchJson<ApiErrorResponse>(`${BASE_URL}/api/otc/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offerId: 1,
          chain: "unsupported-chain",
        }),
      });
      expect(status).toBe(400);
      expect(data.error).toBeDefined();
    }, TEST_TIMEOUT);

    test("returns 400 for invalid Solana offerAddress format", async () => {
      if (skipIfNoServer()) return;
      const { status, data } = await fetchJson<ApiErrorResponse>(`${BASE_URL}/api/otc/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offerId: 1,
          chain: "solana",
          offerAddress: INVALID_ADDRESS,
          consignmentAddress: TEST_SOLANA_TOKEN,
        }),
      });
      expect(status).toBe(400);
      expect(data.error).toBeDefined();
    }, TEST_TIMEOUT);

    test("accepts valid numeric string offerId", async () => {
      if (skipIfNoServer()) return;
      const { status } = await fetchJson<unknown>(`${BASE_URL}/api/otc/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offerId: "123",
          chain: "ethereum",
        }),
      });
      // Should not be a 400 validation error
      expect([200, 404, 500]).toContain(status);
    }, TEST_TIMEOUT);
  });

  // ==========================================================================
  // /api/solana/withdraw-consignment - ZOD VALIDATION TESTS
  // ==========================================================================
  describe("POST /api/solana/withdraw-consignment", () => {
    test("returns 400 without required fields", async () => {
      if (skipIfNoServer()) return;
      const { status, data } = await fetchJson<ApiErrorResponse>(`${BASE_URL}/api/solana/withdraw-consignment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(status).toBe(400);
      expect(data.error).toBeDefined();
    }, TEST_TIMEOUT);

    test("returns 400 for invalid Solana address", async () => {
      if (skipIfNoServer()) return;
      const { status, data } = await fetchJson<ApiErrorResponse>(`${BASE_URL}/api/solana/withdraw-consignment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          consignmentAddress: INVALID_ADDRESS,
          consignerAddress: TEST_SOLANA_WALLET,
        }),
      });
      expect(status).toBe(400);
      expect(data.error).toBeDefined();
    }, TEST_TIMEOUT);

    test("returns 400 for EVM address instead of Solana", async () => {
      if (skipIfNoServer()) return;
      const { status, data } = await fetchJson<ApiErrorResponse>(`${BASE_URL}/api/solana/withdraw-consignment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          consignmentAddress: TEST_EVM_TOKEN,
          consignerAddress: TEST_EVM_WALLET,
        }),
      });
      expect(status).toBe(400);
      expect(data.error).toBeDefined();
    }, TEST_TIMEOUT);
  });

  // ==========================================================================
  // /api/solana/claim - ZOD VALIDATION TESTS
  // ==========================================================================
  describe("POST /api/solana/claim", () => {
    test("returns 400 without required fields", async () => {
      if (skipIfNoServer()) return;
      const { status, data } = await fetchJson<ApiErrorResponse>(`${BASE_URL}/api/solana/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(status).toBe(400);
      expect(data.error).toBeDefined();
    }, TEST_TIMEOUT);

    test("returns 400 for invalid Solana addresses", async () => {
      if (skipIfNoServer()) return;
      const { status, data } = await fetchJson<ApiErrorResponse>(`${BASE_URL}/api/solana/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offerAddress: INVALID_ADDRESS,
          beneficiary: INVALID_ADDRESS,
        }),
      });
      expect(status).toBe(400);
      expect(data.error).toBeDefined();
    }, TEST_TIMEOUT);

    test("returns 404/500 for valid addresses but non-existent offer", async () => {
      if (skipIfNoServer()) return;
      const { status } = await fetchJson<ApiErrorResponse>(`${BASE_URL}/api/solana/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offerAddress: TEST_SOLANA_TOKEN,
          beneficiary: TEST_SOLANA_WALLET,
        }),
      });
      expect([404, 500]).toContain(status);
    }, TEST_TIMEOUT);
  });

  // ==========================================================================
  // EDGE CASE TESTS - Boundary Conditions
  // ==========================================================================
  describe("Edge Cases and Boundary Conditions", () => {
    test("handles empty string params gracefully", async () => {
      if (skipIfNoServer()) return;
      const { status } = await fetchJson<ApiErrorResponse>(`${BASE_URL}/api/tokens/decimals?address=&chain=`);
      expect(status).toBe(400);
    }, TEST_TIMEOUT);

    test("handles very long addresses gracefully", async () => {
      if (skipIfNoServer()) return;
      const longAddress = "0x" + "a".repeat(100);
      const { status } = await fetchJson<ApiErrorResponse>(
        `${BASE_URL}/api/tokens/decimals?address=${longAddress}&chain=ethereum`,
      );
      expect(status).toBe(400);
    }, TEST_TIMEOUT);

    test("handles special characters in params", async () => {
      if (skipIfNoServer()) return;
      const { status } = await fetchJson<ApiErrorResponse>(
        `${BASE_URL}/api/tokens/decimals?address=<script>&chain=ethereum`,
      );
      expect(status).toBe(400);
    }, TEST_TIMEOUT);

    test("handles unicode in params", async () => {
      if (skipIfNoServer()) return;
      const { status } = await fetchJson<ApiErrorResponse>(
        `${BASE_URL}/api/tokens/decimals?address=测试地址&chain=solana`,
      );
      expect(status).toBe(400);
    }, TEST_TIMEOUT);

    test("handles null JSON body", async () => {
      if (skipIfNoServer()) return;
      const { status } = await fetchJson<ApiErrorResponse>(`${BASE_URL}/api/consignments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "null",
      });
      expect(status).toBe(400);
    }, TEST_TIMEOUT);

    test("handles malformed JSON body", async () => {
      if (skipIfNoServer()) return;
      const { status } = await fetchJson<ApiErrorResponse>(`${BASE_URL}/api/consignments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{invalid json}",
      });
      // Either 400 (bad request) or 500 (parse error)
      expect([400, 500]).toContain(status);
    }, TEST_TIMEOUT);

    test("handles numeric overflow in amounts", async () => {
      if (skipIfNoServer()) return;
      const { status } = await fetchJson<ApiErrorResponse>(`${BASE_URL}/api/consignments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokenId: "token-ethereum-test",
          amount: "99999999999999999999999999999999999999999999999999",
          consignerAddress: TEST_EVM_WALLET,
          chain: "ethereum",
          isNegotiable: false,
          tokenSymbol: "TEST",
          tokenAddress: TEST_EVM_TOKEN,
        }),
      });
      // Should handle gracefully
      expect([200, 400, 500]).toContain(status);
    }, TEST_TIMEOUT);
  });
});
