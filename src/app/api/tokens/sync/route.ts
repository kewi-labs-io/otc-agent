import { Connection, PublicKey } from "@solana/web3.js";
import { type NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, parseAbi } from "viem";
import {
  getEvmConfig,
  getRegistrationHelperForChain,
  getSolanaProgramId,
} from "@/config/contracts";
import { getHeliusRpcUrl, getNetwork } from "@/config/env";
import type { MinimalPublicClient } from "@/lib/viem-utils";
import { TokenDB } from "@/services/database";
import { TokenRegistryService } from "@/services/tokenRegistry";
import { fetchLogoParallel } from "@/utils/logo-fetcher";

// Type for parsed Solana token registration
interface SolanaParsedRegistration {
  tokenMint: string;
  poolAddress: string;
}

import { parseOrThrow } from "@/lib/validation/helpers";
import { TokenSyncRequestSchema, TokenSyncResponseSchema } from "@/types/validation/api-schemas";

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
  const body = await request.json();

  const data = parseOrThrow(TokenSyncRequestSchema, body);

  const { chain, transactionHash, blockNumber } = data;

  if (chain === "base" || chain === "bsc" || chain === "ethereum") {
    return await syncEvmToken(transactionHash, blockNumber, chain);
  } else if (chain === "solana") {
    return await syncSolanaToken(transactionHash);
  } else {
    const unsupportedResponse = {
      success: false,
      error: "Unsupported chain",
    };
    const validatedUnsupported = TokenSyncResponseSchema.parse(unsupportedResponse);
    return NextResponse.json(validatedUnsupported, { status: 400 });
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

  const evmConfig = getEvmConfig();
  // FAIL-FAST: EVM chainId must be configured
  if (evmConfig.chainId === undefined) {
    throw new Error("EVM chainId not configured");
  }
  const primaryChainId = evmConfig.chainId;
  const chainId = chain === "ethereum" ? 1 : chain === "bsc" ? 56 : primaryChainId;
  const registrationHelperAddress = getRegistrationHelperForChain(chainId);

  // FAIL-FAST: RegistrationHelper must be configured for the chain
  if (!registrationHelperAddress) {
    throw new Error(`RegistrationHelper not configured for ${chain} (chainId=${chainId})`);
  }

  // Server-side: use Alchemy directly
  // FAIL-FAST: Alchemy key required for Ethereum and Base (BSC uses public RPC)
  const alchemyKey = process.env.ALCHEMY_API_KEY;
  if (!alchemyKey && chain !== "bsc") {
    throw new Error("ALCHEMY_API_KEY not configured");
  }
  const rpcUrl =
    chain === "ethereum"
      ? `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`
      : chain === "bsc"
        ? "https://bsc-dataseed1.binance.org"
        : `https://base-mainnet.g.alchemy.com/v2/${alchemyKey}`;

  const viemChain = chain === "ethereum" ? mainnet : chain === "bsc" ? bsc : base;
  const client = createPublicClient({
    chain: viemChain,
    transport: http(rpcUrl),
  });

  // Get transaction receipt to find the block
  const receipt = await client.getTransactionReceipt({
    hash: transactionHash as `0x${string}`,
  });
  // FAIL-FAST: Transaction receipt must exist
  if (!receipt) {
    throw new Error(`Transaction ${transactionHash} not found`);
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
  const txLogs = logs.filter((log) => log.transactionHash === transactionHash);

  // FAIL-FAST: Transaction must contain TokenRegistered event
  if (txLogs.length === 0) {
    throw new Error(`No TokenRegistered event found in transaction ${transactionHash}`);
  }

  let processed = 0;
  const processedTokens: string[] = [];

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

  for (const log of txLogs) {
    const { tokenAddress, registeredBy } = (log as TokenRegisteredLog).args;

    console.log(
      `[Sync ${chain.toUpperCase()}] Processing token registration: ${tokenAddress} by ${registeredBy}`,
    );

    // Fetch token metadata
    const viemClient = client as MinimalPublicClient;
    const [symbol, name, decimals, logoUrl] = await Promise.all([
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
      fetchLogoParallel(tokenAddress, chain, alchemyKey),
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
      // logoUrl is optional - use empty string as default if not provided
      logoUrl: logoUrl ?? "",
      description: `Registered via RegistrationHelper by ${registeredBy}`,
    });

    processed++;
    processedTokens.push(token.id);
    console.log(`[Sync ${chain.toUpperCase()}] ✅ Registered ${symbol} (${tokenAddress})`);
  }

  const evmSyncResponse = {
    success: true,
    processed,
    tokens: processedTokens,
    message: `Successfully synced ${processed} token(s) on ${chain}`,
  };
  const validatedEvmSync = TokenSyncResponseSchema.parse(evmSyncResponse);
  return NextResponse.json(validatedEvmSync);
}

/**
 * Sync Solana token registration immediately
 */
async function syncSolanaToken(signature: string) {
  const programId = getSolanaProgramId();

  const network = getNetwork();
  const rpcUrl = network === "local" ? "http://127.0.0.1:8899" : getHeliusRpcUrl();
  console.log(`[Sync Solana] Using Helius RPC`);
  const connection = new Connection(rpcUrl, "confirmed");

  console.log(`[Sync Solana] Fetching transaction: ${signature}`);

  const tx = await connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });

  // FAIL-FAST: Transaction must exist
  if (!tx) {
    throw new Error(`Transaction ${signature} not found`);
  }

  // FAIL-FAST: Transaction metadata must exist
  if (!tx.meta) {
    throw new Error("Transaction missing metadata - cannot parse Solana registration");
  }
  // FAIL-FAST: Transaction must have log messages
  if (!tx.meta.logMessages) {
    throw new Error(`Transaction ${signature} has no log messages - cannot parse registration`);
  }

  const hasRegisterToken = tx.meta.logMessages.some(
    (log) => log.includes("Instruction: RegisterToken") || log.includes("register_token"),
  );

  // FAIL-FAST: Transaction must contain register_token instruction
  if (!hasRegisterToken) {
    throw new Error(`Transaction ${signature} does not contain register_token instruction`);
  }

  // Parse the transaction to extract token mint
  // FAIL-FAST: Parsing must succeed
  const parsed = parseSolanaRegisterToken(tx, programId);
  if (!parsed) {
    throw new Error(`Failed to parse register_token instruction from transaction ${signature}`);
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
    logoUrl: "",
    description: "",
  });

  console.log(`[Sync Solana] ✅ Registered token: ${token.symbol} (${parsed.tokenMint})`);

  const solanaSyncResponse = {
    success: true,
    processed: 1,
    token: {
      id: token.id,
      symbol: token.symbol,
      name: token.name,
      mint: parsed.tokenMint,
    },
  };
  const validatedSolanaSync = TokenSyncResponseSchema.parse(solanaSyncResponse);
  return NextResponse.json(validatedSolanaSync);
}

function parseSolanaRegisterToken(
  tx: Awaited<ReturnType<Connection["getTransaction"]>>,
  programId: string,
): SolanaParsedRegistration | null {
  // FAIL-FAST: Transaction must exist
  if (!tx) {
    throw new Error("Transaction is null - cannot parse registration");
  }

  // FAIL-FAST: Transaction metadata must exist (validated by caller)
  if (!tx.meta) {
    throw new Error(
      "Transaction metadata missing - should be validated before calling parseSolanaRegisterToken",
    );
  }

  const message = tx.transaction.message;
  const accountKeys: PublicKey[] = [];

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

  // Try Metaplex metadata
  const METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
  const mintPubkey = new PublicKey(mintAddress);

  const [metadataPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), mintPubkey.toBuffer()],
    METADATA_PROGRAM_ID,
  );

  const accountInfo = await connection.getAccountInfo(metadataPda);
  if (accountInfo && accountInfo.data.length >= 100) {
    const data = accountInfo.data;
    let offset = 65; // Skip key + update_authority + mint

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

    if (name && symbol) {
      return { name, symbol, decimals };
    }
  }

  return {
    name: `Token ${mintAddress.slice(0, 8)}`,
    symbol: mintAddress.slice(0, 6).toUpperCase(),
    decimals,
  };
}
