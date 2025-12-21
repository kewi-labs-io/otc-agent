/**
 * Integration test for logo fetching in the app
 * Simulates what the EVM balances API does
 * 
 * Run: bun run scripts/test-logo-integration.ts
 */

import { getAddress } from "viem";

// Chain config matching src/app/api/evm-balances/route.ts
const TRUSTWALLET_CHAIN_MAP: Record<string, string> = {
  ethereum: "ethereum",
  base: "base",
  bsc: "smartchain",
};

const COINGECKO_PLATFORM_MAP: Record<string, string> = {
  ethereum: "ethereum",
  base: "base",
  bsc: "binance-smart-chain",
};

// Tokens that users actually have in their wallets
const REAL_WALLET_TOKENS = {
  base: [
    { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC" },
    { address: "0x4200000000000000000000000000000000000006", symbol: "WETH" },
    { address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", symbol: "DAI" },
    { address: "0x532f27101965dd16442E59d40670FaF5eBB142E4", symbol: "BRETT" },
    { address: "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b", symbol: "cbBTC" },
    { address: "0xfA980cEd6895AC314E7dE34Ef1bFAE90a5AdD21b", symbol: "PRIME" },
  ],
  ethereum: [
    { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", symbol: "USDC" },
    { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", symbol: "USDT" },
    { address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", symbol: "DAI" },
    { address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", symbol: "WETH" },
  ],
};

function checksumAddress(address: string): string {
  return getAddress(address);
}

// Exact implementation from evm-balances
async function fetchTrustWalletLogo(
  contractAddress: string,
  chain: string,
): Promise<string | null> {
  const trustwalletChain = TRUSTWALLET_CHAIN_MAP[chain];
  if (!trustwalletChain) {
    return null;
  }

  const checksummed = checksumAddress(contractAddress);
  const url = `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${trustwalletChain}/assets/${checksummed}/logo.png`;

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

async function fetchCoinGeckoLogo(
  contractAddress: string,
  chain: string,
): Promise<string | null> {
  const platform = COINGECKO_PLATFORM_MAP[chain];
  if (!platform) {
    return null;
  }

  const url = `https://api.coingecko.com/api/v3/coins/${platform}/contract/${contractAddress.toLowerCase()}`;
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

async function fetchAlchemyLogo(
  contractAddress: string,
  chain: string,
): Promise<string | null> {
  const alchemyKey = process.env.ALCHEMY_API_KEY;
  if (!alchemyKey) {
    return null;
  }

  const networkMap: Record<string, string> = {
    ethereum: "eth-mainnet",
    base: "base-mainnet",
    bsc: "bnb-mainnet",
  };

  const network = networkMap[chain];
  if (!network) {
    return null;
  }

  const url = `https://${network}.g.alchemy.com/v2/${alchemyKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "alchemy_getTokenMetadata",
      params: [contractAddress],
    }),
    signal: AbortSignal.timeout(3000),
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json() as { result?: { logo?: string } };
  if (data.result?.logo) return data.result.logo;
  return null;
}

// Main implementation: TrustWallet -> Alchemy -> CoinGecko
async function fetchLogoFromMultipleSources(
  contractAddress: string,
  chain: string,
): Promise<{ logo: string | null; source: string }> {
  // 1. TrustWallet first (best coverage)
  const trustWalletLogo = await fetchTrustWalletLogo(contractAddress, chain);
  if (trustWalletLogo) {
    return { logo: trustWalletLogo, source: "TrustWallet" };
  }

  // 2. Alchemy fallback
  const alchemyLogo = await fetchAlchemyLogo(contractAddress, chain);
  if (alchemyLogo) {
    return { logo: alchemyLogo, source: "Alchemy" };
  }

  // 3. CoinGecko last resort
  const coinGeckoLogo = await fetchCoinGeckoLogo(contractAddress, chain);
  if (coinGeckoLogo) {
    return { logo: coinGeckoLogo, source: "CoinGecko" };
  }

  return { logo: null, source: "none" };
}

async function runTest() {
  console.log("\n========================================");
  console.log("  Logo Integration Test (App Simulation)");
  console.log("========================================\n");

  let found = 0;
  let total = 0;

  for (const [chain, tokens] of Object.entries(REAL_WALLET_TOKENS)) {
    console.log(`\n--- ${chain.toUpperCase()} ---\n`);

    for (const token of tokens) {
      total++;
      process.stdout.write(`${token.symbol.padEnd(8)} `);

      const { logo, source } = await fetchLogoFromMultipleSources(
        token.address,
        chain,
      );

      if (logo) {
        found++;
        console.log(`✓ ${source}`);
      } else {
        console.log("✗ NOT FOUND");
      }
    }
  }

  console.log("\n========================================");
  console.log(`  Result: ${found}/${total} logos found (${((found / total) * 100).toFixed(0)}%)`);
  console.log("========================================\n");

  if (found < total * 0.8) {
    console.error("FAIL: Too many tokens missing logos");
    process.exit(1);
  }

  console.log("PASS: Logo fetching working correctly");
}

runTest().catch(console.error);
