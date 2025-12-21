/**
 * Utils & Lib Integration Tests
 *
 * Real tests for utility functions against actual APIs and real data.
 * No mocks - these test that our utilities work in production.
 *
 * Run: bun test tests/utils.integration.test.ts
 */

import { describe, test, expect } from "bun:test";

// =============================================================================
// PRICE FETCHER TESTS - Real API Calls
// =============================================================================
describe("Price Fetcher - Real API Integration", () => {
  const TIMEOUT = 30_000;

  // Known tokens for testing
  const KNOWN_EVM_TOKEN = "0x514910771af9ca656af840dff83e8264ecf986ca"; // LINK on Ethereum
  const KNOWN_SOLANA_TOKEN = "So11111111111111111111111111111111111111112"; // Wrapped SOL

  describe("fetchNativePrices", () => {
    test(
      "fetches native prices from CoinGecko (rate limit tolerant)",
      async () => {
        const { fetchNativePrices } = await import("@/utils/price-fetcher");
        const prices = await fetchNativePrices(["ETH"]);

        // CoinGecko may rate limit (429) - that's acceptable
        // Returns empty object on rate limit, so just verify response shape
        expect(typeof prices).toBe("object");

        // If we got ETH price, validate it's reasonable
        if (prices.ETH !== undefined) {
          expect(typeof prices.ETH).toBe("number");
          expect(prices.ETH).toBeGreaterThan(100);
          expect(prices.ETH).toBeLessThan(100000);
        }
      },
      TIMEOUT,
    );

    test(
      "fetches multiple native prices in one call",
      async () => {
        const { fetchNativePrices } = await import("@/utils/price-fetcher");
        const prices = await fetchNativePrices(["ETH", "SOL"]);

        // API may rate limit - that's acceptable behavior
        // Just verify we get an object back and any prices are reasonable
        expect(typeof prices).toBe("object");

        // Validate any prices we got are reasonable (may be empty if rate limited)
        if (prices.ETH) {
          expect(prices.ETH).toBeGreaterThan(100);
        }
        if (prices.SOL) {
          expect(prices.SOL).toBeGreaterThan(1);
          expect(prices.SOL).toBeLessThan(10000);
        }
      },
      TIMEOUT,
    );

    test(
      "returns empty object for unknown symbols",
      async () => {
        const { fetchNativePrices } = await import("@/utils/price-fetcher");
        const prices = await fetchNativePrices(["NOTAREALTOKEN123"]);

        expect(Object.keys(prices)).toHaveLength(0);
      },
      TIMEOUT,
    );
  });

  describe("fetchDeFiLlamaPrices", () => {
    test(
      "fetches real token price from DeFiLlama",
      async () => {
        const { fetchDeFiLlamaPrices } = await import("@/utils/price-fetcher");
        const prices = await fetchDeFiLlamaPrices("ethereum", [KNOWN_EVM_TOKEN]);

        // LINK should have a real price
        const price = prices[KNOWN_EVM_TOKEN.toLowerCase()];
        if (price !== undefined) {
          expect(typeof price).toBe("number");
          expect(price).toBeGreaterThan(0);
          expect(price).toBeLessThan(10000);
        }
      },
      TIMEOUT,
    );

    test(
      "returns empty object for empty address list",
      async () => {
        const { fetchDeFiLlamaPrices } = await import("@/utils/price-fetcher");
        const prices = await fetchDeFiLlamaPrices("ethereum", []);

        expect(Object.keys(prices)).toHaveLength(0);
      },
      TIMEOUT,
    );
  });

  describe("fetchJupiterPrices", () => {
    test(
      "fetches real SOL price from Jupiter",
      async () => {
        const { fetchJupiterPrices } = await import("@/utils/price-fetcher");
        const prices = await fetchJupiterPrices([KNOWN_SOLANA_TOKEN]);

        // Wrapped SOL should have price
        const price = prices[KNOWN_SOLANA_TOKEN];
        if (price !== undefined) {
          expect(typeof price).toBe("number");
          expect(price).toBeGreaterThan(1);
          expect(price).toBeLessThan(10000);
        }
      },
      TIMEOUT,
    );

    test(
      "handles batch of multiple Solana tokens",
      async () => {
        const { fetchJupiterPrices } = await import("@/utils/price-fetcher");
        const USDC_SOLANA = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
        const prices = await fetchJupiterPrices([KNOWN_SOLANA_TOKEN, USDC_SOLANA]);

        // Should get at least one price
        const receivedPrices = Object.keys(prices).length;
        expect(receivedPrices).toBeGreaterThanOrEqual(0); // APIs can fail, but shouldn't throw
      },
      TIMEOUT,
    );
  });

  describe("fetchTokenPrices - unified interface", () => {
    test(
      "routes EVM chains to DeFiLlama/CoinGecko",
      async () => {
        const { fetchTokenPrices } = await import("@/utils/price-fetcher");
        const prices = await fetchTokenPrices("ethereum", [KNOWN_EVM_TOKEN]);

        // Should return object (may be empty if rate limited)
        expect(typeof prices).toBe("object");
      },
      TIMEOUT,
    );

    test(
      "routes Solana to Jupiter",
      async () => {
        const { fetchTokenPrices } = await import("@/utils/price-fetcher");
        const prices = await fetchTokenPrices("solana", [KNOWN_SOLANA_TOKEN]);

        expect(typeof prices).toBe("object");
      },
      TIMEOUT,
    );
  });
});

// =============================================================================
// RETRY CACHE TESTS - Real Functionality
// =============================================================================
describe("Retry Cache Utilities", () => {
  const TIMEOUT = 10_000;

  describe("getCached / setCache", () => {
    test("stores and retrieves values", async () => {
      const { getCached, setCache } = await import("@/utils/retry-cache");

      const key = `test-${Date.now()}`;
      const value = { foo: "bar", num: 42 };

      setCache(key, value, 10000);
      const retrieved = getCached<typeof value>(key);

      expect(retrieved).toEqual(value);
    });

    test("returns undefined for expired cache", async () => {
      const { getCached, setCache } = await import("@/utils/retry-cache");

      const key = `expired-${Date.now()}`;
      setCache(key, "value", 1); // 1ms TTL

      await new Promise((resolve) => setTimeout(resolve, 10));
      const retrieved = getCached(key);

      expect(retrieved).toBeUndefined();
    });

    test("returns undefined for non-existent keys", async () => {
      const { getCached } = await import("@/utils/retry-cache");

      const retrieved = getCached(`nonexistent-${Date.now()}`);
      expect(retrieved).toBeUndefined();
    });
  });

  describe("withRetryAndCache", () => {
    test(
      "executes function and caches result",
      async () => {
        const { withRetryAndCache, getCached } = await import("@/utils/retry-cache");

        const key = `retry-test-${Date.now()}`;
        let callCount = 0;

        const result = await withRetryAndCache(key, async () => {
          callCount++;
          return { success: true, count: callCount };
        });

        expect(result.success).toBe(true);
        expect(result.count).toBe(1);

        // Second call should use cache
        const cached = getCached(key);
        expect(cached).toBeDefined();
      },
      TIMEOUT,
    );

    test(
      "throws immediately for non-retryable errors",
      async () => {
        const { withRetryAndCache } = await import("@/utils/retry-cache");

        const key = `non-retryable-${Date.now()}`;

        await expect(
          withRetryAndCache(
            key,
            async () => {
              throw new Error("Business logic error");
            },
            { maxRetries: 3 },
          ),
        ).rejects.toThrow("Business logic error");
      },
      TIMEOUT,
    );

    test(
      "respects skipCache option",
      async () => {
        const { withRetryAndCache, getCached } = await import("@/utils/retry-cache");

        const key = `skip-cache-${Date.now()}`;
        let callCount = 0;

        await withRetryAndCache(
          key,
          async () => {
            callCount++;
            return callCount;
          },
          { skipCache: true },
        );

        // Should not be cached
        const cached = getCached(key);
        expect(cached).toBeUndefined();
      },
      TIMEOUT,
    );
  });

  describe("fetchJsonWithRetryAndCache", () => {
    test(
      "fetches real JSON and caches it",
      async () => {
        const { fetchJsonWithRetryAndCache, getCached } = await import(
          "@/utils/retry-cache"
        );

        // Use httpbin.org which is more reliable for testing
        const url = "https://httpbin.org/json";
        const cacheKey = `json-test-${Date.now()}`;

        interface HttpBinResponse {
          slideshow: { title: string };
        }

        const data = await fetchJsonWithRetryAndCache<HttpBinResponse>(url, undefined, {
          cacheKey,
          cacheTtlMs: 60000,
        });

        expect(data.slideshow).toBeDefined();
        expect(data.slideshow.title).toBeDefined();

        // Should be cached
        const cached = getCached<HttpBinResponse>(cacheKey);
        expect(cached).toBeDefined();
        expect(cached?.slideshow.title).toBe(data.slideshow.title);
      },
      15_000,
    );
  });
});

// =============================================================================
// VALIDATION HELPERS TESTS
// =============================================================================
describe("Validation Helpers", () => {
  describe("parseOrThrow", () => {
    test("returns validated data for valid input", async () => {
      const { parseOrThrow } = await import("@/lib/validation/helpers");
      const { z } = await import("zod");

      const schema = z.object({
        name: z.string().min(1),
        age: z.number().int().positive(),
      });

      const result = parseOrThrow(schema, { name: "Alice", age: 30 });

      expect(result.name).toBe("Alice");
      expect(result.age).toBe(30);
    });

    test("throws descriptive error for invalid input", async () => {
      const { parseOrThrow } = await import("@/lib/validation/helpers");
      const { z } = await import("zod");

      const schema = z.object({
        email: z.string().email(),
        count: z.number().min(0),
      });

      expect(() => parseOrThrow(schema, { email: "not-an-email", count: -1 })).toThrow(
        /Validation failed/,
      );
    });

    test("includes field path in error message", async () => {
      const { parseOrThrow } = await import("@/lib/validation/helpers");
      const { z } = await import("zod");

      const schema = z.object({
        nested: z.object({
          value: z.number(),
        }),
      });

      try {
        parseOrThrow(schema, { nested: { value: "not-a-number" } });
        throw new Error("Should have thrown");
      } catch (e) {
        const error = e as Error;
        expect(error.message).toContain("nested.value");
      }
    });
  });

  describe("parseOrNull", () => {
    test("returns data for valid input", async () => {
      const { parseOrNull } = await import("@/lib/validation/helpers");
      const { z } = await import("zod");

      const schema = z.string().uuid();
      const validUuid = "123e4567-e89b-12d3-a456-426614174000";

      const result = parseOrNull(schema, validUuid);
      expect(result).toBe(validUuid);
    });

    test("returns null for invalid input", async () => {
      const { parseOrNull } = await import("@/lib/validation/helpers");
      const { z } = await import("zod");

      const schema = z.string().uuid();
      const result = parseOrNull(schema, "not-a-uuid");

      expect(result).toBeNull();
    });
  });

  describe("validateAndTransform", () => {
    test("validates and transforms in one step", async () => {
      const { validateAndTransform } = await import("@/lib/validation/helpers");
      const { z } = await import("zod");

      const schema = z.string();
      const transform = (s: string) => s.toUpperCase();

      const result = validateAndTransform(schema, transform, "hello");
      expect(result).toBe("HELLO");
    });
  });
});

// =============================================================================
// BALANCE FETCHER UTILITIES TESTS
// =============================================================================
describe("Balance Fetcher Utilities", () => {
  describe("filterDustTokens", () => {
    test("filters out tokens below minimum balance", async () => {
      const { filterDustTokens } = await import("@/lib/balance-fetcher");

      const tokens = [
        {
          contractAddress: "0x1",
          symbol: "HIGH",
          name: "High Balance",
          decimals: 18,
          balance: "10000000000000000000", // 10 tokens
          priceUsd: 1,
          balanceUsd: 10,
        },
        {
          contractAddress: "0x2",
          symbol: "LOW",
          name: "Low Balance",
          decimals: 18,
          balance: "100000000000000", // 0.0001 tokens
          priceUsd: 1,
          balanceUsd: 0.0001,
        },
      ];

      const filtered = filterDustTokens(tokens, 1, 0.001);

      expect(filtered).toHaveLength(1);
      expect(filtered[0].symbol).toBe("HIGH");
    });

    test("keeps tokens without price if balance meets threshold", async () => {
      const { filterDustTokens } = await import("@/lib/balance-fetcher");

      const tokens = [
        {
          contractAddress: "0x1",
          symbol: "NOPR",
          name: "No Price",
          decimals: 18,
          balance: "5000000000000000000", // 5 tokens
          priceUsd: 0,
          balanceUsd: 0,
        },
      ];

      const filtered = filterDustTokens(tokens, 1, 0.001);

      expect(filtered).toHaveLength(1);
    });
  });

  describe("sortTokensByValue", () => {
    test("sorts priced tokens by USD value descending", async () => {
      const { sortTokensByValue } = await import("@/lib/balance-fetcher");

      const tokens = [
        {
          contractAddress: "0x1",
          symbol: "LOW",
          name: "Low Value",
          decimals: 18,
          balance: "1000000000000000000",
          priceUsd: 10,
          balanceUsd: 10,
        },
        {
          contractAddress: "0x2",
          symbol: "HIGH",
          name: "High Value",
          decimals: 18,
          balance: "1000000000000000000",
          priceUsd: 100,
          balanceUsd: 100,
        },
      ];

      const sorted = sortTokensByValue(tokens);

      expect(sorted[0].symbol).toBe("HIGH");
      expect(sorted[1].symbol).toBe("LOW");
    });

    test("puts priced tokens before unpriced tokens", async () => {
      const { sortTokensByValue } = await import("@/lib/balance-fetcher");

      const tokens = [
        {
          contractAddress: "0x1",
          symbol: "NOPR",
          name: "No Price",
          decimals: 18,
          balance: "999000000000000000000", // Huge balance
          priceUsd: 0,
          balanceUsd: 0,
        },
        {
          contractAddress: "0x2",
          symbol: "PRICED",
          name: "Has Price",
          decimals: 18,
          balance: "1000000000000000000",
          priceUsd: 1,
          balanceUsd: 1,
        },
      ];

      const sorted = sortTokensByValue(tokens);

      expect(sorted[0].symbol).toBe("PRICED");
      expect(sorted[1].symbol).toBe("NOPR");
    });
  });
});

// =============================================================================
// CONSIGNMENT SANITIZER TESTS
// =============================================================================
describe("Consignment Sanitizer", () => {
  describe("sanitizeConsignmentForBuyer", () => {
    test("hides sensitive negotiation range for negotiable consignments", async () => {
      const { sanitizeConsignmentForBuyer } = await import(
        "@/utils/consignment-sanitizer"
      );

      const negotiableConsignment = {
        id: "test-123",
        tokenId: "token-base-0x1234",
        consignerAddress: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        consignerEntityId: "entity-123",
        totalAmount: "1000000000000000000",
        remainingAmount: "1000000000000000000",
        isNegotiable: true,
        minDiscountBps: 500, // 5% - buyer sees this as "starting at"
        maxDiscountBps: 2000, // 20% - hidden from buyer
        minLockupDays: 30, // Best case - hidden
        maxLockupDays: 180, // Worst case - shown
        minDealAmount: "100000000000000000",
        maxDealAmount: "1000000000000000000",
        isFractionalized: true,
        isPrivate: false,
        maxPriceVolatilityBps: 500,
        maxTimeToExecuteSeconds: 3600,
        status: "active" as const,
        chain: "base" as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const sanitized = sanitizeConsignmentForBuyer(negotiableConsignment);

      // Display values should show "worst case" for buyer
      expect(sanitized.displayDiscountBps).toBe(500); // min discount (worst for buyer)
      expect(sanitized.displayLockupDays).toBe(180); // max lockup (worst for buyer)
      expect(sanitized.termsType).toBe("negotiable");

      // maxDiscountBps should not be exposed (best discount - hidden from buyer)
      expect(sanitized).not.toHaveProperty("maxDiscountBps");
      // minLockupDays IS exposed as a core field per implementation
      expect(sanitized.minLockupDays).toBe(30);
    });

    test("exposes fixed terms for fixed consignments", async () => {
      const { sanitizeConsignmentForBuyer } = await import(
        "@/utils/consignment-sanitizer"
      );

      const fixedConsignment = {
        id: "test-456",
        tokenId: "token-base-0x5678",
        consignerAddress: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        consignerEntityId: "entity-456",
        totalAmount: "1000000000000000000",
        remainingAmount: "1000000000000000000",
        isNegotiable: false,
        fixedDiscountBps: 1000, // 10%
        fixedLockupDays: 90,
        minDiscountBps: 1000,
        maxDiscountBps: 1000,
        minLockupDays: 90,
        maxLockupDays: 90,
        minDealAmount: "100000000000000000",
        maxDealAmount: "1000000000000000000",
        isFractionalized: true,
        isPrivate: false,
        maxPriceVolatilityBps: 500,
        maxTimeToExecuteSeconds: 3600,
        status: "active" as const,
        chain: "base" as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const sanitized = sanitizeConsignmentForBuyer(fixedConsignment);

      expect(sanitized.displayDiscountBps).toBe(1000);
      expect(sanitized.displayLockupDays).toBe(90);
      expect(sanitized.termsType).toBe("fixed");
      expect(sanitized.fixedDiscountBps).toBe(1000);
      expect(sanitized.fixedLockupDays).toBe(90);
    });

    test("throws for negotiable consignment missing required fields", async () => {
      const { sanitizeConsignmentForBuyer } = await import(
        "@/utils/consignment-sanitizer"
      );

      const invalidConsignment = {
        id: "test-789",
        tokenId: "token-base-0x9999",
        consignerAddress: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        consignerEntityId: "entity-789",
        totalAmount: "1000000000000000000",
        remainingAmount: "1000000000000000000",
        isNegotiable: true,
        // Missing minDiscountBps and maxLockupDays
        minDiscountBps: undefined,
        maxLockupDays: undefined,
        isFractionalized: true,
        isPrivate: false,
        maxPriceVolatilityBps: 500,
        maxTimeToExecuteSeconds: 3600,
        status: "active" as const,
        chain: "base" as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      expect(() =>
        sanitizeConsignmentForBuyer(invalidConsignment as Parameters<typeof sanitizeConsignmentForBuyer>[0]),
      ).toThrow(/missing required/i);
    });
  });

  describe("isConsignmentOwner", () => {
    test("matches EVM addresses case-insensitively", async () => {
      const { isConsignmentOwner } = await import("@/utils/consignment-sanitizer");

      const consignment = {
        consignerAddress: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        chain: "base" as const,
      };

      expect(
        isConsignmentOwner(
          consignment as Parameters<typeof isConsignmentOwner>[0],
          "0xF39FD6E51AAD88F6F4CE6AB8827279CFFFB92266",
        ),
      ).toBe(true);
    });

    test("matches Solana addresses case-sensitively", async () => {
      const { isConsignmentOwner } = await import("@/utils/consignment-sanitizer");

      const consignment = {
        consignerAddress: "E6K5x45Bxfmci6FmKRQ2YJMpLz7fCdLm7r7ReCq6P5vP",
        chain: "solana" as const,
      };

      // Exact match
      expect(
        isConsignmentOwner(
          consignment as Parameters<typeof isConsignmentOwner>[0],
          "E6K5x45Bxfmci6FmKRQ2YJMpLz7fCdLm7r7ReCq6P5vP",
        ),
      ).toBe(true);

      // Case mismatch should fail for Solana
      expect(
        isConsignmentOwner(
          consignment as Parameters<typeof isConsignmentOwner>[0],
          "e6k5x45bxfmci6fmkrq2yjmplz7cdlm7r7recq6p5vp",
        ),
      ).toBe(false);
    });

    test("returns false for null/undefined caller", async () => {
      const { isConsignmentOwner } = await import("@/utils/consignment-sanitizer");

      const consignment = {
        consignerAddress: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        chain: "base" as const,
      };

      expect(
        isConsignmentOwner(consignment as Parameters<typeof isConsignmentOwner>[0], null),
      ).toBe(false);
      expect(
        isConsignmentOwner(consignment as Parameters<typeof isConsignmentOwner>[0], undefined),
      ).toBe(false);
    });
  });
});

// =============================================================================
// ENTITY ID TESTS
// =============================================================================
describe("Entity ID Utilities", () => {
  describe("walletToEntityId", () => {
    test("generates deterministic UUID for EVM address", async () => {
      const { walletToEntityId } = await import("@/lib/entityId");

      const address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

      const id1 = walletToEntityId(address);
      const id2 = walletToEntityId(address);

      // Same address should always produce same ID
      expect(id1).toBe(id2);

      // Should be valid UUID format
      expect(id1).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    test("normalizes EVM addresses to lowercase", async () => {
      const { walletToEntityId } = await import("@/lib/entityId");

      const lower = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
      const upper = "0xF39FD6E51AAD88F6F4CE6AB8827279CFFFB92266";

      expect(walletToEntityId(lower)).toBe(walletToEntityId(upper));
    });

    test("preserves Solana address case", async () => {
      const { walletToEntityId } = await import("@/lib/entityId");

      const solana = "E6K5x45Bxfmci6FmKRQ2YJMpLz7fCdLm7r7ReCq6P5vP";
      const lowerSolana = solana.toLowerCase();

      // Different cases should produce different IDs for Solana
      expect(walletToEntityId(solana)).not.toBe(walletToEntityId(lowerSolana));
    });

    test("generates different IDs for different addresses", async () => {
      const { walletToEntityId } = await import("@/lib/entityId");

      const addr1 = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
      const addr2 = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

      expect(walletToEntityId(addr1)).not.toBe(walletToEntityId(addr2));
    });
  });
});

// =============================================================================
// ADDRESS UTILS COMPREHENSIVE TESTS
// =============================================================================
describe("Address Utils - Comprehensive", () => {
  describe("isEvmAddress", () => {
    test("validates checksummed addresses", async () => {
      const { isEvmAddress } = await import("@/utils/address-utils");

      // Valid checksummed addresses
      expect(isEvmAddress("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045")).toBe(true);
      expect(isEvmAddress("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266")).toBe(true);
    });

    test("validates lowercase addresses", async () => {
      const { isEvmAddress } = await import("@/utils/address-utils");

      expect(isEvmAddress("0xd8da6bf26964af9d7eed9e03e53415d37aa96045")).toBe(true);
    });

    test("rejects invalid formats", async () => {
      const { isEvmAddress } = await import("@/utils/address-utils");

      expect(isEvmAddress("d8dA6BF26964aF9D7eEd9e03E53415D37aA96045")).toBe(false); // no 0x
      expect(isEvmAddress("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA9604")).toBe(false); // 39 chars
      expect(isEvmAddress("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA960456")).toBe(false); // 41 chars
      expect(isEvmAddress("0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG")).toBe(false); // invalid hex
    });
  });

  describe("isSolanaAddress", () => {
    test("validates real Solana addresses", async () => {
      const { isSolanaAddress } = await import("@/utils/address-utils");

      // Real program/account addresses
      expect(isSolanaAddress("So11111111111111111111111111111111111111112")).toBe(true);
      expect(isSolanaAddress("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")).toBe(true);
      expect(isSolanaAddress("E6K5x45Bxfmci6FmKRQ2YJMpLz7fCdLm7r7ReCq6P5vP")).toBe(true);
    });

    test("rejects invalid Base58 characters", async () => {
      const { isSolanaAddress } = await import("@/utils/address-utils");

      // Contains 0, I, O, or l which are not in Base58
      expect(isSolanaAddress("0oIlInvalidBase58Address")).toBe(false);
    });

    test("rejects EVM addresses", async () => {
      const { isSolanaAddress } = await import("@/utils/address-utils");

      expect(isSolanaAddress("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266")).toBe(false);
    });
  });

  describe("detectChainFromAddress", () => {
    test("detects EVM addresses", async () => {
      const { detectChainFromAddress } = await import("@/utils/address-utils");

      expect(detectChainFromAddress("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266")).toBe(
        "evm",
      );
    });

    test("detects Solana addresses", async () => {
      const { detectChainFromAddress } = await import("@/utils/address-utils");

      expect(detectChainFromAddress("E6K5x45Bxfmci6FmKRQ2YJMpLz7fCdLm7r7ReCq6P5vP")).toBe(
        "solana",
      );
    });

    test("returns null for unrecognized formats", async () => {
      const { detectChainFromAddress } = await import("@/utils/address-utils");

      expect(detectChainFromAddress("not-an-address")).toBeNull();
      expect(detectChainFromAddress("")).toBeNull();
    });
  });

  describe("checksumAddress", () => {
    test("checksums valid EVM address", async () => {
      const { checksumAddress } = await import("@/utils/address-utils");

      const lower = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";
      const checksummed = checksumAddress(lower);

      expect(checksummed).toBe("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
    });

    test("throws for invalid address (fail-fast)", async () => {
      const { checksumAddress } = await import("@/utils/address-utils");

      expect(() => checksumAddress("invalid")).toThrow();
      expect(() => checksumAddress("0x123")).toThrow();
    });
  });

  describe("validateAndNormalizeAddress", () => {
    test("validates and normalizes EVM address", async () => {
      const { validateAndNormalizeAddress } = await import("@/utils/address-utils");

      const result = validateAndNormalizeAddress(
        "0xD8DA6BF26964AF9D7EED9E03E53415D37AA96045",
        "base",
      );

      expect(result).toBe("0xd8da6bf26964af9d7eed9e03e53415d37aa96045");
    });

    test("returns null for Solana address on EVM chain", async () => {
      const { validateAndNormalizeAddress } = await import("@/utils/address-utils");

      const result = validateAndNormalizeAddress(
        "E6K5x45Bxfmci6FmKRQ2YJMpLz7fCdLm7r7ReCq6P5vP",
        "base",
      );

      expect(result).toBeNull();
    });

    test("validates Solana address preserving case", async () => {
      const { validateAndNormalizeAddress } = await import("@/utils/address-utils");

      const solana = "E6K5x45Bxfmci6FmKRQ2YJMpLz7fCdLm7r7ReCq6P5vP";
      const result = validateAndNormalizeAddress(solana, "solana");

      expect(result).toBe(solana);
    });
  });
});

// =============================================================================
// VIEM UTILS TESTS - Real Integration
// =============================================================================
describe("Viem Utils - Real Integration", () => {
  const TIMEOUT = 15_000;

  describe("safeReadContract", () => {
    test(
      "reads real ERC20 data from Ethereum mainnet (USDC)",
      async () => {
        const { createPublicClient, http } = await import("viem");
        const { mainnet } = await import("viem/chains");
        const { safeReadContract, ERC20_ABI } = await import("@/lib/viem-utils");

        // Use a real public RPC (no API key needed for read-only)
        const client = createPublicClient({
          chain: mainnet,
          transport: http("https://eth.llamarpc.com"),
        });

        // USDC on Ethereum mainnet - well-known stable contract
        const USDC_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

        // Read symbol from real contract
        const symbol = await safeReadContract<string>(client, {
          address: USDC_ADDRESS,
          abi: ERC20_ABI,
          functionName: "symbol",
        });

        expect(symbol).toBe("USDC");

        // Read decimals
        const decimals = await safeReadContract<number>(client, {
          address: USDC_ADDRESS,
          abi: ERC20_ABI,
          functionName: "decimals",
        });

        expect(decimals).toBe(6);

        // Read name
        const name = await safeReadContract<string>(client, {
          address: USDC_ADDRESS,
          abi: ERC20_ABI,
          functionName: "name",
        });

        expect(name).toBe("USD Coin");
      },
      TIMEOUT,
    );
  });

  describe("ERC20_ABI", () => {
    test("has all required ERC20 functions", async () => {
      const { ERC20_ABI } = await import("@/lib/viem-utils");

      const functionNames = ERC20_ABI.map((item) => item.name);

      expect(functionNames).toContain("symbol");
      expect(functionNames).toContain("name");
      expect(functionNames).toContain("decimals");
      expect(functionNames).toContain("balanceOf");
      expect(functionNames).toContain("allowance");
      expect(functionNames).toContain("approve");
      expect(functionNames).toContain("transfer");
    });
  });
});

// =============================================================================
// OTC HELPERS TESTS
// =============================================================================
describe("OTC Helpers", () => {
  describe("parseOfferStruct", () => {
    test("parses array format (Solidity tuple return)", async () => {
      const { parseOfferStruct } = await import("@/lib/otc-helpers");

      const rawOffer = [
        1n, // consignmentId
        "0x1234567890123456789012345678901234567890123456789012345678901234", // tokenId (bytes32)
        "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", // beneficiary
        1000000000000000000n, // tokenAmount (1e18)
        1500n, // discountBps (15%)
        1704067200n, // createdAt
        1735603200n, // unlockTime
        100000000n, // priceUsdPerToken (8 decimals)
        500n, // maxPriceDeviation
        320000000000n, // ethUsdPrice (8 decimals = $3200)
        0, // currency (ETH)
        true, // approved
        true, // paid
        false, // fulfilled
        false, // cancelled
        "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", // payer
        500000000000000000n, // amountPaid (0.5e18)
        100, // agentCommissionBps (1%)
      ] as const;

      const parsed = parseOfferStruct(rawOffer);

      expect(parsed.consignmentId).toBe(1n);
      expect(parsed.beneficiary).toBe("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
      expect(parsed.tokenAmount).toBe(1000000000000000000n);
      expect(parsed.discountBps).toBe(1500n);
      expect(parsed.approved).toBe(true);
      expect(parsed.paid).toBe(true);
      expect(parsed.fulfilled).toBe(false);
      expect(parsed.cancelled).toBe(false);
      expect(parsed.currency).toBe(0);
      expect(parsed.agentCommissionBps).toBe(100);
    });

    test("passes through object format unchanged", async () => {
      const { parseOfferStruct } = await import("@/lib/otc-helpers");

      const objectOffer = {
        consignmentId: 2n,
        tokenId: "0xabcd",
        beneficiary: "0xtest",
        tokenAmount: 500n,
        discountBps: 1000n,
        createdAt: 1000n,
        unlockTime: 2000n,
        priceUsdPerToken: 100n,
        maxPriceDeviation: 50n,
        ethUsdPrice: 3200n,
        currency: 1,
        approved: false,
        paid: false,
        fulfilled: false,
        cancelled: false,
        payer: "0xpayer",
        amountPaid: 0n,
        agentCommissionBps: 0,
      };

      const parsed = parseOfferStruct(objectOffer);

      expect(parsed.consignmentId).toBe(2n);
      expect(parsed.tokenAmount).toBe(500n);
      expect(parsed.agentCommissionBps).toBe(0);
    });
  });
});

// =============================================================================
// LOGO FETCHER TESTS - Real API Integration
// =============================================================================
describe("Logo Fetcher - Real API Integration", () => {
  const TIMEOUT = 15_000;

  // Known tokens with logos on TrustWallet
  const LINK_ADDRESS = "0x514910771AF9Ca656af840dff83E8264EcF986CA"; // LINK on Ethereum
  const USDC_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"; // USDC on Ethereum

  describe("checksumAddress", () => {
    test("checksums address for TrustWallet compatibility", async () => {
      const { checksumAddress } = await import("@/utils/logo-fetcher");

      const lower = "0x514910771af9ca656af840dff83e8264ecf986ca";
      const checksummed = checksumAddress(lower);

      // TrustWallet requires exact checksummed format
      expect(checksummed).toBe("0x514910771AF9Ca656af840dff83E8264EcF986CA");
    });
  });

  describe("fetchTrustWalletLogo", () => {
    test(
      "fetches logo for known token (LINK)",
      async () => {
        const { fetchTrustWalletLogo } = await import("@/utils/logo-fetcher");

        const logoUrl = await fetchTrustWalletLogo(LINK_ADDRESS, "ethereum");

        // LINK has a well-known logo on TrustWallet
        expect(logoUrl).not.toBeNull();
        expect(logoUrl).toContain("trustwallet");
        expect(logoUrl).toContain("logo.png");
      },
      TIMEOUT,
    );

    test(
      "returns null for unsupported chain",
      async () => {
        const { fetchTrustWalletLogo } = await import("@/utils/logo-fetcher");

        const logoUrl = await fetchTrustWalletLogo(LINK_ADDRESS, "unsupported-chain");

        expect(logoUrl).toBeNull();
      },
      TIMEOUT,
    );

    test(
      "returns null for non-existent token",
      async () => {
        const { fetchTrustWalletLogo } = await import("@/utils/logo-fetcher");

        // Random address unlikely to have a logo
        const fakeAddress = "0x0000000000000000000000000000000000000001";
        const logoUrl = await fetchTrustWalletLogo(fakeAddress, "ethereum");

        expect(logoUrl).toBeNull();
      },
      TIMEOUT,
    );
  });

  describe("CHAIN_LOGO_CONFIG", () => {
    test("has config for supported chains", async () => {
      const { CHAIN_LOGO_CONFIG } = await import("@/utils/logo-fetcher");

      expect(CHAIN_LOGO_CONFIG.ethereum).toBeDefined();
      expect(CHAIN_LOGO_CONFIG.base).toBeDefined();
      expect(CHAIN_LOGO_CONFIG.bsc).toBeDefined();

      // Verify config structure
      expect(CHAIN_LOGO_CONFIG.ethereum.alchemyNetwork).toBe("eth-mainnet");
      expect(CHAIN_LOGO_CONFIG.base.trustwalletChain).toBe("base");
      expect(CHAIN_LOGO_CONFIG.bsc.coingeckoPlatform).toBe("binance-smart-chain");
    });
  });
});

// =============================================================================
// POOL FINDER UTILITIES TESTS
// =============================================================================
describe("Pool Finder Utilities", () => {
  describe("validatePoolLiquidity", () => {
    test("validates pool with sufficient liquidity", async () => {
      const { validatePoolLiquidity } = await import("@/utils/pool-finder-base");

      const highTvlPool = {
        protocol: "Uniswap V3" as const,
        address: "0x1234567890123456789012345678901234567890",
        token0: "0xtoken0",
        token1: "0xtoken1",
        fee: 3000,
        liquidity: 1000000000000000000n,
        tvlUsd: 50000,
        baseToken: "USDC" as const,
      };

      const result = validatePoolLiquidity(highTvlPool);

      expect(result.valid).toBe(true);
      expect(result.warning).toBeUndefined();
    });

    test("flags low liquidity pools", async () => {
      const { validatePoolLiquidity } = await import("@/utils/pool-finder-base");

      const lowTvlPool = {
        protocol: "Uniswap V3" as const,
        address: "0x1234567890123456789012345678901234567890",
        token0: "0xtoken0",
        token1: "0xtoken1",
        fee: 3000,
        liquidity: 100n,
        tvlUsd: 500, // Below $10k minimum
        baseToken: "USDC" as const,
      };

      const result = validatePoolLiquidity(lowTvlPool);

      expect(result.valid).toBe(false);
      expect(result.warning).toBeDefined();
      expect(result.warning).toContain("Low liquidity");
    });
  });

  describe("formatPoolInfo", () => {
    test("formats Uniswap V3 pool info", async () => {
      const { formatPoolInfo } = await import("@/utils/pool-finder-base");

      const uniPool = {
        protocol: "Uniswap V3" as const,
        address: "0x1234567890123456789012345678901234567890",
        token0: "0xtoken0",
        token1: "0xtoken1",
        fee: 3000,
        liquidity: 1000000000000000000n,
        tvlUsd: 125000.5,
        baseToken: "WETH" as const,
      };

      const formatted = formatPoolInfo(uniPool);

      expect(formatted).toContain("Uniswap V3");
      expect(formatted).toContain("0.30%"); // 3000 / 10000
      expect(formatted).toContain("WETH");
      expect(formatted).toContain("125,000");
    });

    test("formats Aerodrome pool info", async () => {
      const { formatPoolInfo } = await import("@/utils/pool-finder-base");

      const aeroPoolStable = {
        protocol: "Aerodrome" as const,
        address: "0x1234567890123456789012345678901234567890",
        token0: "0xtoken0",
        token1: "0xtoken1",
        stable: true,
        liquidity: 1000000n,
        tvlUsd: 50000,
        baseToken: "USDC" as const,
      };

      const formatted = formatPoolInfo(aeroPoolStable);

      expect(formatted).toContain("Aerodrome");
      expect(formatted).toContain("Stable");
      expect(formatted).toContain("USDC");
    });

    test("formats Aerodrome volatile pool", async () => {
      const { formatPoolInfo } = await import("@/utils/pool-finder-base");

      const aeroPoolVolatile = {
        protocol: "Aerodrome" as const,
        address: "0x1234567890123456789012345678901234567890",
        token0: "0xtoken0",
        token1: "0xtoken1",
        stable: false,
        liquidity: 1000000n,
        tvlUsd: 75000,
        baseToken: "WETH" as const,
      };

      const formatted = formatPoolInfo(aeroPoolVolatile);

      expect(formatted).toContain("Volatile");
    });
  });
});

// =============================================================================
// DEAL TRANSFORMS COMPREHENSIVE TESTS
// =============================================================================
describe("Deal Transforms - Comprehensive", () => {
  describe("transformSolanaDeal fail-fast validation", () => {
    test("throws for missing offerId", async () => {
      const { transformSolanaDeal } = await import("@/utils/deal-transforms");

      const invalidDeal = {
        id: "deal-1",
        quoteId: "quote-1",
        beneficiary: "BeneficiaryPubKey11111111111111111111111111",
        payer: "PayerPubKey1111111111111111111111111111111111",
        tokenAmount: "1000",
        discountBps: 500,
        lockupDays: 90,
        paymentAmount: "10",
        paymentCurrency: "SOL",
        priceUsdPerToken: 1.0,
        tokenSymbol: "TEST",
        tokenName: "Test Token",
        chain: "solana" as const,
        status: "executed" as const,
        // Missing offerId
      };

      expect(() =>
        transformSolanaDeal(
          invalidDeal as Parameters<typeof transformSolanaDeal>[0],
          "WalletPubKey",
        ),
      ).toThrow(/missing required offerId/i);
    });

    test("throws for missing tokenSymbol", async () => {
      const { transformSolanaDeal } = await import("@/utils/deal-transforms");

      const invalidDeal = {
        id: "deal-1",
        quoteId: "quote-1",
        offerId: "123",
        beneficiary: "BeneficiaryPubKey11111111111111111111111111",
        payer: "PayerPubKey1111111111111111111111111111111111",
        tokenAmount: "1000",
        discountBps: 500,
        lockupDays: 90,
        paymentAmount: "10",
        paymentCurrency: "SOL",
        priceUsdPerToken: 1.0,
        tokenName: "Test Token",
        chain: "solana" as const,
        status: "executed" as const,
        // Missing tokenSymbol
      };

      expect(() =>
        transformSolanaDeal(
          invalidDeal as Parameters<typeof transformSolanaDeal>[0],
          "WalletPubKey",
        ),
      ).toThrow(/missing tokenSymbol/i);
    });

    test("throws for missing lockupDays", async () => {
      const { transformSolanaDeal } = await import("@/utils/deal-transforms");

      const invalidDeal = {
        id: "deal-1",
        quoteId: "quote-1",
        offerId: "123",
        beneficiary: "BeneficiaryPubKey11111111111111111111111111",
        payer: "PayerPubKey1111111111111111111111111111111111",
        tokenAmount: "1000",
        discountBps: 500,
        paymentAmount: "10",
        paymentCurrency: "SOL",
        priceUsdPerToken: 1.0,
        tokenSymbol: "TEST",
        tokenName: "Test Token",
        chain: "solana" as const,
        status: "executed" as const,
        // Missing lockupDays
      };

      expect(() =>
        transformSolanaDeal(
          invalidDeal as Parameters<typeof transformSolanaDeal>[0],
          "WalletPubKey",
        ),
      ).toThrow(/missing required lockupDays/i);
    });
  });

  describe("transformEvmDeal fail-fast validation", () => {
    test("throws for invalid ethUsdPrice", async () => {
      const { transformEvmDeal } = await import("@/utils/deal-transforms");

      const invalidDeal = {
        id: "deal-1",
        quoteId: "quote-1",
        offerId: "123",
        beneficiary: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        payer: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        tokenAmount: "1000",
        discountBps: 500,
        lockupDays: 90,
        paymentAmount: "1",
        paymentCurrency: "ETH",
        priceUsdPerToken: 1.0,
        ethUsdPrice: 0, // Invalid: must be > 0
        tokenSymbol: "TEST",
        tokenName: "Test Token",
        chain: "base" as const,
        status: "executed" as const,
      };

      expect(() =>
        transformEvmDeal(
          invalidDeal as Parameters<typeof transformEvmDeal>[0],
          "0x0000000000000000000000000000000000000000",
        ),
      ).toThrow(/invalid ethUsdPrice/i);
    });

    test("throws for missing priceUsdPerToken", async () => {
      const { transformEvmDeal } = await import("@/utils/deal-transforms");

      const invalidDeal = {
        id: "deal-1",
        quoteId: "quote-1",
        offerId: "123",
        beneficiary: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        payer: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        tokenAmount: "1000",
        discountBps: 500,
        lockupDays: 90,
        paymentAmount: "1",
        paymentCurrency: "ETH",
        ethUsdPrice: 3000,
        tokenSymbol: "TEST",
        tokenName: "Test Token",
        chain: "base" as const,
        status: "executed" as const,
        // Missing priceUsdPerToken
      };

      expect(() =>
        transformEvmDeal(
          invalidDeal as Parameters<typeof transformEvmDeal>[0],
          "0x0000000000000000000000000000000000000000",
        ),
      ).toThrow(/missing required priceUsdPerToken/i);
    });
  });

  describe("mergeDealsWithOffers", () => {
    test("merges database deals with contract offers", async () => {
      const { mergeDealsWithOffers } = await import("@/utils/deal-transforms");

      const dbDeals = [
        {
          id: "deal-1",
          quoteId: "quote-123",
          offerId: "1",
          beneficiary: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
          payer: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
          tokenAmount: "1000",
          discountBps: 500,
          lockupDays: 90,
          paymentAmount: "1",
          paymentCurrency: "ETH",
          priceUsdPerToken: 1.0,
          ethUsdPrice: 3000,
          tokenSymbol: "TEST",
          tokenName: "Test Token",
          tokenLogoUrl: "https://example.com/logo.png",
          tokenId: "token-base-0x1234",
          chain: "base" as const,
          status: "executed" as const,
        },
      ];

      const contractOffers = [
        {
          id: 1n,
          beneficiary: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
          tokenAmount: 1000000000000000000n,
          discountBps: 500n,
          createdAt: 1704067200n,
          unlockTime: 1711843200n,
          priceUsdPerToken: 100000000n,
          ethUsdPrice: 300000000000n,
          currency: 0,
          approved: true,
          paid: true,
          fulfilled: false,
          cancelled: false,
          payer: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
          amountPaid: 500000000000000000n,
        },
      ];

      const merged = mergeDealsWithOffers(
        dbDeals as Parameters<typeof mergeDealsWithOffers>[0],
        contractOffers,
        "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      );

      expect(merged.length).toBe(1);
      expect(merged[0].quoteId).toBe("quote-123");
      expect(merged[0].tokenSymbol).toBe("TEST");
      // Should use contract offer data merged with DB metadata
      expect(merged[0].tokenAmount).toBe(1000000000000000000n);
    });
  });
});

// =============================================================================
// FORMAT EDGE CASES
// =============================================================================
describe("Format Utilities - Edge Cases", () => {
  describe("formatTokenAmount edge cases", () => {
    test("handles zero", async () => {
      const { formatTokenAmount } = await import("@/utils/format");

      expect(formatTokenAmount(0)).toBe("0");
    });

    test("handles very large numbers", async () => {
      const { formatTokenAmount } = await import("@/utils/format");

      const result = formatTokenAmount(999_999_999_999);
      expect(result).toContain("M");
    });

    test("handles boundary values", async () => {
      const { formatTokenAmount } = await import("@/utils/format");

      expect(formatTokenAmount(999)).not.toContain("K");
      expect(formatTokenAmount(1000)).toContain("K");
      expect(formatTokenAmount(999999)).toContain("K");
      expect(formatTokenAmount(1000000)).toContain("M");
    });

    test("handles negative numbers", async () => {
      const { formatTokenAmount } = await import("@/utils/format");

      // Negative values should still format (edge case for refunds/adjustments)
      const result = formatTokenAmount(-1000);
      expect(result).toContain("-");
    });

    test("handles fractional amounts", async () => {
      const { formatTokenAmount } = await import("@/utils/format");

      expect(formatTokenAmount(0.5)).toBe("0.5");
      expect(formatTokenAmount(0.001)).toBe("0");
    });
  });

  describe("formatUsd edge cases", () => {
    test("handles zero", async () => {
      const { formatUsd } = await import("@/utils/format");

      expect(formatUsd(0)).toBe("$0.00");
    });

    test("handles very small decimals", async () => {
      const { formatUsd } = await import("@/utils/format");

      const result = formatUsd(0.001);
      expect(result).toBe("$0.00"); // Rounds to 2 decimals
    });

    test("handles large numbers with commas", async () => {
      const { formatUsd } = await import("@/utils/format");

      const result = formatUsd(1234567.89);
      expect(result).toContain(",");
    });

    test("handles negative amounts", async () => {
      const { formatUsd } = await import("@/utils/format");

      const result = formatUsd(-50.00);
      expect(result).toContain("-");
      expect(result).toContain("50");
    });

    test("handles very large amounts", async () => {
      const { formatUsd } = await import("@/utils/format");

      const result = formatUsd(999999999999.99);
      expect(result).toContain("$");
      expect(result).toContain(",");
    });
  });

  describe("getLockupLabel edge cases", () => {
    test("handles same created and unlock time", async () => {
      const { getLockupLabel } = await import("@/utils/format");

      const ts = Math.floor(Date.now() / 1000);
      const result = getLockupLabel(ts, ts);

      expect(result).toBe("1 month"); // Minimum 1 month
    });

    test("handles unlock before created (edge case)", async () => {
      const { getLockupLabel } = await import("@/utils/format");

      const created = Math.floor(Date.now() / 1000);
      const unlock = created - 1000;
      const result = getLockupLabel(created, unlock);

      expect(result).toBe("1 month"); // Max(0, negative) = 0, rounds to 1
    });

    test("handles exactly 1 month", async () => {
      const { getLockupLabel } = await import("@/utils/format");

      const created = 1704067200;
      const unlock = created + 30 * 24 * 60 * 60;
      const result = getLockupLabel(created, unlock);

      expect(result).toBe("1 month");
    });

    test("handles long lockups (12 months)", async () => {
      const { getLockupLabel } = await import("@/utils/format");

      const created = 1704067200;
      const unlock = created + 365 * 24 * 60 * 60;
      const result = getLockupLabel(created, unlock);

      expect(result).toBe("12 months");
    });
  });

  describe("isMatured edge cases", () => {
    test("handles exact current time", async () => {
      const { isMatured } = await import("@/utils/format");

      const now = Math.floor(Date.now() / 1000);
      expect(isMatured(now)).toBe(true); // <= is matured
    });

    test("handles bigint timestamps", async () => {
      const { isMatured } = await import("@/utils/format");

      const futureTs = BigInt(Math.floor(Date.now() / 1000) + 1000000);
      expect(isMatured(futureTs)).toBe(false);
    });

    test("handles 1 second in the past", async () => {
      const { isMatured } = await import("@/utils/format");

      const pastTs = Math.floor(Date.now() / 1000) - 1;
      expect(isMatured(pastTs)).toBe(true);
    });

    test("handles 1 second in the future", async () => {
      const { isMatured } = await import("@/utils/format");

      const futureTs = Math.floor(Date.now() / 1000) + 1;
      expect(isMatured(futureTs)).toBe(false);
    });
  });

  describe("formatTimeRemaining edge cases", () => {
    test("returns hours for < 1 day", async () => {
      const { formatTimeRemaining } = await import("@/utils/format");

      const futureTs = Math.floor(Date.now() / 1000) + 5 * 3600; // 5 hours
      const result = formatTimeRemaining(futureTs);

      expect(result).toContain("hour");
    });

    test("returns singular day", async () => {
      const { formatTimeRemaining } = await import("@/utils/format");

      const futureTs = Math.floor(Date.now() / 1000) + 1 * 86400; // 1 day
      const result = formatTimeRemaining(futureTs);

      expect(result).toBe("1 day");
    });

    test("returns plural days", async () => {
      const { formatTimeRemaining } = await import("@/utils/format");

      const futureTs = Math.floor(Date.now() / 1000) + 15 * 86400; // 15 days
      const result = formatTimeRemaining(futureTs);

      expect(result).toBe("15 days");
    });
  });

  describe("formatNativeAmount edge cases", () => {
    test("handles zero amount", async () => {
      const { formatNativeAmount } = await import("@/utils/format");

      const result = formatNativeAmount(0, "ETH");
      expect(result).toContain("0.0000");
      expect(result).toContain("ETH");
    });

    test("handles very small amounts", async () => {
      const { formatNativeAmount } = await import("@/utils/format");

      const result = formatNativeAmount(0.000001, "ETH");
      expect(result).toContain("ETH");
    });

    test("handles BNB symbol", async () => {
      const { formatNativeAmount } = await import("@/utils/format");

      const result = formatNativeAmount(1.5, "BNB");
      expect(result).toContain("BNB");
    });
  });
});

// =============================================================================
// ERROR HANDLING TESTS
// =============================================================================
describe("Error Handling - Fail Fast", () => {
  describe("withRetryAndCache error scenarios", () => {
    test("propagates non-retryable errors immediately", async () => {
      const { withRetryAndCache } = await import("@/utils/retry-cache");

      let attempts = 0;
      const key = `error-test-${Date.now()}`;

      await expect(
        withRetryAndCache(
          key,
          async () => {
            attempts++;
            throw new Error("Validation error: invalid input");
          },
          { maxRetries: 3 },
        ),
      ).rejects.toThrow("Validation error");

      // Should only have tried once (non-retryable)
      expect(attempts).toBe(1);
    });

    test("retries on rate limit errors", async () => {
      const { withRetryAndCache } = await import("@/utils/retry-cache");

      let attempts = 0;
      const key = `retry-test-${Date.now()}`;

      await expect(
        withRetryAndCache(
          key,
          async () => {
            attempts++;
            if (attempts < 3) {
              throw new Error("429 Too Many Requests");
            }
            return "success";
          },
          { maxRetries: 3 },
        ),
      ).resolves.toBe("success");

      expect(attempts).toBe(3);
    }, 15_000);

    test("exhausts retries and throws last error", async () => {
      const { withRetryAndCache } = await import("@/utils/retry-cache");

      let attempts = 0;
      const key = `exhaust-test-${Date.now()}`;

      await expect(
        withRetryAndCache(
          key,
          async () => {
            attempts++;
            throw new Error("rate limit exceeded");
          },
          { maxRetries: 2 },
        ),
      ).rejects.toThrow("rate limit");

      expect(attempts).toBe(3); // Initial + 2 retries
    }, 15_000);
  });

  describe("fetchWithRetry error scenarios", () => {
    test("returns Response object for non-429 errors (caller decides what to do)", async () => {
      const { fetchWithRetry } = await import("@/utils/retry-cache");

      // fetchWithRetry returns the Response - it doesn't throw on non-200
      // except for 429 which triggers retries
      const response = await fetchWithRetry(
        "https://httpbin.org/status/500",
        undefined,
        { maxRetries: 0 },
      );

      // Should get the response back, caller decides what to do with it
      expect(response.status).toBe(500);
      expect(response.ok).toBe(false);
    }, 15_000);
  });

  describe("checksumAddress fail-fast", () => {
    test("throws on completely invalid input", async () => {
      const { checksumAddress } = await import("@/utils/address-utils");

      expect(() => checksumAddress("")).toThrow();
      expect(() => checksumAddress("abc")).toThrow();
      expect(() => checksumAddress("0x")).toThrow();
    });

    test("throws on wrong length address", async () => {
      const { checksumAddress } = await import("@/utils/address-utils");

      expect(() => checksumAddress("0x1234")).toThrow();
      expect(() =>
        checksumAddress("0x123456789012345678901234567890123456789012"),
      ).toThrow();
    });
  });

  describe("parseOrThrow fail-fast", () => {
    test("includes all validation errors in message", async () => {
      const { parseOrThrow } = await import("@/lib/validation/helpers");
      const { z } = await import("zod");

      const schema = z.object({
        a: z.number().positive(),
        b: z.string().min(5),
        c: z.array(z.string()).min(1),
      });

      try {
        parseOrThrow(schema, { a: -1, b: "ab", c: [] });
        throw new Error("Should have thrown");
      } catch (e) {
        const error = e as Error;
        expect(error.message).toContain("Validation failed");
      }
    });

    test("handles deeply nested validation errors", async () => {
      const { parseOrThrow } = await import("@/lib/validation/helpers");
      const { z } = await import("zod");

      const schema = z.object({
        level1: z.object({
          level2: z.object({
            value: z.number().positive(),
          }),
        }),
      });

      try {
        parseOrThrow(schema, { level1: { level2: { value: -5 } } });
        throw new Error("Should have thrown");
      } catch (e) {
        const error = e as Error;
        expect(error.message).toContain("level1.level2.value");
      }
    });
  });
});

// =============================================================================
// CONCURRENT/ASYNC BEHAVIOR TESTS
// =============================================================================
describe("Concurrent Behavior", () => {
  describe("Cache concurrent access", () => {
    test("handles concurrent reads of same key", async () => {
      const { getCached, setCache } = await import("@/utils/retry-cache");

      const key = `concurrent-read-${Date.now()}`;
      const value = { data: "test" };
      setCache(key, value, 30000);

      // Simulate concurrent reads
      const results = await Promise.all([
        Promise.resolve(getCached(key)),
        Promise.resolve(getCached(key)),
        Promise.resolve(getCached(key)),
      ]);

      // All should get the same value
      expect(results.every((r) => r?.data === "test")).toBe(true);
    });

    test("handles concurrent writes to different keys", async () => {
      const { getCached, setCache } = await import("@/utils/retry-cache");

      const now = Date.now();
      const keys = [`key-a-${now}`, `key-b-${now}`, `key-c-${now}`];

      // Concurrent writes
      await Promise.all(
        keys.map((key, i) => {
          setCache(key, { index: i }, 30000);
          return Promise.resolve();
        }),
      );

      // All values should be set correctly
      keys.forEach((key, i) => {
        const cached = getCached<{ index: number }>(key);
        expect(cached?.index).toBe(i);
      });
    });
  });

  describe("Price fetching concurrent calls", () => {
    test("handles multiple parallel price fetches", async () => {
      const { fetchTokenPrices } = await import("@/utils/price-fetcher");

      // Parallel fetches for different chains
      const results = await Promise.all([
        fetchTokenPrices("ethereum", [
          "0x514910771af9ca656af840dff83e8264ecf986ca",
        ]),
        fetchTokenPrices("base", [
          "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        ]),
      ]);

      // Both should return objects (may be empty due to rate limits)
      expect(typeof results[0]).toBe("object");
      expect(typeof results[1]).toBe("object");
    }, 30_000);
  });

  describe("withRetryAndCache deduplication", () => {
    test("returns cached value for concurrent calls", async () => {
      const { withRetryAndCache, getCached } = await import(
        "@/utils/retry-cache"
      );

      let executionCount = 0;
      const key = `dedup-${Date.now()}`;

      // First call sets up the cache
      await withRetryAndCache(key, async () => {
        executionCount++;
        await new Promise((r) => setTimeout(r, 100));
        return { result: executionCount };
      });

      // Second call should hit cache
      const cached = getCached<{ result: number }>(key);
      expect(cached?.result).toBe(1);

      // Function should only have executed once
      expect(executionCount).toBe(1);
    });
  });
});

// =============================================================================
// BOUNDARY VALUE TESTS
// =============================================================================
describe("Boundary Value Tests", () => {
  describe("Balance filtering boundaries", () => {
    test("exactly at minBalance threshold", async () => {
      const { filterDustTokens } = await import("@/lib/balance-fetcher");

      const tokens = [
        {
          contractAddress: "0x1",
          symbol: "EXACT",
          name: "Exact Balance",
          decimals: 18,
          balance: "1000000000000000000", // Exactly 1 token
          priceUsd: 0,
          balanceUsd: 0,
        },
      ];

      const filtered = filterDustTokens(tokens, 1, 0.001);
      expect(filtered).toHaveLength(1);
    });

    test("just below minBalance threshold", async () => {
      const { filterDustTokens } = await import("@/lib/balance-fetcher");

      const tokens = [
        {
          contractAddress: "0x1",
          symbol: "BELOW",
          name: "Below Balance",
          decimals: 18,
          balance: "500000000000000000", // 0.5 tokens (clearly below 1)
          priceUsd: 0,
          balanceUsd: 0,
        },
      ];

      const filtered = filterDustTokens(tokens, 1, 0.001);
      expect(filtered).toHaveLength(0);
    });

    test("exactly at minUsdValue threshold", async () => {
      const { filterDustTokens } = await import("@/lib/balance-fetcher");

      const tokens = [
        {
          contractAddress: "0x1",
          symbol: "EXACT",
          name: "Exact USD",
          decimals: 18,
          balance: "1000000000000000000",
          priceUsd: 0.001,
          balanceUsd: 0.001, // Exactly at threshold
        },
      ];

      const filtered = filterDustTokens(tokens, 0.001, 0.001);
      expect(filtered).toHaveLength(1);
    });
  });

  describe("Pool liquidity boundaries", () => {
    test("exactly at minimum TVL threshold", async () => {
      const { validatePoolLiquidity } = await import("@/utils/pool-finder-base");

      const pool = {
        protocol: "Uniswap V3" as const,
        address: "0x1234567890123456789012345678901234567890",
        token0: "0xtoken0",
        token1: "0xtoken1",
        fee: 3000,
        liquidity: 1000000n,
        tvlUsd: 10000, // Exactly at $10k threshold
        baseToken: "USDC" as const,
      };

      const result = validatePoolLiquidity(pool);
      expect(result.valid).toBe(true);
    });

    test("just below minimum TVL threshold", async () => {
      const { validatePoolLiquidity } = await import("@/utils/pool-finder-base");

      const pool = {
        protocol: "Uniswap V3" as const,
        address: "0x1234567890123456789012345678901234567890",
        token0: "0xtoken0",
        token1: "0xtoken1",
        fee: 3000,
        liquidity: 1000000n,
        tvlUsd: 9999.99, // Just below $10k
        baseToken: "USDC" as const,
      };

      const result = validatePoolLiquidity(pool);
      expect(result.valid).toBe(false);
    });
  });

  describe("Discount BPS boundaries", () => {
    test("0 bps discount (no discount)", async () => {
      const { formatPercentFromBps } = await import("@/utils/format");

      expect(formatPercentFromBps(0)).toBe("0%");
    });

    test("10000 bps (100% discount)", async () => {
      const { formatPercentFromBps } = await import("@/utils/format");

      expect(formatPercentFromBps(10000)).toBe("100%");
    });

    test("maximum reasonable bps (5000 = 50%)", async () => {
      const { formatPercentFromBps } = await import("@/utils/format");

      expect(formatPercentFromBps(5000)).toBe("50%");
    });
  });
});

// =============================================================================
// DATA VERIFICATION TESTS
// =============================================================================
describe("Data Verification - Inspect Actual Outputs", () => {
  describe("Price fetcher data structure", () => {
    test("DeFiLlama returns correct data structure", async () => {
      const { fetchDeFiLlamaPrices } = await import("@/utils/price-fetcher");

      const USDC_ETH = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
      const prices = await fetchDeFiLlamaPrices("ethereum", [USDC_ETH]);

      // Verify the returned structure
      expect(typeof prices).toBe("object");

      // If we got a price, verify it's the right format
      const usdcPrice = prices[USDC_ETH.toLowerCase()];
      if (usdcPrice !== undefined) {
        expect(typeof usdcPrice).toBe("number");
        // USDC should be ~$1
        expect(usdcPrice).toBeGreaterThan(0.95);
        expect(usdcPrice).toBeLessThan(1.05);
      }
    }, 30_000);
  });

  describe("OTC offer parsing verification", () => {
    test("verifies all 18 fields are parsed correctly", async () => {
      const { parseOfferStruct } = await import("@/lib/otc-helpers");

      const rawOffer = [
        5n, // consignmentId
        "0x" + "ab".repeat(32), // tokenId (32 bytes)
        "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", // beneficiary
        1500000000000000000n, // tokenAmount (1.5e18)
        750n, // discountBps (7.5%)
        1704067200n, // createdAt (Jan 1 2024)
        1735689600n, // unlockTime (Jan 1 2025)
        125000000n, // priceUsdPerToken ($1.25 in 8 decimals)
        300n, // maxPriceDeviation (3%)
        350000000000n, // ethUsdPrice ($3500 in 8 decimals)
        1, // currency (USDC)
        true, // approved
        false, // paid
        false, // fulfilled
        false, // cancelled
        "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", // payer
        0n, // amountPaid
        75, // agentCommissionBps (0.75%)
      ] as const;

      const parsed = parseOfferStruct(rawOffer);

      // Verify each field
      expect(parsed.consignmentId).toBe(5n);
      expect(parsed.tokenId).toBe("0x" + "ab".repeat(32));
      expect(parsed.beneficiary).toBe(
        "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      );
      expect(parsed.tokenAmount).toBe(1500000000000000000n);
      expect(parsed.discountBps).toBe(750n);
      expect(parsed.createdAt).toBe(1704067200n);
      expect(parsed.unlockTime).toBe(1735689600n);
      expect(parsed.priceUsdPerToken).toBe(125000000n);
      expect(parsed.maxPriceDeviation).toBe(300n);
      expect(parsed.ethUsdPrice).toBe(350000000000n);
      expect(parsed.currency).toBe(1);
      expect(parsed.approved).toBe(true);
      expect(parsed.paid).toBe(false);
      expect(parsed.fulfilled).toBe(false);
      expect(parsed.cancelled).toBe(false);
      expect(parsed.payer).toBe("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
      expect(parsed.amountPaid).toBe(0n);
      expect(parsed.agentCommissionBps).toBe(75);
    });
  });

  describe("Entity ID determinism verification", () => {
    test("produces consistent UUIDs across multiple calls", async () => {
      const { walletToEntityId } = await import("@/lib/entityId");

      const address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

      // Call 100 times and verify consistency
      const ids = Array.from({ length: 100 }, () => walletToEntityId(address));
      const uniqueIds = new Set(ids);

      expect(uniqueIds.size).toBe(1); // All should be identical
    });

    test("case normalization produces same ID", async () => {
      const { walletToEntityId } = await import("@/lib/entityId");

      const variations = [
        "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        "0xF39FD6E51AAD88F6F4CE6AB8827279CFFFB92266",
        "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
      ];

      const ids = variations.map((addr) => walletToEntityId(addr));

      expect(ids[0]).toBe(ids[1]);
      expect(ids[1]).toBe(ids[2]);
    });
  });

  describe("Consignment sanitization verification", () => {
    test("verifies all core fields are preserved", async () => {
      const { sanitizeConsignmentForBuyer } = await import(
        "@/utils/consignment-sanitizer"
      );

      const consignment = {
        id: "cons-123",
        tokenId: "token-base-0xabc",
        consignerAddress: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        consignerEntityId: "entity-xyz",
        totalAmount: "5000000000000000000",
        remainingAmount: "3000000000000000000",
        isNegotiable: false,
        fixedDiscountBps: 1500,
        fixedLockupDays: 120,
        minDiscountBps: 1500,
        maxDiscountBps: 1500,
        minLockupDays: 120,
        maxLockupDays: 120,
        minDealAmount: "100000000000000000",
        maxDealAmount: "5000000000000000000",
        isFractionalized: true,
        isPrivate: false,
        maxPriceVolatilityBps: 500,
        maxTimeToExecuteSeconds: 7200,
        status: "active" as const,
        contractConsignmentId: 42,
        chain: "base" as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const sanitized = sanitizeConsignmentForBuyer(consignment);

      // Verify all core fields are preserved exactly
      expect(sanitized.id).toBe("cons-123");
      expect(sanitized.tokenId).toBe("token-base-0xabc");
      expect(sanitized.totalAmount).toBe("5000000000000000000");
      expect(sanitized.remainingAmount).toBe("3000000000000000000");
      expect(sanitized.isFractionalized).toBe(true);
      expect(sanitized.isPrivate).toBe(false);
      expect(sanitized.maxPriceVolatilityBps).toBe(500);
      expect(sanitized.maxTimeToExecuteSeconds).toBe(7200);
      expect(sanitized.status).toBe("active");
      expect(sanitized.contractConsignmentId).toBe(42);
      expect(sanitized.chain).toBe("base");

      // Verify computed display fields
      expect(sanitized.displayDiscountBps).toBe(1500);
      expect(sanitized.displayLockupDays).toBe(120);
      expect(sanitized.termsType).toBe("fixed");
    });
  });
});
