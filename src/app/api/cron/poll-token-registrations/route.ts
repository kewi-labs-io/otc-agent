import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, parseAbi } from "viem";
import { base } from "viem/chains";
import { Connection, PublicKey } from "@solana/web3.js";
import { TokenRegistryService } from "@/services/tokenRegistry";
import { TokenDB } from "@/services/database";
import { getHeliusRpcUrl, getNetwork } from "@/config/env";
import {
  getRegistrationHelperForChain,
  getSolanaProgramId,
} from "@/config/contracts";
import type { MinimalPublicClient } from "@/lib/viem-utils";
import { CronPollTokenRegistrationsResponseSchema } from "@/types/validation/api-schemas";

// register_token instruction discriminator from IDL
const REGISTER_TOKEN_DISCRIMINATOR = Buffer.from([
  32, 146, 36, 240, 80, 183, 36, 84,
]);

const ERC20_ABI = parseAbi([
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
]);

// Store last processed state
// Note: In-memory state resets on each Vercel function invocation
// For production, consider using Vercel KV or database for persistence
// Current implementation checks last 1000 blocks each run (safe for 2-min intervals)
let lastBaseBlock: bigint | null = null;
let lastSolanaSignature: string | null = null;

// Try to load from environment (set via Vercel KV or external service if needed)
function getLastBaseBlock(): bigint | null {
  const envBlock = process.env.LAST_PROCESSED_BASE_BLOCK;
  if (envBlock) {
    return BigInt(envBlock);
  }
  return lastBaseBlock;
}

/**
 * Poll for new token registrations (Base)
 */
async function pollBaseRegistrations() {
  const registrationHelperAddress = getRegistrationHelperForChain(8453);
  if (!registrationHelperAddress) {
    console.error("[Cron] REGISTRATION_HELPER_ADDRESS not configured");
    return {
      processed: 0,
      error: "REGISTRATION_HELPER_ADDRESS not configured",
    };
  }

  // Server-side: use Alchemy directly
  const alchemyKey = process.env.ALCHEMY_API_KEY;
  if (!alchemyKey) {
    console.error("[Cron] ALCHEMY_API_KEY not configured");
    return {
      processed: 0,
      error: "ALCHEMY_API_KEY not configured",
    };
  }
  const rpcUrl = `https://base-mainnet.g.alchemy.com/v2/${alchemyKey}`;
  const client = createPublicClient({
    chain: base,
    transport: http(rpcUrl),
  });

  const latestBlock = await client.getBlockNumber();

  // If we don't have a last block, start from 1000 blocks ago (to catch up)
  // This ensures we don't miss events even if state resets
  const savedBlock = getLastBaseBlock();
  const startBlock = savedBlock || latestBlock - BigInt(1000);

  // Don't process if we're already up to date
  if (startBlock >= latestBlock) {
    return { processed: 0, message: "Already up to date" };
  }

  console.log(
    `[Cron Base] Fetching events from block ${startBlock} to ${latestBlock}`,
  );

  const logs = await client.getLogs({
    address: registrationHelperAddress as `0x${string}`,
    event: {
      type: "event",
      name: "TokenRegistered",
      inputs: [
        { type: "bytes32", name: "tokenId", indexed: true },
        { type: "address", name: "tokenAddress", indexed: true },
        { type: "address", name: "pool", indexed: true },
        { type: "address", name: "oracle" },
        { type: "address", name: "registeredBy" },
      ],
    },
    fromBlock: startBlock,
    toBlock: latestBlock,
  });

  console.log(`[Cron Base] Found ${logs.length} TokenRegistered events`);

  interface TokenRegisteredArgs {
    tokenId: string;
    tokenAddress: string;
    pool: string;
    oracle: string;
    registeredBy: string;
  }

  interface TokenRegisteredLog {
    args: TokenRegisteredArgs;
  }

  let processed = 0;
  for (const log of logs) {
    const { tokenAddress, registeredBy } = (log as TokenRegisteredLog).args;

    console.log(
      `[Cron Base] Processing token registration: ${tokenAddress} by ${registeredBy}`,
    );

    // Fetch token metadata
    const viemClient = client as MinimalPublicClient;
    const [symbol, name, decimals] = await Promise.all([
      viemClient.readContract({
        address: tokenAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "symbol",
      }),
      viemClient.readContract({
        address: tokenAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "name",
      }),
      viemClient.readContract({
        address: tokenAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "decimals",
      }),
    ]);

    // Register to database
    const tokenService = new TokenRegistryService();
    await tokenService.registerToken({
      symbol: symbol as string,
      name: name as string,
      contractAddress: tokenAddress.toLowerCase(),
      chain: "base",
      decimals: Number(decimals),
      logoUrl: undefined,
      description: `Registered via RegistrationHelper by ${registeredBy}`,
    });

    processed++;
    console.log(`[Cron Base] ✅ Registered ${symbol} (${tokenAddress})`);
  }

  // Update last processed block
  lastBaseBlock = latestBlock;

  return { processed, latestBlock: latestBlock.toString() };
}

/**
 * Poll for new token registrations (Solana)
 */
async function pollSolanaRegistrations() {
  const programId = getSolanaProgramId();

  const network = getNetwork();
  const rpcUrl =
    network === "local" ? "http://127.0.0.1:8899" : getHeliusRpcUrl();
  console.log(`[Poll Solana Registrations] Using Helius RPC`);
  const connection = new Connection(rpcUrl, "confirmed");

  const signatures = await connection.getSignaturesForAddress(
    new PublicKey(programId),
    { limit: 50 },
  );

  if (signatures.length === 0) {
    return { processed: 0, message: "No recent transactions" };
  }

  let startIndex = 0;
  if (lastSolanaSignature) {
    const lastIndex = signatures.findIndex(
      (sig) => sig.signature === lastSolanaSignature,
    );
    if (lastIndex >= 0) {
      startIndex = lastIndex + 1;
    }
  }

  if (startIndex >= signatures.length) {
    return { processed: 0, message: "Already up to date" };
  }

  console.log(
    `[Cron Solana] Checking ${signatures.length - startIndex} transactions`,
  );

  let processed = 0;
  let lastProcessedSig: string | null = null;
  const registeredTokens: string[] = [];

  for (let i = startIndex; i < signatures.length; i++) {
    const sig = signatures[i];
    const tx = await connection.getTransaction(sig.signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    // FAIL-FAST: Transaction must exist and have metadata to process
    if (!tx) continue;
    if (!tx.meta) {
      console.warn(
        `[Cron Solana] Transaction ${sig.signature} missing metadata - skipping`,
      );
      continue;
    }
    // logMessages is required in Solana transaction metadata
    if (!tx.meta.logMessages) {
      console.warn(
        `[Cron Solana] Transaction ${sig.signature} missing logMessages - skipping`,
      );
      continue;
    }

    const hasRegisterToken = tx.meta.logMessages.some(
      (log) =>
        log.includes("Instruction: RegisterToken") ||
        log.includes("register_token"),
    );

    if (hasRegisterToken) {
      const parsed = parseSolanaRegisterToken(tx, programId);
      if (parsed) {
        // FAIL-FAST: Token registration must succeed
        const tokenData = await fetchSolanaTokenData(
          connection,
          parsed.tokenMint,
        );
        await TokenDB.createToken({
          symbol: tokenData.symbol,
          name: tokenData.name,
          chain: "solana",
          contractAddress: parsed.tokenMint,
          decimals: tokenData.decimals,
          isActive: true,
          logoUrl: "",
          description: "",
        });
        console.log(
          `[Cron Solana] ✅ Registered: ${tokenData.symbol} (${parsed.tokenMint})`,
        );
        registeredTokens.push(parsed.tokenMint);
        processed++;
      }
      lastProcessedSig = sig.signature;
    }
  }

  if (lastProcessedSig) {
    lastSolanaSignature = lastProcessedSig;
  }

  return { processed, lastSignature: lastSolanaSignature, registeredTokens };
}

// Type for parsed Solana token registration
interface SolanaParsedRegistration {
  tokenMint: string;
  poolAddress: string;
}

function parseSolanaRegisterToken(
  tx: Awaited<ReturnType<Connection["getTransaction"]>>,
  programId: string,
): SolanaParsedRegistration | null {
  if (!tx) return null;

  const message = tx.transaction.message;
  const accountKeys: PublicKey[] = [];

  // FAIL-FAST: Transaction metadata must exist (validated by caller)
  if (!tx.meta) {
    throw new Error(
      "Transaction metadata missing - should be validated before calling parseSolanaRegisterToken",
    );
  }

  if ("staticAccountKeys" in message) {
    accountKeys.push(...message.staticAccountKeys);
    // loadedAddresses is optional in Solana transaction metadata
    if (tx.meta.loadedAddresses) {
      accountKeys.push(
        ...tx.meta.loadedAddresses.writable.map((addr) => new PublicKey(addr)),
        ...tx.meta.loadedAddresses.readonly.map((addr) => new PublicKey(addr)),
      );
    }
  } else if ("accountKeys" in message) {
    interface MessageWithAccountKeys {
      accountKeys: PublicKey[];
    }
    accountKeys.push(...(message as MessageWithAccountKeys).accountKeys);
  }

  const instructions = message.compiledInstructions;

  for (const ix of instructions) {
    const ixProgramId = accountKeys[ix.programIdIndex];
    if (ixProgramId.toBase58() !== programId) continue;

    const ixData = Buffer.from(ix.data);
    if (ixData.length < 8) continue;

    const discriminator = ixData.subarray(0, 8);
    if (!discriminator.equals(REGISTER_TOKEN_DISCRIMINATOR)) continue;

    const accountIndices = ix.accountKeyIndexes;
    if (accountIndices.length < 5) continue;

    const tokenMint = accountKeys[accountIndices[2]].toBase58();

    let poolAddress = "";
    if (ixData.length >= 73) {
      const poolAddressBytes = ixData.subarray(40, 72);
      poolAddress = new PublicKey(poolAddressBytes).toBase58();
    }

    return { tokenMint, poolAddress };
  }

  return null;
}

async function fetchSolanaTokenData(
  connection: Connection,
  mintAddress: string,
): Promise<{ name: string; symbol: string; decimals: number }> {
  const mintInfo = await connection.getParsedAccountInfo(
    new PublicKey(mintAddress),
  );

  // FAIL-FAST: Mint account must exist
  if (!mintInfo.value) {
    throw new Error(`Mint account ${mintAddress} does not exist`);
  }

  let decimals = 9;

  if (
    mintInfo.value.data &&
    typeof mintInfo.value.data === "object" &&
    "parsed" in mintInfo.value.data
  ) {
    const parsed = mintInfo.value.data.parsed;
    if (parsed.type === "mint" && parsed.info) {
      decimals = parsed.info.decimals;
    }
  }

  const METADATA_PROGRAM_ID = new PublicKey(
    "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
  );
  const mintPubkey = new PublicKey(mintAddress);

  const [metadataPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      METADATA_PROGRAM_ID.toBuffer(),
      mintPubkey.toBuffer(),
    ],
    METADATA_PROGRAM_ID,
  );

  // FAIL-FAST: Metadata fetch must succeed
  const accountInfo = await connection.getAccountInfo(metadataPda);
  if (!accountInfo || accountInfo.data.length < 100) {
    throw new Error(`Metadata account too small for ${mintAddress}`);
  }
  const data = accountInfo.data;
  let offset = 65;

  const nameLen = data.readUInt32LE(offset);
  offset += 4;
  const name = data
    .subarray(offset, offset + nameLen)
    .toString("utf8")
    .replace(/\0/g, "")
    .trim();
  offset += nameLen;

  const symbolLen = data.readUInt32LE(offset);
  offset += 4;
  const symbol = data
    .subarray(offset, offset + symbolLen)
    .toString("utf8")
    .replace(/\0/g, "")
    .trim();

  if (!name || !symbol) {
    throw new Error(`Metadata missing name or symbol for ${mintAddress}`);
  }
  return { name, symbol, decimals };
}

/**
 * Vercel Cron Job Handler
 * Runs periodically to poll for new token registrations
 */
export async function GET(request: NextRequest) {
  // Verify authorization
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  // Always require auth in production
  if (process.env.NODE_ENV === "production" && !cronSecret) {
    console.error("[Cron] No CRON_SECRET configured in production");
    const configErrorResponse = {
      success: false,
      error: "Server configuration error",
    };
    const validatedConfigError =
      CronPollTokenRegistrationsResponseSchema.parse(configErrorResponse);
    return NextResponse.json(validatedConfigError, { status: 500 });
  }

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    console.warn("[Cron] Unauthorized access attempt", {
      ip:
        request.headers.get("x-forwarded-for") ||
        request.headers.get("x-real-ip"),
      timestamp: new Date().toISOString(),
    });
    const unauthorizedResponse = { success: false, error: "Unauthorized" };
    const validatedUnauthorized =
      CronPollTokenRegistrationsResponseSchema.parse(unauthorizedResponse);
    return NextResponse.json(validatedUnauthorized, { status: 401 });
  }

  console.log("[Cron] Starting token registration poll...");

  const results = {
    base: {
      processed: 0,
      error: null as string | null,
      latestBlock: null as string | null,
    },
    solana: {
      processed: 0,
      error: null as string | null,
      lastSignature: null as string | null,
    },
    timestamp: new Date().toISOString(),
  };

  // Poll Base
  const baseResult = await pollBaseRegistrations();
  results.base = {
    processed:
      typeof baseResult.processed === "number" ? baseResult.processed : 0,
    error: typeof baseResult.error === "string" ? baseResult.error : null,
    latestBlock:
      typeof baseResult.latestBlock === "string"
        ? baseResult.latestBlock
        : null,
  };

  // Poll Solana
  const solanaResult = await pollSolanaRegistrations();
  const solanaLastSignature =
    "lastSignature" in solanaResult &&
    typeof solanaResult.lastSignature === "string"
      ? solanaResult.lastSignature
      : null;
  results.solana = {
    processed:
      typeof solanaResult.processed === "number" ? solanaResult.processed : 0,
    error: null, // pollSolanaRegistrations doesn't return error - failures are logged
    lastSignature: solanaLastSignature,
  };

  const totalProcessed = results.base.processed + results.solana.processed;

  const pollResponse = {
    success: true,
    message: `Processed ${totalProcessed} new token registrations`,
    results,
  };
  const validatedPoll =
    CronPollTokenRegistrationsResponseSchema.parse(pollResponse);
  return NextResponse.json(validatedPoll);
}
