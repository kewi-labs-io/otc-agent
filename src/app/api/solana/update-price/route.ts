import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey, Keypair, ComputeBudgetProgram } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet, BN } from "@coral-xyz/anchor";
import bs58 from "bs58";
import idl from "@/contracts/solana-otc.idl.json";
import { getSolanaConfig } from "@/config/contracts";

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

async function fetchTokenPrice(mint: string): Promise<number | null> {
  // Use CoinGecko (free, no auth required)
  try {
    const resp = await fetch(
      `https://api.coingecko.com/api/v3/simple/token_price/solana?contract_addresses=${mint}&vs_currencies=usd`,
      { next: { revalidate: 60 } } // Cache for 1 minute
    );
    const data = await resp.json();
    if (data[mint] && data[mint].usd) {
      return data[mint].usd;
    }
  } catch (error) {
    console.error(`[Price Update] CoinGecko error for ${mint}:`, error);
  }
  return null;
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
  try {
    const body = await request.json();
    const { tokenMint, forceUpdate = false } = body;

    if (!tokenMint) {
      return NextResponse.json({ error: "tokenMint required" }, { status: 400 });
    }

    const solanaConfig = getSolanaConfig();
    if (!solanaConfig.programId || !solanaConfig.desk) {
      return NextResponse.json(
        { error: "Solana configuration missing" },
        { status: 500 }
      );
    }

    const connection = new Connection(solanaConfig.rpc, "confirmed");
    const programId = new PublicKey(solanaConfig.programId);
    const deskPubkey = new PublicKey(solanaConfig.desk);
    const tokenMintPubkey = new PublicKey(tokenMint);

    // Find token registry PDA
    const [registryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("registry"), deskPubkey.toBuffer(), tokenMintPubkey.toBuffer()],
      programId
    );

    // Fetch current registry state
    const accountInfo = await connection.getAccountInfo(registryPda);
    if (!accountInfo) {
      return NextResponse.json(
        { error: "Token not registered on OTC desk" },
        { status: 404 }
      );
    }

    const registry = parseTokenRegistryPrice(accountInfo.data);
    const now = Math.floor(Date.now() / 1000);
    const priceAge = now - Number(registry.pricesUpdatedAt);
    const currentPrice = Number(registry.tokenUsdPrice8d) / 1e8;

    // Check if price is still fresh
    if (!forceUpdate && priceAge < MAX_PRICE_AGE_SECS) {
      return NextResponse.json({
        success: true,
        updated: false,
        reason: "Price still fresh",
        price: currentPrice,
        priceAge: priceAge,
        maxAge: MAX_PRICE_AGE_SECS,
      });
    }

    // Price is stale, fetch new price
    const newPrice = await fetchTokenPrice(tokenMint);
    if (!newPrice) {
      return NextResponse.json(
        { error: "Failed to fetch price from external source" },
        { status: 502 }
      );
    }

    // Check if we have a signer to update on-chain
    const signerKey = process.env.SOLANA_PRIVATE_KEY;
    if (!signerKey) {
      // No signer, return the fetched price without updating on-chain
      return NextResponse.json({
        success: true,
        updated: false,
        reason: "No signer available for on-chain update",
        price: newPrice,
        priceAge: priceAge,
        stale: true,
      });
    }

    let keypair: Keypair;
    try {
      keypair = Keypair.fromSecretKey(bs58.decode(signerKey));
    } catch {
      return NextResponse.json(
        { error: "Invalid SOLANA_PRIVATE_KEY" },
        { status: 500 }
      );
    }

    // Update on-chain
    const wallet = new Wallet(keypair);
    const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
    const program = new Program(idl as never, provider);

    const price8d = Math.floor(newPrice * 1e8);

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

    console.log(`[Price Update] Updated ${tokenMint.slice(0, 8)}... from $${currentPrice.toFixed(8)} to $${newPrice.toFixed(8)} (tx: ${tx})`);

    return NextResponse.json({
      success: true,
      updated: true,
      oldPrice: currentPrice,
      newPrice: newPrice,
      priceAge: priceAge,
      transaction: tx,
    });
  } catch (error) {
    console.error("[Price Update] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// GET endpoint to check current price without updating
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenMint = searchParams.get("tokenMint");

  if (!tokenMint) {
    return NextResponse.json({ error: "tokenMint required" }, { status: 400 });
  }

  const solanaConfig = getSolanaConfig();
  if (!solanaConfig.programId || !solanaConfig.desk) {
    return NextResponse.json(
      { error: "Solana configuration missing" },
      { status: 500 }
    );
  }

  const connection = new Connection(solanaConfig.rpc, "confirmed");
  const programId = new PublicKey(solanaConfig.programId);
  const deskPubkey = new PublicKey(solanaConfig.desk);
  const tokenMintPubkey = new PublicKey(tokenMint);

  const [registryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("registry"), deskPubkey.toBuffer(), tokenMintPubkey.toBuffer()],
    programId
  );

  const accountInfo = await connection.getAccountInfo(registryPda);
  if (!accountInfo) {
    return NextResponse.json(
      { error: "Token not registered" },
      { status: 404 }
    );
  }

  const registry = parseTokenRegistryPrice(accountInfo.data);
  const now = Math.floor(Date.now() / 1000);
  const priceAge = now - Number(registry.pricesUpdatedAt);
  const currentPrice = Number(registry.tokenUsdPrice8d) / 1e8;

  return NextResponse.json({
    price: currentPrice,
    priceAge: priceAge,
    isStale: priceAge > MAX_PRICE_AGE_SECS,
    maxAge: MAX_PRICE_AGE_SECS,
    updatedAt: new Date(Number(registry.pricesUpdatedAt) * 1000).toISOString(),
  });
}

