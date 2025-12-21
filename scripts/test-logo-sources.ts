/**
 * Test script for multi-source token logo fetching
 * 
 * Tests: Alchemy -> TrustWallet -> CoinGecko
 * 
 * Run with: bun run scripts/test-logo-sources.ts
 */

import { getAddress } from "viem";

// Popular tokens to test
const TEST_TOKENS = {
  ethereum: [
    { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", name: "USDC" },
    { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", name: "USDT" },
    { address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", name: "DAI" },
    { address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", name: "WBTC" },
    { address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", name: "WETH" },
    { address: "0x6982508145454Ce325dDbE47a25d4ec3d2311933", name: "PEPE" },
  ],
  base: [
    { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", name: "USDC" },
    { address: "0x4200000000000000000000000000000000000006", name: "WETH" },
    { address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", name: "DAI" },
    { address: "0x532f27101965dd16442E59d40670FaF5eBB142E4", name: "BRETT" },
  ],
};

const CHAIN_CONFIG: Record<string, { 
  alchemyNetwork: string; 
  trustwalletChain: string;
  coingeckoPlatform: string;
}> = {
  ethereum: {
    alchemyNetwork: "eth-mainnet",
    trustwalletChain: "ethereum",
    coingeckoPlatform: "ethereum",
  },
  base: {
    alchemyNetwork: "base-mainnet",
    trustwalletChain: "base",
    coingeckoPlatform: "base",
  },
};

function checksumAddress(address: string): string {
  return getAddress(address);
}

// Test Alchemy
async function testAlchemy(address: string, chain: string): Promise<string | null> {
  const alchemyKey = process.env.ALCHEMY_API_KEY;
  if (!alchemyKey) {
    return null;
  }
  
  const config = CHAIN_CONFIG[chain];
  const url = `https://${config.alchemyNetwork}.g.alchemy.com/v2/${alchemyKey}`;
  
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "alchemy_getTokenMetadata",
      params: [address],
    }),
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json() as { result?: { logo?: string } };
  if (data.result?.logo) return data.result.logo;
  return null;
}

// Test TrustWallet
async function testTrustWallet(address: string, chain: string): Promise<string | null> {
  const config = CHAIN_CONFIG[chain];
  const checksummed = checksumAddress(address);
  const url = `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${config.trustwalletChain}/assets/${checksummed}/logo.png`;

  const response = await fetch(url, {
    method: "GET",
    headers: { Range: "bytes=0-0" },
    signal: AbortSignal.timeout(3000),
  });

  if (response.ok || response.status === 206) {
    return url;
  }
  return null;
}

// Test CoinGecko (note: has rate limits on free tier)
async function testCoinGecko(address: string, chain: string): Promise<string | null> {
  const config = CHAIN_CONFIG[chain];
  const url = `https://api.coingecko.com/api/v3/coins/${config.coingeckoPlatform}/contract/${address.toLowerCase()}`;

  const response = await fetch(url, {
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json() as { image?: { small?: string; thumb?: string } };
  if (data.image?.small) return data.image.small;
  if (data.image?.thumb) return data.image.thumb;
  return null;
}

// Main test runner
async function runTests() {
  console.log("\n========================================");
  console.log("  Token Logo Source Test");
  console.log("========================================\n");

  const results: {
    chain: string;
    token: string;
    address: string;
    alchemy: boolean;
    trustwallet: boolean;
    coingecko: boolean;
    anyFound: boolean;
  }[] = [];

  for (const [chain, tokens] of Object.entries(TEST_TOKENS)) {
    console.log(`\n--- ${chain.toUpperCase()} ---\n`);

    for (const token of tokens) {
      process.stdout.write(`Testing ${token.name.padEnd(6)} (${token.address.slice(0, 10)}...)... `);

      const [alchemy, trustwallet, coingecko] = await Promise.all([
        testAlchemy(token.address, chain),
        testTrustWallet(token.address, chain),
        testCoinGecko(token.address, chain),
      ]);

      const anyFound = !!(alchemy || trustwallet || coingecko);

      results.push({
        chain,
        token: token.name,
        address: token.address,
        alchemy: !!alchemy,
        trustwallet: !!trustwallet,
        coingecko: !!coingecko,
        anyFound,
      });

      const sources = [];
      if (alchemy) sources.push("Alchemy");
      if (trustwallet) sources.push("TrustWallet");
      if (coingecko) sources.push("CoinGecko");

      if (anyFound) {
        console.log(`FOUND [${sources.join(", ")}]`);
      } else {
        console.log("NOT FOUND");
      }
    }
  }

  // Summary
  console.log("\n========================================");
  console.log("  SUMMARY");
  console.log("========================================\n");

  console.log("| Chain    | Token  | Alchemy | TrustWallet | CoinGecko |");
  console.log("|----------|--------|---------|-------------|-----------|");

  for (const r of results) {
    const checkOrX = (v: boolean) => (v ? "  ✓  " : "  ✗  ");
    console.log(
      `| ${r.chain.padEnd(8)} | ${r.token.padEnd(6)} | ${checkOrX(r.alchemy)} | ${checkOrX(r.trustwallet)}     | ${checkOrX(r.coingecko)}   |`
    );
  }

  const totalFound = results.filter((r) => r.anyFound).length;
  const total = results.length;
  const successRate = ((totalFound / total) * 100).toFixed(1);

  console.log(`\nSuccess Rate: ${totalFound}/${total} (${successRate}%)`);

  // Source coverage
  const alchemyCount = results.filter((r) => r.alchemy).length;
  const trustwalletCount = results.filter((r) => r.trustwallet).length;
  const coingeckoCount = results.filter((r) => r.coingecko).length;

  console.log("\nSource Coverage:");
  console.log(`  Alchemy:     ${alchemyCount}/${total} (${((alchemyCount / total) * 100).toFixed(0)}%)`);
  console.log(`  TrustWallet: ${trustwalletCount}/${total} (${((trustwalletCount / total) * 100).toFixed(0)}%)`);
  console.log(`  CoinGecko:   ${coingeckoCount}/${total} (${((coingeckoCount / total) * 100).toFixed(0)}%)`);

  console.log("\n========================================\n");

  // Exit with error if many tokens missing
  if (totalFound < total * 0.8) {
    console.error("Too many tokens missing logos from all sources.");
    process.exit(1);
  }

  console.log("Logo sources working correctly.");
}

runTests().catch(console.error);
