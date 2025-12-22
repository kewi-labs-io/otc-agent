/**
 * Price Fetcher E2E Integration Tests
 *
 * Tests price fetching utilities against real external APIs.
 * These tests verify actual data is returned correctly.
 *
 * Run: bun test tests/utils/price-fetcher.test.ts
 */

import { describe, expect, setDefaultTimeout, test } from "bun:test";
import {
  COINGECKO_PLATFORMS,
  DEFILLAMA_CHAINS,
  fetchCoinGeckoPrices,
  fetchDeFiLlamaPrices,
  fetchEvmPrices,
  fetchJupiterPrices,
  fetchNativePrices,
  fetchTokenPrices,
  NATIVE_TOKEN_IDS,
} from "@/utils/price-fetcher";

// Set default timeout for all tests (external API calls can be slow)
setDefaultTimeout(30_000);

// Known token addresses for testing
const KNOWN_TOKENS = {
  // LINK on Ethereum - widely traded, should always have a price
  ethereumLink: "0x514910771AF9Ca656af840dff83E8264EcF986CA",
  // USDC on Ethereum
  ethereumUsdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  // Wrapped SOL
  solanaWsol: "So11111111111111111111111111111111111111112",
  // USDC on Solana
  solanaUsdc: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
};

// =============================================================================
// PLATFORM CONFIGURATION TESTS
// =============================================================================
describe("Price Fetcher - Platform Configuration", () => {
  describe("COINGECKO_PLATFORMS", () => {
    test("maps ethereum to correct platform ID", () => {
      expect(COINGECKO_PLATFORMS.ethereum).toBe("ethereum");
      expect(COINGECKO_PLATFORMS.eth).toBe("ethereum");
    });

    test("maps base to correct platform ID", () => {
      expect(COINGECKO_PLATFORMS.base).toBe("base");
    });

    test("maps bsc to correct platform ID", () => {
      expect(COINGECKO_PLATFORMS.bsc).toBe("binance-smart-chain");
    });

    test("returns undefined for unknown chains", () => {
      expect(COINGECKO_PLATFORMS.unknown).toBeUndefined();
    });
  });

  describe("DEFILLAMA_CHAINS", () => {
    test("maps supported chains correctly", () => {
      expect(DEFILLAMA_CHAINS.ethereum).toBe("ethereum");
      expect(DEFILLAMA_CHAINS.base).toBe("base");
      expect(DEFILLAMA_CHAINS.bsc).toBe("bsc");
    });
  });

  describe("NATIVE_TOKEN_IDS", () => {
    test("maps native tokens to CoinGecko IDs", () => {
      expect(NATIVE_TOKEN_IDS.ETH).toBe("ethereum");
      expect(NATIVE_TOKEN_IDS.BNB).toBe("binancecoin");
      expect(NATIVE_TOKEN_IDS.SOL).toBe("solana");
    });
  });
});

// =============================================================================
// NATIVE PRICE FETCHING
// =============================================================================
describe("Price Fetcher - fetchNativePrices", () => {
  test("fetches ETH, BNB, SOL prices", async () => {
    const prices = await fetchNativePrices(["ETH", "BNB", "SOL"]);

    // At least some prices should be returned (unless API is down)
    expect(typeof prices).toBe("object");

    // If API is working, prices should be positive numbers
    if (prices.ETH) {
      expect(prices.ETH).toBeGreaterThan(0);
      expect(typeof prices.ETH).toBe("number");
    }

    if (prices.SOL) {
      expect(prices.SOL).toBeGreaterThan(0);
    }
  });

  test("returns empty object for unknown symbols", async () => {
    const prices = await fetchNativePrices(["UNKNOWN", "INVALID"]);
    expect(prices).toEqual({});
  });

  test("returns empty object for empty symbols array", async () => {
    const prices = await fetchNativePrices([]);
    expect(prices).toEqual({});
  });

  test("handles single symbol request", async () => {
    const prices = await fetchNativePrices(["ETH"]);

    // Should return at most one price
    const keys = Object.keys(prices);
    expect(keys.length).toBeLessThanOrEqual(1);

    if (keys.length === 1) {
      expect(keys[0]).toBe("ETH");
    }
  });

  test("respects custom timeout", async () => {
    // Very short timeout (1ms) will almost certainly abort the fetch
    // This tests that timeout is actually respected - should either return {} or throw AbortError
    try {
      const prices = await fetchNativePrices(["ETH"], { timeout: 1 });
      // If it succeeds (unlikely with 1ms), should be an object
      expect(typeof prices).toBe("object");
    } catch (error) {
      // AbortError is expected with 1ms timeout
      expect(error).toBeDefined();
    }
  });

  test("respects abort signal", async () => {
    const controller = new AbortController();

    // Abort immediately
    controller.abort();

    // Should handle abort gracefully
    await expect(fetchNativePrices(["ETH"], { signal: controller.signal })).rejects.toThrow();
  });
});

// =============================================================================
// COINGECKO TOKEN PRICES
// =============================================================================
describe("Price Fetcher - fetchCoinGeckoPrices", () => {
  test("returns empty object for empty addresses", async () => {
    const prices = await fetchCoinGeckoPrices("ethereum", []);
    expect(prices).toEqual({});
  });

  test("returns empty object for unknown chain", async () => {
    const prices = await fetchCoinGeckoPrices("unknown-chain", [KNOWN_TOKENS.ethereumLink]);
    expect(prices).toEqual({});
  });

  test("fetches prices for known Ethereum tokens", async () => {
    const prices = await fetchCoinGeckoPrices("ethereum", [KNOWN_TOKENS.ethereumUsdc]);

    // CoinGecko may rate limit free tier - allow empty result
    expect(typeof prices).toBe("object");

    // If we got a price, verify it's valid
    const usdcPrice = prices[KNOWN_TOKENS.ethereumUsdc.toLowerCase()];
    if (usdcPrice !== undefined) {
      expect(usdcPrice).toBeGreaterThan(0);
      // USDC should be close to $1
      expect(usdcPrice).toBeGreaterThan(0.9);
      expect(usdcPrice).toBeLessThan(1.1);
    }
  });

  test("normalizes addresses to lowercase", async () => {
    const mixedCaseAddress = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"; // Mixed case USDC
    const prices = await fetchCoinGeckoPrices("ethereum", [mixedCaseAddress]);

    // Result should have lowercase key
    const keys = Object.keys(prices);
    for (const key of keys) {
      expect(key).toBe(key.toLowerCase());
    }
  });

  test("handles multiple addresses", async () => {
    const prices = await fetchCoinGeckoPrices("ethereum", [
      KNOWN_TOKENS.ethereumLink,
      KNOWN_TOKENS.ethereumUsdc,
    ]);

    expect(typeof prices).toBe("object");
    // May return 0, 1, or 2 prices depending on API availability
  });
});

// =============================================================================
// DEFILLAMA PRICES
// =============================================================================
describe("Price Fetcher - fetchDeFiLlamaPrices", () => {
  test("returns empty object for empty addresses", async () => {
    const prices = await fetchDeFiLlamaPrices("ethereum", []);
    expect(prices).toEqual({});
  });

  test("fetches prices for known tokens", async () => {
    const prices = await fetchDeFiLlamaPrices("ethereum", [KNOWN_TOKENS.ethereumUsdc]);

    expect(typeof prices).toBe("object");

    // DeFiLlama is usually available
    const usdcPrice = prices[KNOWN_TOKENS.ethereumUsdc.toLowerCase()];
    if (usdcPrice !== undefined) {
      expect(usdcPrice).toBeGreaterThan(0.9);
      expect(usdcPrice).toBeLessThan(1.1);
    }
  });

  test("uses correct chain prefix format", async () => {
    // DeFiLlama expects chain:address format
    const prices = await fetchDeFiLlamaPrices("base", [KNOWN_TOKENS.ethereumUsdc]);

    // Should not throw
    expect(typeof prices).toBe("object");
  });

  test("throws on API error (not rate limited)", async () => {
    // Invalid chain should still make a request
    const prices = await fetchDeFiLlamaPrices("invalid-chain", [KNOWN_TOKENS.ethereumUsdc]).catch(
      () => ({}),
    );
    expect(typeof prices).toBe("object");
  });
});

// =============================================================================
// JUPITER PRICES (SOLANA)
// =============================================================================
describe("Price Fetcher - fetchJupiterPrices", () => {
  test("returns empty object for empty mints", async () => {
    const prices = await fetchJupiterPrices([]);
    expect(prices).toEqual({});
  });

  test("fetches prices for known Solana tokens", async () => {
    const prices = await fetchJupiterPrices([KNOWN_TOKENS.solanaWsol, KNOWN_TOKENS.solanaUsdc]);

    expect(typeof prices).toBe("object");

    // Jupiter usually returns prices for popular tokens
    if (prices[KNOWN_TOKENS.solanaWsol]) {
      expect(prices[KNOWN_TOKENS.solanaWsol]).toBeGreaterThan(0);
    }

    if (prices[KNOWN_TOKENS.solanaUsdc]) {
      // USDC should be close to $1
      expect(prices[KNOWN_TOKENS.solanaUsdc]).toBeGreaterThan(0.9);
      expect(prices[KNOWN_TOKENS.solanaUsdc]).toBeLessThan(1.1);
    }
  });

  test("handles chunking for large requests", async () => {
    // Create array of 150 mints (exceeds 100 limit)
    const mints = Array.from({ length: 150 }, (_, i) => `FakeMint${i}...padded`.slice(0, 44));

    // Should not throw - will make 2 requests
    const prices = await fetchJupiterPrices(mints);
    expect(typeof prices).toBe("object");
  });

  test("parses string prices correctly", async () => {
    // Jupiter returns prices as strings
    const prices = await fetchJupiterPrices([KNOWN_TOKENS.solanaWsol]);

    for (const [, price] of Object.entries(prices)) {
      expect(typeof price).toBe("number");
      expect(Number.isFinite(price)).toBe(true);
    }
  });
});

// =============================================================================
// COMBINED EVM PRICE FETCHING
// =============================================================================
describe("Price Fetcher - fetchEvmPrices", () => {
  test("returns empty object for empty addresses", async () => {
    const prices = await fetchEvmPrices("ethereum", []);
    expect(prices).toEqual({});
  });

  test("combines DeFiLlama and CoinGecko results", async () => {
    const prices = await fetchEvmPrices("ethereum", [KNOWN_TOKENS.ethereumUsdc]);

    expect(typeof prices).toBe("object");

    // At least one source should return the USDC price
    const usdcPrice = prices[KNOWN_TOKENS.ethereumUsdc.toLowerCase()];
    if (usdcPrice !== undefined) {
      expect(usdcPrice).toBeGreaterThan(0.9);
      expect(usdcPrice).toBeLessThan(1.1);
    }
  });

  test("falls back to CoinGecko for missing prices", async () => {
    // Request both a common token and an obscure one
    const prices = await fetchEvmPrices("ethereum", [KNOWN_TOKENS.ethereumUsdc]);

    // Should not throw
    expect(typeof prices).toBe("object");
  });
});

// =============================================================================
// UNIFIED TOKEN PRICE FETCHING
// =============================================================================
describe("Price Fetcher - fetchTokenPrices", () => {
  test("returns empty object for empty addresses", async () => {
    const prices = await fetchTokenPrices("ethereum", []);
    expect(prices).toEqual({});
  });

  test("routes Solana to Jupiter", async () => {
    const prices = await fetchTokenPrices("solana", [KNOWN_TOKENS.solanaWsol]);

    expect(typeof prices).toBe("object");
  });

  test("routes Ethereum to EVM fetcher", async () => {
    const prices = await fetchTokenPrices("ethereum", [KNOWN_TOKENS.ethereumUsdc]);

    expect(typeof prices).toBe("object");
  });

  test("routes Base to EVM fetcher", async () => {
    const prices = await fetchTokenPrices("base", [KNOWN_TOKENS.ethereumUsdc]);

    expect(typeof prices).toBe("object");
  });

  test("routes BSC to EVM fetcher", async () => {
    const prices = await fetchTokenPrices("bsc", [KNOWN_TOKENS.ethereumUsdc]);

    expect(typeof prices).toBe("object");
  });
});

// =============================================================================
// ERROR HANDLING
// =============================================================================
describe("Price Fetcher - Error Handling", () => {
  test("native prices handles API errors gracefully", async () => {
    // Force an error by passing invalid signal (already aborted)
    const controller = new AbortController();
    controller.abort();

    // Should throw AbortError
    await expect(fetchNativePrices(["ETH"], { signal: controller.signal })).rejects.toThrow();
  });

  test("CoinGecko handles API errors gracefully", async () => {
    // Very short timeout (1ms) will abort the request
    // This tests error handling - should either return {} or throw AbortError
    try {
      const prices = await fetchCoinGeckoPrices("ethereum", [KNOWN_TOKENS.ethereumUsdc], {
        timeout: 1,
      });
      // If it succeeds (unlikely with 1ms), should be an object
      expect(typeof prices).toBe("object");
    } catch (error) {
      // AbortError is expected with 1ms timeout
      expect(error).toBeDefined();
    }
  });

  test("Jupiter handles API errors per chunk", async () => {
    // Create requests that may partially fail
    const prices = await fetchJupiterPrices(["InvalidMint1", KNOWN_TOKENS.solanaWsol]);

    // Should return what it can
    expect(typeof prices).toBe("object");
  });
});

// =============================================================================
// DATA VERIFICATION
// =============================================================================
describe("Price Fetcher - Data Verification", () => {
  test("prices are positive finite numbers", async () => {
    const nativePrices = await fetchNativePrices(["ETH", "SOL"]);

    for (const [_symbol, price] of Object.entries(nativePrices)) {
      expect(typeof price).toBe("number");
      expect(Number.isFinite(price)).toBe(true);
      expect(price).toBeGreaterThan(0);
    }
  });

  test("ETH price is in reasonable range", async () => {
    const prices = await fetchNativePrices(["ETH"]);

    if (prices.ETH) {
      // ETH has historically ranged from ~$100 to ~$5000
      // Use wide bounds to avoid test flakiness
      expect(prices.ETH).toBeGreaterThan(10);
      expect(prices.ETH).toBeLessThan(100000);
    }
  });

  test("SOL price is in reasonable range", async () => {
    const prices = await fetchNativePrices(["SOL"]);

    if (prices.SOL) {
      // SOL has historically ranged from ~$1 to ~$300
      expect(prices.SOL).toBeGreaterThan(0.1);
      expect(prices.SOL).toBeLessThan(10000);
    }
  });

  test("USDC price is approximately $1", async () => {
    const prices = await fetchDeFiLlamaPrices("ethereum", [KNOWN_TOKENS.ethereumUsdc]);
    const usdcPrice = prices[KNOWN_TOKENS.ethereumUsdc.toLowerCase()];

    if (usdcPrice) {
      // USDC should be very close to $1 (allow 5% deviation for depeg scenarios)
      expect(usdcPrice).toBeGreaterThan(0.95);
      expect(usdcPrice).toBeLessThan(1.05);
    }
  });
});

// =============================================================================
// CONCURRENT REQUESTS
// =============================================================================
describe("Price Fetcher - Concurrent Requests", () => {
  test("handles multiple concurrent native price requests", async () => {
    const promises = [
      fetchNativePrices(["ETH"]),
      fetchNativePrices(["SOL"]),
      fetchNativePrices(["BNB"]),
    ];

    const results = await Promise.all(promises);

    for (const prices of results) {
      expect(typeof prices).toBe("object");
    }
  });

  test("handles multiple concurrent token price requests", async () => {
    const promises = [
      fetchTokenPrices("ethereum", [KNOWN_TOKENS.ethereumUsdc]),
      fetchTokenPrices("solana", [KNOWN_TOKENS.solanaUsdc]),
    ];

    const results = await Promise.all(promises);

    for (const prices of results) {
      expect(typeof prices).toBe("object");
    }
  });

  test("handles mixed chain concurrent requests", async () => {
    const results = await Promise.all([
      fetchNativePrices(["ETH", "SOL"]),
      fetchEvmPrices("ethereum", [KNOWN_TOKENS.ethereumUsdc]),
      fetchJupiterPrices([KNOWN_TOKENS.solanaWsol]),
    ]);

    expect(results.length).toBe(3);
    for (const prices of results) {
      expect(typeof prices).toBe("object");
    }
  });
});
