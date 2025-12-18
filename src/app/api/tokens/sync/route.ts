import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, parseAbi } from "viem";
import { Connection, PublicKey } from "@solana/web3.js";
import { TokenRegistryService } from "@/services/tokenRegistry";
import { TokenDB } from "@/services/database";

// register_token instruction discriminator from IDL
const REGISTER_TOKEN_DISCRIMINATOR = Buffer.from([32, 146, 36, 240, 80, 183, 36, 84]);

const ERC20_ABI = parseAbi([
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
]);

/**
 * Sync a specific token registration immediately after on-chain registration
 * This endpoint can be called from the frontend after a transaction confirms
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { chain, transactionHash, blockNumber } = body;

    if (!chain || !transactionHash) {
      return NextResponse.json(
        { success: false, error: "Missing chain or transactionHash" },
        { status: 400 },
      );
    }

    if (chain === "base" || chain === "bsc" || chain === "ethereum") {
      return await syncEvmToken(transactionHash, blockNumber, chain);
    } else if (chain === "solana") {
      return await syncSolanaToken(transactionHash);
    } else {
      return NextResponse.json(
        { success: false, error: "Unsupported chain" },
        { status: 400 },
      );
    }
  } catch (error) {
    console.error("[Sync API] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

/**
 * Sync EVM token registration immediately (Ethereum, Base or BSC)
 */
async function syncEvmToken(
  transactionHash: string,
  blockNumber: string | undefined,
  chain: string,
) {
  // Import chains dynamically to handle Ethereum, Base and BSC
  const { mainnet, base, bsc } = await import("viem/chains");

  const registrationHelperAddress =
    chain === "ethereum"
      ? process.env.NEXT_PUBLIC_ETH_REGISTRATION_HELPER_ADDRESS
      : chain === "bsc"
        ? process.env.NEXT_PUBLIC_BSC_REGISTRATION_HELPER_ADDRESS
        : process.env.NEXT_PUBLIC_REGISTRATION_HELPER_ADDRESS;

  if (!registrationHelperAddress) {
    return NextResponse.json(
      {
        success: false,
        error: `REGISTRATION_HELPER_ADDRESS not configured for ${chain}`,
      },
      { status: 500 },
    );
  }

  // Server-side: use Alchemy directly
  const alchemyKey = process.env.ALCHEMY_API_KEY;
  if (!alchemyKey && chain !== "bsc") {
    return NextResponse.json(
      { success: false, error: "ALCHEMY_API_KEY not configured" },
      { status: 500 },
    );
  }
  const rpcUrl =
    chain === "ethereum"
      ? `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`
      : chain === "bsc"
        ? process.env.NEXT_PUBLIC_BSC_RPC_URL!
        : `https://base-mainnet.g.alchemy.com/v2/${alchemyKey}`;

  const viemChain = chain === "ethereum" ? mainnet : chain === "bsc" ? bsc : base;
  const client = createPublicClient({
    chain: viemChain,
    transport: http(rpcUrl),
  });

  try {
    // Get transaction receipt to find the block
    const receipt = await client.getTransactionReceipt({
      hash: transactionHash as `0x${string}`,
    });
    if (!receipt) {
      return NextResponse.json(
        { success: false, error: "Transaction not found" },
        { status: 404 },
      );
    }

    const txBlock = receipt.blockNumber;
    const startBlock = blockNumber ? BigInt(blockNumber) : txBlock;
    const endBlock = txBlock;

    console.log(
      `[Sync ${chain.toUpperCase()}] Fetching events from block ${startBlock} to ${endBlock}`,
    );

    // Get logs for this specific transaction
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
          { type: "address", name: "registeredBy", indexed: true },
        ],
      },
      fromBlock: startBlock,
      toBlock: endBlock,
    });

    // Filter logs to only this transaction
    const txLogs = logs.filter(
      (log) => log.transactionHash === transactionHash,
    );

    if (txLogs.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "No TokenRegistered event found in transaction",
        },
        { status: 404 },
      );
    }

    let processed = 0;
    const processedTokens: string[] = [];

    for (const log of txLogs) {
      try {
        const { tokenAddress, registeredBy } = log.args as {
          tokenId: string;
          tokenAddress: string;
          pool: string;
          registeredBy: string;
        };

        console.log(
          `[Sync ${chain.toUpperCase()}] Processing token registration: ${tokenAddress} by ${registeredBy}`,
        );

        // Fetch token metadata
        // Use type assertion to bypass viem's strict authorizationList requirement
        const readContract = client.readContract as (
          params: unknown,
        ) => Promise<unknown>;
        const [symbol, name, decimals] = await Promise.all([
          readContract({
            address: tokenAddress as `0x${string}`,
            abi: ERC20_ABI,
            functionName: "symbol",
          }),
          readContract({
            address: tokenAddress as `0x${string}`,
            abi: ERC20_ABI,
            functionName: "name",
          }),
          readContract({
            address: tokenAddress as `0x${string}`,
            abi: ERC20_ABI,
            functionName: "decimals",
          }),
        ]);

        // Register to database - use the chain parameter (ethereum, base or bsc)
        const tokenService = new TokenRegistryService();
        const dbChain = chain === "ethereum" ? "ethereum" : chain === "bsc" ? "bsc" : "base";
        const token = await tokenService.registerToken({
          symbol: symbol as string,
          name: name as string,
          contractAddress: tokenAddress.toLowerCase(),
          chain: dbChain,
          decimals: Number(decimals),
          logoUrl: undefined,
          description: `Registered via RegistrationHelper by ${registeredBy}`,
        });

        processed++;
        processedTokens.push(token.id);
        console.log(
          `[Sync ${chain.toUpperCase()}] ✅ Registered ${symbol} (${tokenAddress})`,
        );
      } catch (error) {
        console.error(
          `[Sync ${chain.toUpperCase()}] Failed to process event:`,
          error,
        );
      }
    }

    return NextResponse.json({
      success: true,
      processed,
      tokens: processedTokens,
      message: `Successfully synced ${processed} token(s) on ${chain}`,
    });
  } catch (error) {
    console.error(`[Sync ${chain.toUpperCase()}] Error:`, error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

/**
 * Sync Solana token registration immediately
 */
async function syncSolanaToken(signature: string) {
  const programId = process.env.NEXT_PUBLIC_SOLANA_PROGRAM_ID;
  if (!programId) {
    return NextResponse.json(
      { success: false, error: "SOLANA_PROGRAM_ID not configured" },
      { status: 500 },
    );
  }

  const rpcUrl =
    process.env.NEXT_PUBLIC_SOLANA_RPC || "https://api.mainnet-beta.solana.com";
  const connection = new Connection(rpcUrl, "confirmed");

  try {
    console.log(`[Sync Solana] Fetching transaction: ${signature}`);

    const tx = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    if (!tx) {
      return NextResponse.json(
        { success: false, error: "Transaction not found" },
        { status: 404 },
      );
    }

    if (!tx.meta || !tx.meta.logMessages) {
      return NextResponse.json(
        { success: false, error: "No log messages in transaction" },
        { status: 404 },
      );
    }

    const hasRegisterToken = tx.meta.logMessages.some(
      (log) =>
        log.includes("Instruction: RegisterToken") ||
        log.includes("register_token"),
    );

    if (!hasRegisterToken) {
      return NextResponse.json(
        { success: false, error: "No register_token instruction found" },
        { status: 404 },
      );
    }

    // Parse the transaction to extract token mint
    const parsed = parseSolanaRegisterToken(tx, programId);
    if (!parsed) {
      return NextResponse.json(
        { success: false, error: "Failed to parse register_token instruction" },
        { status: 400 },
      );
    }

    // Fetch token metadata and register
    const tokenData = await fetchSolanaTokenData(connection, parsed.tokenMint);
    
    const token = await TokenDB.createToken({
      symbol: tokenData.symbol,
      name: tokenData.name,
      chain: "solana",
      contractAddress: parsed.tokenMint,
      decimals: tokenData.decimals,
      isActive: true,
      logoUrl: null,
      priceUsd: null,
      marketCap: null,
      volume24h: null,
      priceChange24h: null,
      poolAddress: parsed.poolAddress || null,
    });

    console.log(`[Sync Solana] ✅ Registered token: ${token.symbol} (${parsed.tokenMint})`);

    return NextResponse.json({
      success: true,
      processed: 1,
      token: {
        id: token.id,
        symbol: token.symbol,
        name: token.name,
        mint: parsed.tokenMint,
      },
    });
  } catch (error) {
    console.error("[Sync Solana] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

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

  if ("staticAccountKeys" in message) {
    accountKeys.push(...message.staticAccountKeys);
    if (tx.meta?.loadedAddresses) {
      accountKeys.push(
        ...tx.meta.loadedAddresses.writable.map((addr) => new PublicKey(addr)),
        ...tx.meta.loadedAddresses.readonly.map((addr) => new PublicKey(addr)),
      );
    }
  } else if ("accountKeys" in message) {
    accountKeys.push(...(message as { accountKeys: PublicKey[] }).accountKeys);
  }

  const instructions = message.compiledInstructions;

  for (const ix of instructions) {
    const ixProgramId = accountKeys[ix.programIdIndex];
    if (ixProgramId.toBase58() !== programId) continue;

    const ixData = Buffer.from(ix.data);
    if (ixData.length < 8) continue;

    const discriminator = ixData.subarray(0, 8);
    if (!discriminator.equals(REGISTER_TOKEN_DISCRIMINATOR)) continue;

    // register_token accounts: desk[0], payer[1], token_mint[2], token_registry[3], system_program[4]
    const accountIndices = ix.accountKeyIndexes;
    if (accountIndices.length < 5) continue;

    const tokenMint = accountKeys[accountIndices[2]].toBase58();

    // Parse pool_address from instruction data (offset 40-72)
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
  // Get decimals from mint account
  const mintInfo = await connection.getParsedAccountInfo(new PublicKey(mintAddress));
  let decimals = 9;

  if (
    mintInfo.value?.data &&
    typeof mintInfo.value.data === "object" &&
    "parsed" in mintInfo.value.data
  ) {
    const parsed = mintInfo.value.data.parsed;
    if (parsed.type === "mint" && parsed.info) {
      decimals = parsed.info.decimals;
    }
  }

  // Try Metaplex metadata
  const METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
  const mintPubkey = new PublicKey(mintAddress);

  const [metadataPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), mintPubkey.toBuffer()],
    METADATA_PROGRAM_ID,
  );

  try {
    const accountInfo = await connection.getAccountInfo(metadataPda);
    if (accountInfo && accountInfo.data.length >= 100) {
      const data = accountInfo.data;
      let offset = 65; // Skip key + update_authority + mint

      const nameLen = data.readUInt32LE(offset);
      offset += 4;
      const name = data.subarray(offset, offset + nameLen).toString("utf8").replace(/\0/g, "").trim();
      offset += nameLen;

      const symbolLen = data.readUInt32LE(offset);
      offset += 4;
      const symbol = data.subarray(offset, offset + symbolLen).toString("utf8").replace(/\0/g, "").trim();

      if (name && symbol) {
        return { name, symbol, decimals };
      }
    }
  } catch {
    // Metadata fetch failed, use fallback
  }

  return {
    name: `Token ${mintAddress.slice(0, 8)}`,
    symbol: mintAddress.slice(0, 6).toUpperCase(),
    decimals,
  };
}
