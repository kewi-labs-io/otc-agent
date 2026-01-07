/**
 * Consolidated Solana OTC utilities
 *
 * This module provides unified functions for Solana OTC operations,
 * used by both the flow-test and the real application.
 *
 * Key functions:
 * - getTokenProgramId: Detect Token or Token-2022 program
 * - fetchSolanaIdl: Load the Anchor IDL
 * - createSolanaConnection: Create a Connection (HTTP-only, no WebSocket)
 * - createAnchorWallet: Wrap a wallet adapter for Anchor
 * - ensureTokenRegistered: Register token if needed
 * - ensureTreasuryExists: Create desk treasury ATA if needed
 * - createSolanaConsignment: Full consignment creation flow
 * - createSolanaOfferFromConsignment: Create offer from existing consignment
 */

import type { Idl, Wallet } from "@coral-xyz/anchor";
import * as anchor from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  type VersionedTransaction,
} from "@solana/web3.js";
import { SUPPORTED_CHAINS } from "../config/chains";
import { findBestSolanaPool } from "./pool-finder-solana";
import { waitForSolanaTx } from "./tx-helpers";

// Re-export waitForSolanaTx for convenience
export { waitForSolanaTx };

/**
 * Event structure for Solana token registration
 */
export interface SolanaRegistrationEvent {
  tokenMint: string;
  deskAddress: string;
  registeredBy: string;
  poolAddress: string;
  poolType: number;
  signature: string;
}

// Constants
export const SOLANA_RPC = SUPPORTED_CHAINS.solana.rpcUrl;
export const SOLANA_DESK = SUPPORTED_CHAINS.solana.contracts.otc;

/**
 * Detect if a token uses Token or Token-2022 program
 */
export async function getTokenProgramId(
  connection: Connection,
  mintAddress: PublicKey,
): Promise<PublicKey> {
  const mintInfo = await connection.getAccountInfo(mintAddress);
  if (!mintInfo) {
    throw new Error(`Mint account not found: ${mintAddress.toString()}`);
  }
  if (mintInfo.owner.toString() === TOKEN_2022_PROGRAM_ID.toString()) {
    console.log(`[Solana-OTC] Token-2022 detected: ${mintAddress.toString()}`);
    return TOKEN_2022_PROGRAM_ID;
  }
  return TOKEN_PROGRAM_ID;
}

// IDL cache - avoid repeated fetches (IDL is static during a session)
let cachedIdl: Idl | null = null;
let idlFetchPromise: Promise<Idl> | null = null;

/**
 * Fetch the Solana IDL from the API (cached in memory)
 */
export async function fetchSolanaIdl(): Promise<Idl> {
  // Return cached IDL immediately if available
  if (cachedIdl) return cachedIdl;

  // Deduplicate concurrent requests
  if (idlFetchPromise) return idlFetchPromise;

  idlFetchPromise = (async () => {
    const res = await fetch("/api/solana/idl");
    if (!res.ok) throw new Error("Failed to load Solana IDL");
    cachedIdl = (await res.json()) as Idl;
    return cachedIdl;
  })();

  try {
    return await idlFetchPromise;
  } finally {
    idlFetchPromise = null;
  }
}

/**
 * Create a Solana connection with HTTP-only transport (no WebSocket)
 */
export function createSolanaConnection(
  rpcUrl: string = SOLANA_RPC,
  commitment: "processed" | "confirmed" | "finalized" = "confirmed",
): Connection {
  return new Connection(rpcUrl, {
    commitment,
    wsEndpoint: undefined, // Disable WebSocket - proxy doesn't support it
    disableRetryOnRateLimit: false,
  });
}

/**
 * Wallet adapter interface for signing
 *
 * NOTE: This is a utility-specific type that uses Transaction | VersionedTransaction
 * directly for Anchor compatibility. For UI components, use SolanaWalletAdapter from ../types
 * which uses the more generic SolanaTransaction interface.
 */
export interface SolanaWalletAdapter {
  publicKey: string;
  signTransaction: <T extends Transaction | VersionedTransaction>(tx: T) => Promise<T>;
  signAllTransactions: <T extends Transaction | VersionedTransaction>(txs: T[]) => Promise<T[]>;
}

/**
 * Create an Anchor-compatible wallet from a wallet adapter
 * Note: Browser wallets don't have a keypair, so payer is undefined.
 * Cast to Wallet because Anchor operations don't require the payer keypair
 * when transactions are signed externally.
 */
export function createAnchorWallet(adapter: SolanaWalletAdapter): Wallet {
  return {
    publicKey: new PublicKey(adapter.publicKey),
    signTransaction: adapter.signTransaction as Wallet["signTransaction"],
    signAllTransactions: adapter.signAllTransactions as Wallet["signAllTransactions"],
    // Browser wallets don't have payer keypair - AnchorProvider accepts undefined
    payer: undefined as Keypair | undefined,
  } as Wallet;
}

/**
 * Create a dummy Anchor wallet for read-only operations
 */
export function createDummyAnchorWallet(): Wallet {
  const dummyKeypair = Keypair.generate();
  return {
    publicKey: dummyKeypair.publicKey,
    signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T): Promise<T> => {
      if ("version" in tx) (tx as VersionedTransaction).sign([dummyKeypair]);
      else (tx as Transaction).partialSign(dummyKeypair);
      return tx;
    },
    signAllTransactions: async <T extends Transaction | VersionedTransaction>(
      txs: T[],
    ): Promise<T[]> =>
      Promise.all(
        txs.map(async (tx) => {
          if ("version" in tx) (tx as VersionedTransaction).sign([dummyKeypair]);
          else (tx as Transaction).partialSign(dummyKeypair);
          return tx;
        }),
      ),
    payer: dummyKeypair, // Dummy keypair for read-only operations
  };
}

/**
 * Derive the token registry PDA for a token
 */
export function deriveTokenRegistryPda(
  desk: PublicKey,
  tokenMint: PublicKey,
  programId: PublicKey,
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("registry"), desk.toBuffer(), tokenMint.toBuffer()],
    programId,
  );
  return pda;
}

/**
 * Check if a token is registered, register if not
 */
export async function ensureTokenRegistered(
  connection: Connection,
  program: anchor.Program<Idl>,
  desk: PublicKey,
  tokenMint: PublicKey,
  payer: PublicKey,
  signTransaction: <T extends Transaction>(tx: T) => Promise<T>,
): Promise<{ registered: boolean; signature?: string }> {
  const tokenRegistryPda = deriveTokenRegistryPda(desk, tokenMint, program.programId);

  const tokenRegistryInfo = await connection.getAccountInfo(tokenRegistryPda);
  if (tokenRegistryInfo) {
    console.log("[Solana-OTC] Token already registered");
    return { registered: true };
  }

  console.log("[Solana-OTC] Token not registered, registering...");

  // Find a pool for price discovery
  let poolAddress = PublicKey.default;
  let poolType = 0; // 0=None, 1=Raydium, 2=Orca, 3=PumpSwap

  const pool = await findBestSolanaPool(tokenMint.toBase58(), "mainnet");
  if (pool) {
    poolAddress = new PublicKey(pool.address);
    poolType =
      pool.protocol === "PumpSwap"
        ? 3
        : pool.protocol === "Raydium"
          ? 1
          : pool.protocol === "Orca"
            ? 2
            : 0;
    console.log(
      `[Solana-OTC] Found ${pool.protocol} pool: ${pool.address}, price: $${pool.priceUsd}`,
    );
  }

  // Register with pool config (or empty if no pool found)
  const emptyPriceFeedId = new Array(32).fill(0) as number[];

  const registerTx = await program.methods
    .registerToken(emptyPriceFeedId, poolAddress, poolType)
    .accounts({
      desk,
      payer,
      tokenMint,
      tokenRegistry: tokenRegistryPda,
      systemProgram: SystemProgram.programId,
    })
    .transaction();

  registerTx.feePayer = payer;
  registerTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

  const signedRegisterTx = await signTransaction(registerTx);
  const registerSig = await connection.sendRawTransaction(signedRegisterTx.serialize());
  await waitForSolanaTx(connection, registerSig, "confirmed");

  console.log(`[Solana-OTC] Token registered with pool_type=${poolType}: ${registerSig}`);
  return { registered: true, signature: registerSig };
}

/**
 * Ensure desk token treasury ATA exists
 */
export async function ensureTreasuryExists(
  connection: Connection,
  desk: PublicKey,
  tokenMint: PublicKey,
  tokenProgramId: PublicKey,
  payer: PublicKey,
  signTransaction: <T extends Transaction>(tx: T) => Promise<T>,
): Promise<{ exists: boolean; address: PublicKey; signature?: string }> {
  const deskTokenTreasury = await getAssociatedTokenAddress(
    tokenMint,
    desk,
    true, // allowOwnerOffCurve - desk is a PDA
    tokenProgramId,
  );

  const treasuryInfo = await connection.getAccountInfo(deskTokenTreasury);
  if (treasuryInfo) {
    console.log("[Solana-OTC] Desk treasury already exists");
    return { exists: true, address: deskTokenTreasury };
  }

  console.log("[Solana-OTC] Creating desk treasury ATA...");
  const createAtaIx = createAssociatedTokenAccountInstruction(
    payer,
    deskTokenTreasury,
    desk,
    tokenMint,
    tokenProgramId,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  const createAtaTx = new Transaction().add(createAtaIx);
  createAtaTx.feePayer = payer;
  createAtaTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

  const signedTx = await signTransaction(createAtaTx);
  const ataSig = await connection.sendRawTransaction(signedTx.serialize());
  await waitForSolanaTx(connection, ataSig, "confirmed");

  console.log("[Solana-OTC] Desk treasury created:", ataSig);
  return { exists: true, address: deskTokenTreasury, signature: ataSig };
}

/**
 * Consignment parameters for Solana
 */
export interface SolanaConsignmentParams {
  tokenMintAddress: string;
  amount: bigint;
  decimals: number;
  isNegotiable: boolean;
  fixedDiscountBps: number;
  fixedLockupDays: number;
  minDiscountBps: number;
  maxDiscountBps: number;
  minLockupDays: number;
  maxLockupDays: number;
  minDealAmount: bigint;
  maxDealAmount: bigint;
  isFractionalized: boolean;
  isPrivate: boolean;
  maxPriceVolatilityBps: number;
  maxTimeToExecuteSeconds: number;
}

/**
 * Create a Solana consignment - full flow with registration and treasury creation
 */
export async function createSolanaConsignment(
  walletAdapter: SolanaWalletAdapter,
  params: SolanaConsignmentParams,
  onProgress?: (step: string) => void,
): Promise<{ signature: string; consignmentAddress: string }> {
  const log = (msg: string) => {
    console.log(`[Solana-OTC] ${msg}`);
    if (onProgress) {
      onProgress(msg);
    }
  };

  if (!SOLANA_DESK) {
    throw new Error("SOLANA_DESK not configured in SUPPORTED_CHAINS.solana.contracts.otc");
  }

  log("Creating Solana connection...");
  const connection = createSolanaConnection();

  log("Building Anchor wallet adapter...");
  const anchorWallet = createAnchorWallet(walletAdapter);

  log("Creating Anchor provider...");
  const provider = new anchor.AnchorProvider(connection, anchorWallet, {
    commitment: "confirmed",
  });

  log("Fetching IDL...");
  const idl = await fetchSolanaIdl();

  log("Creating Anchor program...");
  const program = new anchor.Program(idl, provider);

  const desk = new PublicKey(SOLANA_DESK);
  const tokenMintPk = new PublicKey(params.tokenMintAddress);
  const consignerPk = new PublicKey(walletAdapter.publicKey);

  log("Detecting token program...");
  const tokenProgramId = await getTokenProgramId(connection, tokenMintPk);

  log("Computing ATAs...");
  const consignerTokenAta = await getAssociatedTokenAddress(
    tokenMintPk,
    consignerPk,
    false,
    tokenProgramId,
  );

  // Ensure token is registered
  log("Checking token registration...");
  await ensureTokenRegistered(
    connection,
    program,
    desk,
    tokenMintPk,
    consignerPk,
    walletAdapter.signTransaction as <T extends Transaction>(tx: T) => Promise<T>,
  );

  // Ensure desk treasury exists
  log("Checking desk treasury...");
  const { address: deskTokenTreasury } = await ensureTreasuryExists(
    connection,
    desk,
    tokenMintPk,
    tokenProgramId,
    consignerPk,
    walletAdapter.signTransaction as <T extends Transaction>(tx: T) => Promise<T>,
  );

  // Create consignment
  log("Creating consignment...");
  const consignmentKeypair = Keypair.generate();

  const rawAmount = new anchor.BN(params.amount.toString());
  const rawMinDeal = new anchor.BN(params.minDealAmount.toString());
  const rawMaxDeal = new anchor.BN(params.maxDealAmount.toString());

  const tx = await program.methods
    .createConsignment(
      rawAmount,
      params.isNegotiable,
      params.fixedDiscountBps,
      params.fixedLockupDays,
      params.minDiscountBps,
      params.maxDiscountBps,
      params.minLockupDays,
      params.maxLockupDays,
      rawMinDeal,
      rawMaxDeal,
      params.isFractionalized,
      params.isPrivate,
      params.maxPriceVolatilityBps,
      new anchor.BN(params.maxTimeToExecuteSeconds),
    )
    .accounts({
      desk,
      consigner: consignerPk,
      tokenMint: tokenMintPk,
      consignerTokenAta,
      deskTokenTreasury,
      consignment: consignmentKeypair.publicKey,
      tokenProgram: tokenProgramId,
      systemProgram: SystemProgram.programId,
    })
    .transaction();

  tx.feePayer = consignerPk;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.partialSign(consignmentKeypair);

  log("Requesting wallet signature...");
  const signedTx = await walletAdapter.signTransaction(tx);

  log("Sending transaction...");
  const signature = await connection.sendRawTransaction(signedTx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });

  log(`Transaction sent: ${signature}, waiting for confirmation...`);
  await waitForSolanaTx(connection, signature, "confirmed");

  log(`Consignment created: ${consignmentKeypair.publicKey.toString()}`);

  return {
    signature,
    consignmentAddress: consignmentKeypair.publicKey.toString(),
  };
}

/**
 * Offer parameters for Solana
 */
export interface SolanaOfferParams {
  consignmentAddress: string;
  tokenAmount: bigint;
  decimals: number;
  discountBps: number;
  paymentCurrency: 0 | 1; // 0 = SOL, 1 = USDC
  lockupSeconds: bigint;
  agentCommissionBps: number;
}

/**
 * Create a Solana offer from an existing consignment
 */
export async function createSolanaOfferFromConsignment(
  walletAdapter: SolanaWalletAdapter,
  tokenMintAddress: string,
  params: SolanaOfferParams,
  onProgress?: (step: string) => void,
): Promise<{ signature: string; offerAddress: string; offerId: string }> {
  const log = (msg: string) => {
    console.log(`[Solana-OTC] ${msg}`);
    if (onProgress) {
      onProgress(msg);
    }
  };

  if (!SOLANA_DESK) {
    throw new Error("SOLANA_DESK not configured");
  }

  log("Creating Solana connection...");
  const connection = createSolanaConnection();

  log("Building Anchor wallet adapter...");
  const anchorWallet = createAnchorWallet(walletAdapter);

  log("Creating Anchor provider...");
  const provider = new anchor.AnchorProvider(connection, anchorWallet, {
    commitment: "confirmed",
  });

  log("Fetching IDL...");
  const idl = await fetchSolanaIdl();

  log("Creating Anchor program...");
  const program = new anchor.Program(idl, provider);

  const desk = new PublicKey(SOLANA_DESK);
  const tokenMintPk = new PublicKey(tokenMintAddress);
  const consignmentPubkey = new PublicKey(params.consignmentAddress);

  // Derive PDAs
  const tokenRegistryPda = deriveTokenRegistryPda(desk, tokenMintPk, program.programId);
  const deskTokenTreasury = await getAssociatedTokenAddress(tokenMintPk, desk, true);

  // Fetch desk account for nextOfferId
  interface DeskAccount {
    nextOfferId: anchor.BN;
  }

  interface DeskAccountProgram {
    desk: {
      fetch: (addr: PublicKey) => Promise<DeskAccount>;
    };
  }

  const deskAccount = await (program.account as DeskAccountProgram).desk.fetch(desk);
  const nextOfferId = new anchor.BN(deskAccount.nextOfferId.toString());

  log(`Next offer ID: ${nextOfferId.toString()}`);

  // Fetch consignment's numeric ID
  interface ConsignmentAccount {
    id: anchor.BN;
  }

  interface ConsignmentAccountProgram {
    consignment: {
      fetch: (addr: PublicKey) => Promise<ConsignmentAccount>;
    };
  }

  const consignmentAccount = await (program.account as ConsignmentAccountProgram).consignment.fetch(
    consignmentPubkey,
  );
  const consignmentId = new anchor.BN(consignmentAccount.id.toString());

  log(`Consignment ID: ${consignmentId.toString()}`);

  // Generate offer keypair
  const offerKeypair = Keypair.generate();
  const tokenAmountWei = new anchor.BN(params.tokenAmount.toString());
  const lockupSeconds = new anchor.BN(params.lockupSeconds.toString());

  log("Building createOfferFromConsignment transaction...");
  const tx = await program.methods
    .createOfferFromConsignment(
      consignmentId,
      tokenAmountWei,
      params.discountBps,
      params.paymentCurrency,
      lockupSeconds,
      params.agentCommissionBps,
    )
    .accounts({
      desk,
      consignment: consignmentPubkey,
      tokenRegistry: tokenRegistryPda,
      deskTokenTreasury,
      beneficiary: new PublicKey(walletAdapter.publicKey),
      offer: offerKeypair.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .transaction();

  tx.feePayer = new PublicKey(walletAdapter.publicKey);
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.partialSign(offerKeypair);

  log("Requesting wallet signature...");
  const signedTx = await walletAdapter.signTransaction(tx);

  log("Sending transaction...");
  const signature = await connection.sendRawTransaction(signedTx.serialize());

  log(`Transaction sent: ${signature}, waiting for confirmation...`);
  await waitForSolanaTx(connection, signature, "confirmed");

  log(`Offer created: ${offerKeypair.publicKey.toString()}`);

  return {
    signature,
    offerAddress: offerKeypair.publicKey.toString(),
    offerId: nextOfferId.toString(),
  };
}

/**
 * Fetch desk and token registry data for pricing calculations
 */
export interface DeskPricingData {
  minUsdAmount8d: bigint;
  price8d: bigint;
  decimals: number;
}

export async function fetchDeskPricingData(tokenMintAddress: string): Promise<DeskPricingData> {
  if (!SOLANA_DESK) {
    throw new Error("SOLANA_DESK not configured");
  }

  const connection = createSolanaConnection();
  const idl = await fetchSolanaIdl();

  const provider = new anchor.AnchorProvider(connection, createDummyAnchorWallet(), {
    commitment: "confirmed",
  });
  const program = new anchor.Program(idl, provider);

  const desk = new PublicKey(SOLANA_DESK);
  const tokenMintPk = new PublicKey(tokenMintAddress);
  const tokenRegistryPda = deriveTokenRegistryPda(desk, tokenMintPk, program.programId);

  // Fetch desk account
  interface DeskAccountWithMin {
    minUsdAmount8D: anchor.BN;
  }

  interface DeskAccountProgramWithMin {
    desk: {
      fetch: (addr: PublicKey) => Promise<DeskAccountWithMin>;
    };
  }

  const deskAccount = await (program.account as DeskAccountProgramWithMin).desk.fetch(desk);

  const minUsdAmount8d = BigInt(deskAccount.minUsdAmount8D.toString());

  // Fetch token registry
  interface TokenRegistryAccount {
    tokenUsdPrice8D: anchor.BN;
    decimals: number;
  }

  interface TokenRegistryAccountProgram {
    tokenRegistry: {
      fetch: (addr: PublicKey) => Promise<TokenRegistryAccount>;
    };
  }

  let price8d = 0n;
  let decimals = 9; // Default for Solana tokens

  const registryInfo = await connection.getAccountInfo(tokenRegistryPda);
  if (registryInfo) {
    const registryAccount = await (
      program.account as TokenRegistryAccountProgram
    ).tokenRegistry.fetch(tokenRegistryPda);
    price8d = BigInt(registryAccount.tokenUsdPrice8D.toString());
    decimals = registryAccount.decimals;
  }

  // If price is zero, update from API
  if (price8d === 0n) {
    const priceRes = await fetch("/api/solana/update-price", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tokenMint: tokenMintAddress,
        forceUpdate: true,
      }),
    });

    if (!priceRes.ok) {
      throw new Error(`Price update failed: HTTP ${priceRes.status}`);
    }

    interface PriceUpdateResponse {
      newPrice?: number;
      price?: number;
    }

    const priceJson = (await priceRes.json()) as PriceUpdateResponse;
    const apiPrice = priceJson.newPrice ?? priceJson.price;
    if (typeof apiPrice !== "number" || apiPrice <= 0) {
      throw new Error(`Invalid price from API: ${apiPrice}`);
    }
    price8d = BigInt(Math.round(apiPrice * 1e8));
  }

  return { minUsdAmount8d, price8d, decimals };
}

/**
 * Calculate required token amount to satisfy desk minimum USD
 */
export function calculateRequiredTokenAmount(
  minUsdAmount8d: bigint,
  price8d: bigint,
  decimals: number,
  discountBps: number,
): bigint {
  if (price8d === 0n) {
    throw new Error("Token price is zero - cannot compute required amount");
  }
  const scale = BigInt(10) ** BigInt(decimals);
  const numerator = minUsdAmount8d * BigInt(10_000) * scale;
  const denominator = price8d * BigInt(10_000 - discountBps);
  const raw = numerator / denominator;
  const needsRounding = numerator % denominator !== 0n;
  return needsRounding ? raw + 1n : raw;
}
