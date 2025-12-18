import {
  Connection,
  PublicKey,
  type Logs,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import { TokenDB } from "./database";

let isListening = false;
let connection: Connection | null = null;

// register_token instruction discriminator from IDL: [32, 146, 36, 240, 80, 183, 36, 84]
const REGISTER_TOKEN_DISCRIMINATOR = Buffer.from([32, 146, 36, 240, 80, 183, 36, 84]);

interface ParsedRegistration {
  tokenMint: string;
  deskAddress: string;
  registeredBy: string;
  poolAddress: string;
  poolType: number;
  signature: string;
}

/**
 * Start listening for register_token events from Solana program
 */
export async function startSolanaListener() {
  if (isListening) {
    console.warn("[Solana Listener] Already listening");
    return;
  }

  const programId = process.env.NEXT_PUBLIC_SOLANA_PROGRAM_ID;
  if (!programId) {
    console.error("[Solana Listener] SOLANA_PROGRAM_ID not configured");
    return;
  }

  const rpcUrl =
    process.env.NEXT_PUBLIC_SOLANA_RPC || "https://api.mainnet-beta.solana.com";
  connection = new Connection(rpcUrl, "confirmed");

  try {
    console.log("[Solana Listener] Starting listener for program", programId);
    isListening = true;

    const subscriptionId = connection.onLogs(
      new PublicKey(programId),
      async (logs: Logs) => {
        await handleProgramLogs(logs);
      },
      "confirmed",
    );

    process.on("SIGINT", async () => {
      console.log("[Solana Listener] Stopping...");
      if (connection) {
        await connection.removeOnLogsListener(subscriptionId);
      }
      isListening = false;
    });

    process.on("SIGTERM", async () => {
      console.log("[Solana Listener] Stopping...");
      if (connection) {
        await connection.removeOnLogsListener(subscriptionId);
      }
      isListening = false;
    });

    console.log("[Solana Listener] Now listening for token registrations");
  } catch (error) {
    console.error("[Solana Listener] Failed to start:", error);
    isListening = false;
  }
}

async function handleProgramLogs(logs: Logs) {
  const logMessages = logs.logs;
  const hasRegisterToken = logMessages.some(
    (log: string) =>
      log.includes("Instruction: RegisterToken") ||
      log.includes("register_token"),
  );

  if (!hasRegisterToken) return;

  console.log("[Solana Listener] Token registration detected:", logs.signature);

  if (connection) {
    try {
      const tx = await connection.getTransaction(logs.signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });

      if (tx) {
        const parsed = parseRegisterTokenTransaction(tx, logs.signature);
        if (parsed) {
          await registerTokenToDatabase(parsed);
        }
      }
    } catch (error) {
      console.error("[Solana Listener] Failed to process registration:", error);
    }
  }
}

/**
 * Parse register_token transaction and extract token mint address
 */
function parseRegisterTokenTransaction(
  tx: VersionedTransactionResponse,
  signature: string,
): ParsedRegistration | null {
  const message = tx.transaction.message;
  
  // Get all account keys (static + loaded addresses for v0 transactions)
  const accountKeys: PublicKey[] = [];
  
  if ('staticAccountKeys' in message) {
    // Versioned transaction (v0)
    accountKeys.push(...message.staticAccountKeys);
    if (tx.meta?.loadedAddresses) {
      accountKeys.push(
        ...tx.meta.loadedAddresses.writable.map(addr => new PublicKey(addr)),
        ...tx.meta.loadedAddresses.readonly.map(addr => new PublicKey(addr)),
      );
    }
  } else if ('accountKeys' in message) {
    // Legacy transaction
    accountKeys.push(...(message as { accountKeys: PublicKey[] }).accountKeys);
  }

  // Find the register_token instruction
  const instructions = message.compiledInstructions;
  
  for (const ix of instructions) {
    const programId = accountKeys[ix.programIdIndex];
    const expectedProgramId = process.env.NEXT_PUBLIC_SOLANA_PROGRAM_ID;
    
    if (!expectedProgramId || programId.toBase58() !== expectedProgramId) {
      continue;
    }

    // Check instruction discriminator
    const ixData = Buffer.from(ix.data);
    if (ixData.length < 8) continue;
    
    const discriminator = ixData.subarray(0, 8);
    if (!discriminator.equals(REGISTER_TOKEN_DISCRIMINATOR)) continue;

    // register_token accounts order from IDL:
    // 0: desk
    // 1: payer (writable, signer) - this is registeredBy
    // 2: token_mint
    // 3: token_registry (PDA)
    // 4: system_program
    const accountIndices = ix.accountKeyIndexes;
    if (accountIndices.length < 5) {
      console.warn("[Solana Listener] Unexpected account count:", accountIndices.length);
      continue;
    }

    const deskAddress = accountKeys[accountIndices[0]].toBase58();
    const registeredBy = accountKeys[accountIndices[1]].toBase58();
    const tokenMint = accountKeys[accountIndices[2]].toBase58();

    // Parse instruction args: price_feed_id (32 bytes), pool_address (32 bytes), pool_type (1 byte)
    // Total: 8 (discriminator) + 32 + 32 + 1 = 73 bytes
    if (ixData.length >= 73) {
      const poolAddressBytes = ixData.subarray(40, 72); // after discriminator (8) + price_feed_id (32)
      const poolAddress = new PublicKey(poolAddressBytes).toBase58();
      const poolType = ixData[72];

      console.log("[Solana Listener] Parsed registration:", {
        tokenMint,
        deskAddress,
        registeredBy,
        poolAddress,
        poolType,
      });

      return {
        tokenMint,
        deskAddress,
        registeredBy,
        poolAddress,
        poolType,
        signature,
      };
    }

    // Fallback: minimal parse without pool info
    return {
      tokenMint,
      deskAddress,
      registeredBy,
      poolAddress: "",
      poolType: 0,
      signature,
    };
  }

  console.warn("[Solana Listener] Could not find register_token instruction in tx");
  return null;
}

/**
 * Fetch token metadata from Solana and register to database
 */
async function registerTokenToDatabase(parsed: ParsedRegistration): Promise<void> {
  if (!connection) {
    throw new Error("No Solana connection available");
  }

  try {
    // Fetch token mint account to get decimals
    const mintInfo = await connection.getParsedAccountInfo(new PublicKey(parsed.tokenMint));
    
    let decimals = 9; // Default for SPL tokens
    let symbol = parsed.tokenMint.slice(0, 6); // Fallback symbol
    let name = `Token ${parsed.tokenMint.slice(0, 8)}`;

    if (mintInfo.value?.data && typeof mintInfo.value.data === "object" && "parsed" in mintInfo.value.data) {
      const parsed_data = mintInfo.value.data.parsed;
      if (parsed_data.type === "mint" && parsed_data.info) {
        decimals = parsed_data.info.decimals;
      }
    }

    // Try to fetch token metadata from Metaplex
    try {
      const metadataResult = await fetchTokenMetadata(parsed.tokenMint);
      if (metadataResult) {
        symbol = metadataResult.symbol;
        name = metadataResult.name;
      }
    } catch (metaError) {
      console.warn("[Solana Listener] Could not fetch metadata, using fallback:", metaError);
    }

    // Create token in database
    const token = await TokenDB.createToken({
      symbol,
      name,
      chain: "solana",
      contractAddress: parsed.tokenMint,
      decimals,
      isActive: true,
      logoUrl: null,
      priceUsd: null,
      marketCap: null,
      volume24h: null,
      priceChange24h: null,
      poolAddress: parsed.poolAddress || null,
    });

    console.log("[Solana Listener] ✅ Token registered to database:", {
      id: token.id,
      symbol: token.symbol,
      mint: parsed.tokenMint,
      signature: parsed.signature,
    });
  } catch (error) {
    console.error("[Solana Listener] Failed to register token to database:", error);
    throw error;
  }
}

/**
 * Fetch token metadata from Metaplex Token Metadata program
 */
async function fetchTokenMetadata(mintAddress: string): Promise<{ name: string; symbol: string } | null> {
  if (!connection) return null;

  // Metaplex Token Metadata Program
  const METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
  const mintPubkey = new PublicKey(mintAddress);

  // Derive metadata PDA
  const [metadataPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      METADATA_PROGRAM_ID.toBuffer(),
      mintPubkey.toBuffer(),
    ],
    METADATA_PROGRAM_ID,
  );

  const accountInfo = await connection.getAccountInfo(metadataPda);
  if (!accountInfo || accountInfo.data.length < 100) return null;

  // Parse Metaplex metadata (simplified - full parsing would require borsh)
  // Layout: key(1) + update_authority(32) + mint(32) + name_len(4) + name + symbol_len(4) + symbol + ...
  const data = accountInfo.data;
  
  // Skip: key (1) + update_authority (32) + mint (32) = 65 bytes
  let offset = 65;
  
  // Read name (length-prefixed string, 4 bytes for length)
  const nameLen = data.readUInt32LE(offset);
  offset += 4;
  const name = data.subarray(offset, offset + nameLen).toString("utf8").replace(/\0/g, "").trim();
  offset += nameLen;

  // Read symbol (length-prefixed string, 4 bytes for length)
  const symbolLen = data.readUInt32LE(offset);
  offset += 4;
  const symbol = data.subarray(offset, offset + symbolLen).toString("utf8").replace(/\0/g, "").trim();

  if (name && symbol) {
    return { name, symbol };
  }
  return null;
}

/**
 * Backfill historical events
 */
export async function backfillSolanaEvents(signatures?: string[]) {
  const programId = process.env.NEXT_PUBLIC_SOLANA_PROGRAM_ID;
  if (!programId) {
    throw new Error("SOLANA_PROGRAM_ID not configured");
  }

  const rpcUrl =
    process.env.NEXT_PUBLIC_SOLANA_RPC || "https://api.mainnet-beta.solana.com";
  const conn = new Connection(rpcUrl, "confirmed");

  console.log("[Solana Backfill] Fetching transactions for program", programId);

  const sigs =
    signatures ||
    (
      await conn.getSignaturesForAddress(new PublicKey(programId), {
        limit: 100,
      })
    ).map((s) => s.signature);

  console.log(`[Solana Backfill] Processing ${sigs.length} transactions`);

  let registered = 0;
  for (const sig of sigs) {
    try {
      const tx = await conn.getTransaction(sig, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });

      if (tx && tx.meta && tx.meta.logMessages) {
        const hasRegisterToken = tx.meta.logMessages.some(
          (log) =>
            log.includes("Instruction: RegisterToken") ||
            log.includes("register_token"),
        );

        if (hasRegisterToken) {
          const parsed = parseRegisterTokenTransaction(tx, sig);
          if (parsed) {
            // Set connection temporarily for registerTokenToDatabase
            const oldConn = connection;
            connection = conn;
            try {
              await registerTokenToDatabase(parsed);
              registered++;
            } finally {
              connection = oldConn;
            }
          }
        }
      }
    } catch (error) {
      console.warn(`[Solana Backfill] Failed to process ${sig}:`, error);
    }
  }

  console.log(`[Solana Backfill] ✅ Registered ${registered} tokens`);
}
