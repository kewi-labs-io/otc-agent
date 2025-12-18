/**
 * Validation test: Lazy price update for Solana
 * This test validates the on-chain price is correct and can be updated
 */
import { Connection, PublicKey } from "@solana/web3.js";
import mainnetSolana from "../src/config/deployments/mainnet-solana.json";

const MAX_PRICE_AGE_SECS = 30 * 60; // 30 minutes

async function fetchCoinGeckoPrice(mint: string): Promise<number | null> {
  try {
    const resp = await fetch(
      `https://api.coingecko.com/api/v3/simple/token_price/solana?contract_addresses=${mint}&vs_currencies=usd`
    );
    const data = await resp.json();
    if (data[mint] && data[mint].usd) {
      return data[mint].usd;
    }
  } catch (error) {
    console.error(`CoinGecko error:`, error);
  }
  return null;
}

async function main() {
  console.log("=== Solana Lazy Price Validation ===\n");
  
  const connection = new Connection(mainnetSolana.rpc, "confirmed");
  const registryPda = new PublicKey(mainnetSolana.registeredTokens.ELIZAOS.registry);
  const tokenMint = mainnetSolana.registeredTokens.ELIZAOS.mint;
  
  // 1. Fetch current on-chain state
  console.log("1. Fetching on-chain price data...");
  const accountInfo = await connection.getAccountInfo(registryPda);
  if (!accountInfo) {
    console.error("FAIL: Registry account not found");
    process.exit(1);
  }
  
  const data = accountInfo.data;
  const offset = 8 + 32 + 32 + 1 + 32 + 32 + 1;
  const isActive = data[offset] === 1;
  const tokenUsdPrice8d = data.readBigUInt64LE(offset + 1);
  const pricesUpdatedAt = data.readBigInt64LE(offset + 1 + 8);
  
  const now = Math.floor(Date.now() / 1000);
  const priceAge = now - Number(pricesUpdatedAt);
  const onChainPrice = Number(tokenUsdPrice8d) / 1e8;
  
  console.log(`   On-chain price: $${onChainPrice.toFixed(8)}`);
  console.log(`   Last updated: ${new Date(Number(pricesUpdatedAt) * 1000).toISOString()}`);
  console.log(`   Age: ${Math.floor(priceAge / 60)} minutes`);
  console.log(`   Is Active: ${isActive}`);
  
  // 2. Fetch current market price
  console.log("\n2. Fetching current market price from CoinGecko...");
  const marketPrice = await fetchCoinGeckoPrice(tokenMint);
  
  if (!marketPrice) {
    console.error("FAIL: Could not fetch market price");
    process.exit(1);
  }
  
  console.log(`   Market price: $${marketPrice.toFixed(8)}`);
  
  // 3. Calculate price deviation
  const deviation = Math.abs(onChainPrice - marketPrice) / marketPrice * 100;
  console.log(`   Deviation: ${deviation.toFixed(2)}%`);
  
  // 4. Validate staleness
  console.log("\n3. Validating price freshness...");
  const isStale = priceAge > MAX_PRICE_AGE_SECS;
  
  if (isStale) {
    console.log(`   ⚠️  Price is STALE (>${MAX_PRICE_AGE_SECS/60} min old)`);
    console.log("   Lazy update would be triggered at sale time");
  } else {
    console.log(`   ✅ Price is FRESH (${Math.floor(priceAge / 60)} min old)`);
    console.log(`   Will expire in ${Math.floor((MAX_PRICE_AGE_SECS - priceAge) / 60)} minutes`);
  }
  
  // 5. Validate deviation is reasonable
  console.log("\n4. Validating price accuracy...");
  if (deviation < 10) {
    console.log(`   ✅ Price deviation is acceptable (<10%)`);
  } else if (deviation < 25) {
    console.log(`   ⚠️  Price deviation is moderate (10-25%)`);
  } else {
    console.log(`   ❌ Price deviation is HIGH (>25%)`);
    console.log("   This might indicate the on-chain price needs updating");
  }
  
  // 6. Summary
  console.log("\n=== Validation Summary ===");
  console.log(`Token: ELIZAOS (${tokenMint})`);
  console.log(`On-chain Price: $${onChainPrice.toFixed(8)}`);
  console.log(`Market Price: $${marketPrice.toFixed(8)}`);
  console.log(`Deviation: ${deviation.toFixed(2)}%`);
  console.log(`Freshness: ${isStale ? 'STALE' : 'FRESH'} (${Math.floor(priceAge / 60)} min)`);
  console.log(`Active: ${isActive ? 'YES' : 'NO'}`);
  
  // Exit code based on validation
  if (!isActive) {
    console.log("\n❌ VALIDATION FAILED: Token not active");
    process.exit(1);
  }
  
  if (deviation > 50) {
    console.log("\n❌ VALIDATION FAILED: Price deviation too high");
    process.exit(1);
  }
  
  console.log("\n✅ VALIDATION PASSED");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});

