import type { Wallet } from "@coral-xyz/anchor";
import { AnchorProvider, BN, type Idl, Program } from "@coral-xyz/anchor";
import { ComputeBudgetProgram, Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { type NextRequest, NextResponse } from "next/server";
import { getSolanaConfig } from "@/config/contracts";
import { getHeliusRpcUrl, getNetwork } from "@/config/env";
import idl from "@/contracts/solana-otc.idl.json";
import { validationErrorResponse } from "@/lib/validation/helpers";
import { MarketDataDB } from "@/services/database";
import {
  SolanaUpdatePriceRequestSchema,
  SolanaUpdatePriceResponseSchema,
} from "@/types/validation/api-schemas";

// Helper to sync market data database with new price
async function syncMarketData(tokenMint: string, priceUsd: number): Promise<void> {
  const tokenId = `token-solana-${tokenMint}`;
  const existing = await MarketDataDB.getMarketData(tokenId);
  await MarketDataDB.setMarketData({
    tokenId,
    priceUsd,
    marketCap: existing ? existing.marketCap : 0,
    volume24h: existing ? existing.volume24h : 0,
    priceChange24h: existing ? existing.priceChange24h : 0,
    liquidity: existing ? existing.liquidity : 0,
    lastUpdated: Date.now(),
  });
  console.log(`[Price Update] Synced market data for ${tokenId}: $${priceUsd}`);
}

// Wallet adapter for Anchor that wraps a Keypair
class KeypairWallet implements Wallet {
  constructor(readonly payer: Keypair) {}
  get publicKey() {
    return this.payer.publicKey;
  }
  async signTransaction<
    T extends
      | import("@solana/web3.js").Transaction
      | import("@solana/web3.js").VersionedTransaction,
  >(tx: T): Promise<T> {
    if ("version" in tx) {
      tx.sign([this.payer]);
    } else {
      (tx as import("@solana/web3.js").Transaction).partialSign(this.payer);
    }
    return tx;
  }
  async signAllTransactions<
    T extends
      | import("@solana/web3.js").Transaction
      | import("@solana/web3.js").VersionedTransaction,
  >(txs: T[]): Promise<T[]> {
    return Promise.all(txs.map((tx) => this.signTransaction(tx)));
  }
}

/**
 * Lazy Price Update API
 *
 * Called on-demand (e.g., at time of sale) to ensure price is fresh.
 * Only updates if price is stale (>30 minutes old).
 *
 * POST /api/solana/update-price
 * Body: { tokenMint: string, forceUpdate?: boolean }
 */

// Price staleness threshold (30 minutes in seconds)
const MAX_PRICE_AGE_SECS = 30 * 60;

async function fetchTokenPrice(mint: string): Promise<number> {
  // Try CoinGecko first (free, no auth required)
  const resp = await fetch(
    `https://api.coingecko.com/api/v3/simple/token_price/solana?contract_addresses=${mint}&vs_currencies=usd`,
    { cache: "no-store" }, // Don't cache - we're checking freshness
  );

  // FAIL-FAST: Check response status before parsing JSON
  if (!resp.ok) {
    throw new Error(`CoinGecko API error: ${resp.status} ${resp.statusText}`);
  }

  const data = await resp.json();
  // FAIL-FAST: Validate response structure
  if (typeof data !== "object" || data === null) {
    throw new Error("Invalid CoinGecko API response: expected object");
  }

  if (data[mint]?.usd) {
    console.log(`[Price Update] CoinGecko price for ${mint}: $${data[mint].usd}`);
    return data[mint].usd;
  }

  // Try PumpSwap / Raydium pool price (for pump.fun unbonded tokens)
  const { findBestSolanaPool } = await import("@/utils/pool-finder-solana");
  const pool = await findBestSolanaPool(mint, "mainnet");
  if (pool?.priceUsd && pool.priceUsd > 0) {
    const tvlStr = pool.tvlUsd ? pool.tvlUsd.toLocaleString() : "unknown";
    console.log(
      `[Price Update] ${pool.protocol} pool price for ${mint}: $${pool.priceUsd} (TVL: $${tvlStr})`,
    );
    return pool.priceUsd;
  }

  // Try to get price from our database MarketData
  const { MarketDataDB, TokenDB } = await import("@/services/database");

  // Look up token by contract address to get tokenId
  const tokens = await TokenDB.getAllTokens();
  const token = tokens.find((t) => t.chain === "solana" && t.contractAddress === mint);

  if (token) {
    const marketData = await MarketDataDB.getMarketData(token.id);
    // MarketData is optional - may not exist yet
    if (marketData) {
      // FAIL-FAST: If marketData exists, priceUsd should be valid
      if (typeof marketData.priceUsd !== "number" || marketData.priceUsd <= 0) {
        throw new Error(
          `MarketData exists for ${mint} but has invalid priceUsd: ${marketData.priceUsd}`,
        );
      }
      console.log(`[Price Update] Database price for ${mint}: $${marketData.priceUsd}`);
      return marketData.priceUsd;
    }
  }

  throw new Error(
    `No price found for ${mint} from any source (CoinGecko, PumpSwap/Raydium pools, or database)`,
  );
}

interface ParsedTokenRegistry {
  tokenUsdPrice8d: bigint;
  pricesUpdatedAt: bigint;
  isActive: boolean;
}

function parseTokenRegistryPrice(data: Buffer): ParsedTokenRegistry {
  // Skip to relevant fields: discriminator(8) + desk(32) + tokenMint(32) + decimals(1) + priceFeedId(32) + poolAddress(32) + poolType(1)
  const offset = 8 + 32 + 32 + 1 + 32 + 32 + 1;

  const isActive = data[offset] === 1;
  const tokenUsdPrice8d = data.readBigUInt64LE(offset + 1);
  const pricesUpdatedAt = data.readBigInt64LE(offset + 1 + 8);

  return { isActive, tokenUsdPrice8d, pricesUpdatedAt };
}

export async function POST(request: NextRequest) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate request body - return 400 on invalid params
  const parseResult = SolanaUpdatePriceRequestSchema.safeParse(body);
  if (!parseResult.success) {
    return validationErrorResponse(parseResult.error, 400);
  }
  const data = parseResult.data;

  const { tokenMint, forceUpdate = false } = data;

  const solanaConfig = getSolanaConfig();

  const network = getNetwork();
  const rpcUrl = network === "local" ? "http://127.0.0.1:8899" : getHeliusRpcUrl();
  const connection = new Connection(rpcUrl, "confirmed");
  const programId = new PublicKey(solanaConfig.programId);
  const deskPubkey = new PublicKey(solanaConfig.desk);
  console.log(`[Update Price] Using Helius RPC`);
  const tokenMintPubkey = new PublicKey(tokenMint);

  // Find token registry PDA
  const [registryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("registry"), deskPubkey.toBuffer(), tokenMintPubkey.toBuffer()],
    programId,
  );

  // Fetch current registry state
  const accountInfo = await connection.getAccountInfo(registryPda);
  if (!accountInfo) {
    return NextResponse.json({ error: "Token not registered on OTC desk" }, { status: 404 });
  }

  const registry = parseTokenRegistryPrice(accountInfo.data);
  const now = Math.floor(Date.now() / 1000);
  const priceAge = now - Number(registry.pricesUpdatedAt);
  const currentPrice = Number(registry.tokenUsdPrice8d) / 1e8;

  // Force update if price is zero (never set) or explicitly requested
  const needsUpdate = forceUpdate === true || currentPrice === 0;

  // Check if price is still fresh (unless it's zero - always update zero prices)
  if (!needsUpdate && priceAge < MAX_PRICE_AGE_SECS) {
    // Still sync to market data DB (it may be stale even if on-chain is fresh)
    if (currentPrice > 0) {
      await syncMarketData(tokenMint, currentPrice);
    }
    const freshResponse = {
      success: true,
      updated: false,
      reason: "Price still fresh",
      price: currentPrice,
      priceAge: priceAge,
      maxAge: MAX_PRICE_AGE_SECS,
    };
    const validatedFresh = SolanaUpdatePriceResponseSchema.parse(freshResponse);
    return NextResponse.json(validatedFresh);
  }

  if (currentPrice === 0) {
    console.log(`[Update Price] Token ${tokenMint} has no price set - forcing update`);
  }

  // Try to find a PumpSwap pool for on-chain price update (permissionless - no owner required)
  // First check if we have cached pool info from token registration
  let pumpSwapPool: {
    address: string;
    solVault?: string;
    tokenVault?: string;
    priceUsd?: number;
    protocol?: string;
  } | null = null;

  // Try to get cached pool info from database first (faster than searching)
  const { TokenDB } = await import("@/services/database");
  const tokens = await TokenDB.getAllTokens();
  const token = tokens.find((t) => t.chain === "solana" && t.contractAddress === tokenMint);

  // Pool info is optional - token may not have pool cached yet
  if (token) {
    // FAIL-FAST: If token has poolAddress, it must have all required pool fields
    if (token.poolAddress) {
      if (!token.solVault || !token.tokenVault) {
        throw new Error(
          `Token ${tokenMint} has poolAddress but missing solVault or tokenVault - data corruption`,
        );
      }
      console.log(`[Price Update] Using cached pool info for ${tokenMint}`);
      pumpSwapPool = {
        address: token.poolAddress,
        solVault: token.solVault,
        tokenVault: token.tokenVault,
        protocol: "PumpSwap", // Cached pools are typically PumpSwap
      };
    }
  }

  // If no cached pool, search for one
  if (!pumpSwapPool) {
    const { findBestSolanaPool } = await import("@/utils/pool-finder-solana");
    const pool = await findBestSolanaPool(tokenMint, "mainnet");
    console.log(
      `[Price Update] Pool finder result:`,
      pool
        ? {
            protocol: pool.protocol,
            address: pool.address,
            priceUsd: pool.priceUsd,
            solVault: pool.solVault,
            tokenVault: pool.tokenVault,
            tvlUsd: pool.tvlUsd,
          }
        : "No pool found",
    );

    if (pool) {
      pumpSwapPool = pool;
    }
  }

  // Log the selected pool
  console.log(
    `[Price Update] Selected pool:`,
    pumpSwapPool
      ? {
          address: pumpSwapPool.address,
          solVault: pumpSwapPool.solVault,
          tokenVault: pumpSwapPool.tokenVault,
          protocol: pumpSwapPool.protocol,
        }
      : "None",
  );

  // Validate and configure on-chain pool if we have PumpSwap pool
  // Only PumpSwap pools can be used for on-chain price updates
  // Other protocols (Raydium, Meteora, etc.) can still provide price data
  const isPumpSwapPool =
    pumpSwapPool &&
    pumpSwapPool.protocol === "PumpSwap" &&
    pumpSwapPool.solVault &&
    pumpSwapPool.tokenVault;

  if (pumpSwapPool && !isPumpSwapPool) {
    // Non-PumpSwap pool found (e.g., Raydium, Meteora)
    // These pools can't be used for permissionless on-chain updates
    // We need to use setManualTokenPrice which requires owner permission
    console.log(
      `[Price Update] Found ${pumpSwapPool.protocol} pool (not PumpSwap) - will use manual price update`,
    );

    if (pumpSwapPool.priceUsd && pumpSwapPool.priceUsd > 0) {
      // Try to update on-chain using manual price set
      const signerKey = process.env.SOLANA_PRIVATE_KEY;
      if (!signerKey) {
        // No signer - sync database but warn that on-chain price may be stale
        await syncMarketData(tokenMint, pumpSwapPool.priceUsd);
        const noSignerResponse = {
          success: true,
          updated: false,
          reason: `${pumpSwapPool.protocol} pool price available but no signer for on-chain update`,
          price: pumpSwapPool.priceUsd,
          pool: pumpSwapPool.address,
          stale: true, // On-chain price may be stale
        };
        const validatedNoSigner = SolanaUpdatePriceResponseSchema.parse(noSignerResponse);
        return NextResponse.json(validatedNoSigner);
      }

      // Have signer - try manual update
      const keypair = Keypair.fromSecretKey(bs58.decode(signerKey));

      // Check if signer is owner
      const deskAccount = await connection.getAccountInfo(deskPubkey);
      if (!deskAccount) {
        throw new Error("Desk account not found");
      }
      const ownerPubkey = new PublicKey(deskAccount.data.subarray(8, 40));

      if (ownerPubkey.equals(keypair.publicKey)) {
        // Signer is owner - do manual price update
        const wallet = new KeypairWallet(keypair);
        const provider = new AnchorProvider(connection, wallet, {
          commitment: "confirmed",
        });
        const program = new Program(idl as never, provider);

        const price8d = Math.floor(pumpSwapPool.priceUsd * 1e8);
        console.log(
          `[Price Update] Setting manual price from ${pumpSwapPool.protocol} pool: $${pumpSwapPool.priceUsd}`,
        );

        const tx = await program.methods
          .setManualTokenPrice(new BN(price8d))
          .accounts({
            tokenRegistry: registryPda,
            desk: deskPubkey,
            owner: keypair.publicKey,
          })
          .preInstructions([
            ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }),
            ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
          ])
          .rpc();

        console.log(`[Price Update] Manual update successful: ${tx}`);
        await syncMarketData(tokenMint, pumpSwapPool.priceUsd);

        const manualResponse = {
          success: true,
          updated: true,
          price: pumpSwapPool.priceUsd,
          oldPrice: currentPrice,
          newPrice: pumpSwapPool.priceUsd,
          method: "manual" as const,
          pool: pumpSwapPool.address,
          transaction: tx,
        };
        const validatedManual = SolanaUpdatePriceResponseSchema.parse(manualResponse);
        return NextResponse.json(validatedManual);
      }

      // Signer is not owner - sync database but can't update on-chain
      console.warn(`[Price Update] Signer is not desk owner - cannot do manual price update`);
      await syncMarketData(tokenMint, pumpSwapPool.priceUsd);
      const notOwnerResponse = {
        success: true,
        updated: false,
        reason: `${pumpSwapPool.protocol} pool price available but signer is not desk owner`,
        price: pumpSwapPool.priceUsd,
        pool: pumpSwapPool.address,
        stale: true,
      };
      const validatedNotOwner = SolanaUpdatePriceResponseSchema.parse(notOwnerResponse);
      return NextResponse.json(validatedNotOwner);
    }
  }

  if (isPumpSwapPool && pumpSwapPool) {
    // TypeScript narrowing: pumpSwapPool is guaranteed to have all required fields here
    const pool = pumpSwapPool; // Capture for type safety

    // Configure pool on-chain
    console.log(`[Price Update] Using PumpSwap pool: ${pool.address}, price: $${pool.priceUsd}`);

    // Check if token registry has correct pool configured
    // TokenRegistry layout:
    // - offset 0: discriminator (8)
    // - offset 8: desk (32)
    // - offset 40: token_mint (32)
    // - offset 72: decimals (1)
    // - offset 73: price_feed_id (32)
    // - offset 105: pool_address (32)
    // - offset 137: pool_type (1)
    const POOL_ADDRESS_OFFSET = 105;
    const POOL_TYPE_OFFSET = 137;
    const currentPoolAddress = new PublicKey(
      accountInfo.data.subarray(POOL_ADDRESS_OFFSET, POOL_ADDRESS_OFFSET + 32),
    );
    const currentPoolType = accountInfo.data[POOL_TYPE_OFFSET];
    const expectedPoolAddress = new PublicKey(pool.address);

    if (!currentPoolAddress.equals(expectedPoolAddress) || currentPoolType !== 3) {
      console.log(
        `[Price Update] Token pool config mismatch - current: ${currentPoolAddress.toBase58()} (type ${currentPoolType}), expected: ${pool.address} (type 3)`,
      );

      // Try to update pool config (requires owner or original registrant)
      const signerKey = process.env.SOLANA_PRIVATE_KEY;
      if (signerKey) {
        const keypair = Keypair.fromSecretKey(bs58.decode(signerKey));
        const wallet = new KeypairWallet(keypair);
        const provider = new AnchorProvider(connection, wallet, {
          commitment: "confirmed",
        });
        const program = new Program(idl as Idl, provider);

        console.log(`[Price Update] Attempting to set pool config...`);
        const configTx = await program.methods
          .setTokenPoolConfig(expectedPoolAddress, 3) // 3 = PumpSwap
          .accounts({
            tokenRegistry: registryPda,
            desk: deskPubkey,
            signer: keypair.publicKey,
          })
          .preInstructions([
            ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }),
            ComputeBudgetProgram.setComputeUnitPrice({
              microLamports: 50_000,
            }),
          ])
          .rpc();
        console.log(`[Price Update] Pool config updated: ${configTx}`);
      }
    }

    // Use update_token_price_from_pumpswap (permissionless)
    // pumpSwapPool already validated above - it has all required fields
    // Get current SOL price for the calculation
    const { getSolPriceUsd } = await import("@/lib/plugin-otc-desk/services/priceFeed");
    const solPrice = await getSolPriceUsd();
    const solPrice8d = Math.floor(solPrice * 1e8);

    // Use any funded wallet to pay for the transaction (permissionless instruction)
    const signerKey = process.env.SOLANA_PRIVATE_KEY;
    if (!signerKey) {
      if (!pool.priceUsd || pool.priceUsd <= 0) {
        throw new Error("PumpSwap pool price unavailable and no signer configured");
      }
      // Even without a signer, we can return the pool price for display
      const noSignerResponse = {
        success: true,
        updated: false,
        reason: "No signer for PumpSwap update, but pool price available",
        price: pool.priceUsd,
        pool: pool.address,
        stale: false,
      };
      const validatedNoSigner = SolanaUpdatePriceResponseSchema.parse(noSignerResponse);
      return NextResponse.json(validatedNoSigner);
    }

    const keypair = Keypair.fromSecretKey(bs58.decode(signerKey));
    const wallet = new KeypairWallet(keypair);
    const provider = new AnchorProvider(connection, wallet, {
      commitment: "confirmed",
    });
    const program = new Program(idl as never, provider);

    console.log(
      `[Price Update] Calling update_token_price_from_pumpswap with SOL price: $${solPrice}`,
    );

    // FAIL-FAST: PumpSwap update must succeed
    // pool.solVault and pool.tokenVault are guaranteed to exist (validated by isPumpSwapPool)
    const tx = await program.methods
      .updateTokenPriceFromPumpswap(new BN(solPrice8d))
      .accounts({
        tokenRegistry: registryPda,
        bondingCurve: new PublicKey(pool.address),
        solVault: new PublicKey(pool.solVault as string),
        tokenVault: new PublicKey(pool.tokenVault as string),
      })
      .preInstructions([
        ComputeBudgetProgram.setComputeUnitLimit({ units: 150_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
      ])
      .rpc();

    console.log(`[Price Update] PumpSwap update successful: ${tx}`);

    // Sync market data database with fresh price
    if (!pool.priceUsd || pool.priceUsd <= 0) {
      throw new Error("PumpSwap pool price is invalid");
    }
    await syncMarketData(tokenMint, pool.priceUsd);

    const pumpswapResponse = {
      success: true,
      updated: true,
      price: pool.priceUsd,
      oldPrice: currentPrice,
      newPrice: pool.priceUsd,
      method: "pumpswap" as const,
      pool: pool.address,
      transaction: tx,
    };
    const validatedPumpswap = SolanaUpdatePriceResponseSchema.parse(pumpswapResponse);
    return NextResponse.json(validatedPumpswap);
  }

  // FAIL-FAST: Fetch price from external sources and set manually (REQUIRES OWNER)
  const newPrice = await fetchTokenPrice(tokenMint);
  if (!newPrice) {
    throw new Error(
      "Failed to fetch price from external source (tried CoinGecko, PumpSwap pools, database)",
    );
  }

  // FAIL-FAST: Signer must be configured
  const signerKey = process.env.SOLANA_PRIVATE_KEY;
  if (!signerKey) {
    throw new Error("SOLANA_PRIVATE_KEY not configured - cannot update price on-chain");
  }

  // FAIL-FAST: Keypair must be valid
  const keypair = Keypair.fromSecretKey(bs58.decode(signerKey));

  // FAIL-FAST: Verify the signer is the desk owner before attempting setManualTokenPrice
  // This instruction REQUIRES owner permission
  const deskAccount = await connection.getAccountInfo(deskPubkey);
  if (!deskAccount) {
    throw new Error("Desk account not found");
  }
  // Desk layout: discriminator(8) + owner(32) + ...
  const ownerPubkey = new PublicKey(deskAccount.data.subarray(8, 40));
  if (!ownerPubkey.equals(keypair.publicKey)) {
    throw new Error(
      `Signer ${keypair.publicKey.toBase58()} is not desk owner ${ownerPubkey.toBase58()}. Cannot set manual price without owner permission.`,
    );
  }

  // Update on-chain using manual price set (owner only)
  const wallet = new KeypairWallet(keypair);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  const program = new Program(idl as never, provider);

  const price8d = Math.floor(newPrice * 1e8);

  // FAIL-FAST: Manual price update must succeed
  const tx = await program.methods
    .setManualTokenPrice(new BN(price8d))
    .accounts({
      tokenRegistry: registryPda,
      desk: deskPubkey,
      owner: keypair.publicKey,
    })
    .preInstructions([
      ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
    ])
    .rpc();

  console.log(
    `[Price Update] Manual update ${tokenMint.slice(0, 8)}... from $${currentPrice.toFixed(8)} to $${newPrice.toFixed(8)} (tx: ${tx})`,
  );

  // Sync market data database with fresh price
  await syncMarketData(tokenMint, newPrice);

  const manualResponse = {
    success: true,
    updated: true,
    price: newPrice,
    oldPrice: currentPrice,
    newPrice: newPrice,
    method: "manual" as const,
    priceAge: priceAge,
    transaction: tx,
  };
  const validatedManual = SolanaUpdatePriceResponseSchema.parse(manualResponse);
  return NextResponse.json(validatedManual);
}

// GET endpoint to check current price without updating
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenMint = searchParams.get("tokenMint");

  if (!tokenMint) {
    return NextResponse.json({ error: "tokenMint required" }, { status: 400 });
  }

  const solanaConfig = getSolanaConfig();

  const network = getNetwork();
  const rpcUrl = network === "local" ? "http://127.0.0.1:8899" : getHeliusRpcUrl();
  const connection = new Connection(rpcUrl, "confirmed");
  const programId = new PublicKey(solanaConfig.programId);
  const deskPubkey = new PublicKey(solanaConfig.desk);
  const tokenMintPubkey = new PublicKey(tokenMint);

  const [registryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("registry"), deskPubkey.toBuffer(), tokenMintPubkey.toBuffer()],
    programId,
  );

  const accountInfo = await connection.getAccountInfo(registryPda);
  if (!accountInfo) {
    return NextResponse.json({ error: "Token not registered" }, { status: 404 });
  }

  const registry = parseTokenRegistryPrice(accountInfo.data);
  const now = Math.floor(Date.now() / 1000);
  const priceAge = now - Number(registry.pricesUpdatedAt);
  const currentPrice = Number(registry.tokenUsdPrice8d) / 1e8;

  const getResponse = {
    success: true,
    updated: false,
    price: currentPrice,
    priceAge: priceAge,
    isStale: priceAge > MAX_PRICE_AGE_SECS,
    maxAge: MAX_PRICE_AGE_SECS,
    updatedAt: new Date(Number(registry.pricesUpdatedAt) * 1000).toISOString(),
  };
  const validatedGet = SolanaUpdatePriceResponseSchema.parse(getResponse);
  return NextResponse.json(validatedGet);
}
