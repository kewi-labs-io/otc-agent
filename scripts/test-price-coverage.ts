/**
 * Price Coverage Test Script
 *
 * Tests that ALL token types across ALL chains get prices reliably.
 * Run with: bun scripts/test-price-coverage.ts
 */

import { findAllPools } from "../src/utils/pool-finder-base";
import { findBestSolanaPool } from "../src/utils/pool-finder-solana";
import { fetchEvmPrices, fetchJupiterPrices } from "../src/utils/price-fetcher";

// Test tokens representing different scenarios
const TEST_TOKENS = {
  // EVM - Ethereum
  ethereum: {
    // Major token - should always work
    WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    // Established token
    USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    // Newer token (may not be on CoinGecko)
    PEPE: "0x6982508145454Ce325dDbE47a25d4ec3d2311933",
  },
  // EVM - Base
  base: {
    // Clanker V3 token
    DEGEN: "0x4ed4e862860bed51a9570b96d89af5e1b0efefed",
    // Aerodrome paired
    AERO: "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
    // Virtual token (newer)
    VIRTUAL: "0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b",
  },
  // EVM - BSC
  bsc: {
    // Major token
    WBNB: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
    // PancakeSwap token
    CAKE: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82",
  },
  // Solana
  solana: {
    // Major token - Jupiter should have
    BONK: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    // Raydium paired
    RAY: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
    // Pump.fun graduated (should have PumpSwap pool)
    // Using a known graduated token - MOODENG
    MOODENG: "ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzPJBY",
  },
};

interface TestResult {
  token: string;
  chain: string;
  symbol: string;
  priceSource: string | null;
  price: number | null;
  poolFound: boolean;
  poolProtocol: string | null;
  tvlUsd: number | null;
  error: string | null;
  fallbacksUsed: string[];
}

async function testEvmToken(
  chain: "ethereum" | "base" | "bsc",
  address: string,
  symbol: string,
): Promise<TestResult> {
  const chainIds: Record<string, number> = {
    ethereum: 1,
    base: 8453,
    bsc: 56,
  };
  const chainId = chainIds[chain];
  const fallbacksUsed: string[] = [];

  const result: TestResult = {
    token: address,
    chain,
    symbol,
    priceSource: null,
    price: null,
    poolFound: false,
    poolProtocol: null,
    tvlUsd: null,
    error: null,
    fallbacksUsed,
  };

  // Test 1: Pool finder
  try {
    const pools = await findAllPools(address, chainId);
    if (pools.length > 0) {
      const best = pools[0];
      result.poolFound = true;
      result.poolProtocol = best.protocol;
      result.tvlUsd = best.tvlUsd;
      if (best.priceUsd && best.priceUsd > 0) {
        result.price = best.priceUsd;
        result.priceSource = `pool:${best.protocol}`;
      }
    }
  } catch (e) {
    result.error = `Pool finder: ${e instanceof Error ? e.message : String(e)}`;
  }

  // Test 2: Price fetcher if no pool price
  if (!result.price) {
    try {
      fallbacksUsed.push("price-fetcher");
      const prices = await fetchEvmPrices(chain, [address]);
      const price = prices[address.toLowerCase()];
      if (price && price > 0) {
        result.price = price;
        result.priceSource = "price-fetcher";
      }
    } catch (e) {
      result.error = `Price fetcher: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  return result;
}

async function testSolanaToken(mint: string, symbol: string): Promise<TestResult> {
  const fallbacksUsed: string[] = [];

  const result: TestResult = {
    token: mint,
    chain: "solana",
    symbol,
    priceSource: null,
    price: null,
    poolFound: false,
    poolProtocol: null,
    tvlUsd: null,
    error: null,
    fallbacksUsed,
  };

  // Test 1: Pool finder
  try {
    const pool = await findBestSolanaPool(mint, "mainnet");
    if (pool) {
      result.poolFound = true;
      result.poolProtocol = pool.protocol;
      result.tvlUsd = pool.tvlUsd;
      if (pool.priceUsd && pool.priceUsd > 0) {
        result.price = pool.priceUsd;
        result.priceSource = `pool:${pool.protocol}`;
      }
    }
  } catch (e) {
    result.error = `Pool finder: ${e instanceof Error ? e.message : String(e)}`;
  }

  // Test 2: Jupiter if no pool price
  if (!result.price) {
    try {
      fallbacksUsed.push("jupiter");
      const prices = await fetchJupiterPrices([mint]);
      if (prices[mint] && prices[mint] > 0) {
        result.price = prices[mint];
        result.priceSource = "jupiter";
      }
    } catch (e) {
      result.error = `Jupiter: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  return result;
}

async function runTests(): Promise<void> {
  console.log("=".repeat(80));
  console.log("PRICE COVERAGE TEST");
  console.log("=".repeat(80));
  console.log();

  const results: TestResult[] = [];
  let passCount = 0;
  let failCount = 0;

  // Test Ethereum tokens
  console.log("Testing Ethereum tokens...");
  for (const [symbol, address] of Object.entries(TEST_TOKENS.ethereum)) {
    const result = await testEvmToken("ethereum", address, symbol);
    results.push(result);
    await delay(500); // Rate limit protection
  }

  // Test Base tokens
  console.log("Testing Base tokens...");
  for (const [symbol, address] of Object.entries(TEST_TOKENS.base)) {
    const result = await testEvmToken("base", address, symbol);
    results.push(result);
    await delay(500);
  }

  // Test BSC tokens
  console.log("Testing BSC tokens...");
  for (const [symbol, address] of Object.entries(TEST_TOKENS.bsc)) {
    const result = await testEvmToken("bsc", address, symbol);
    results.push(result);
    await delay(500);
  }

  // Test Solana tokens
  console.log("Testing Solana tokens...");
  for (const [symbol, mint] of Object.entries(TEST_TOKENS.solana)) {
    const result = await testSolanaToken(mint, symbol);
    results.push(result);
    await delay(500);
  }

  // Print results
  console.log();
  console.log("=".repeat(80));
  console.log("RESULTS");
  console.log("=".repeat(80));
  console.log();

  for (const r of results) {
    const status = r.price !== null ? "✅ PASS" : "❌ FAIL";
    if (r.price !== null) passCount++;
    else failCount++;

    console.log(`${status} ${r.chain}/${r.symbol}`);
    console.log(`   Address: ${r.token.slice(0, 20)}...`);
    if (r.price !== null) {
      console.log(`   Price: $${r.price.toFixed(8)} (via ${r.priceSource})`);
    }
    if (r.poolFound) {
      console.log(`   Pool: ${r.poolProtocol} (TVL: $${r.tvlUsd?.toLocaleString() ?? "unknown"})`);
    }
    if (r.error) {
      console.log(`   Error: ${r.error}`);
    }
    if (r.fallbacksUsed.length > 0) {
      console.log(`   Fallbacks tried: ${r.fallbacksUsed.join(", ")}`);
    }
    console.log();
  }

  // Summary
  console.log("=".repeat(80));
  console.log("SUMMARY");
  console.log("=".repeat(80));
  console.log(`Total: ${results.length}`);
  console.log(`Pass: ${passCount}`);
  console.log(`Fail: ${failCount}`);
  console.log();

  // Identify gaps
  const failures = results.filter((r) => r.price === null);
  if (failures.length > 0) {
    console.log("GAPS IDENTIFIED:");
    for (const f of failures) {
      console.log(`  - ${f.chain}/${f.symbol}: ${f.error ?? "No price found"}`);
    }
  }

  // Exit with error if any failures
  if (failCount > 0) {
    process.exit(1);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Run
runTests().catch((err) => {
  console.error("Test runner failed:", err);
  process.exit(1);
});
