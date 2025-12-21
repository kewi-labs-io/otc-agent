/**
 * On-Chain Verification Utilities for E2E Tests
 *
 * Provides functions to read and verify on-chain state for both EVM and Solana.
 * Uses fail-fast patterns - throws on any failure.
 */

import { readFileSync } from "fs";
import { join } from "path";
import {
  createPublicClient,
  encodePacked,
  formatEther,
  http,
  keccak256,
  type Abi,
  type Address,
} from "viem";
import { foundry } from "viem/chains";
import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { evmSeller, phantomTrader, tokenAddresses } from "./wallets";
import { safeReadContract } from "../../../src/lib/viem-utils";
import { type RawOfferData, parseOfferStruct } from "../../../src/lib/otc-helpers";
import type {
  EvmDeploymentSnapshot,
  OfferSnapshot,
  ConsignmentSnapshot,
  SolanaDeploymentSnapshot,
  SolanaDeskSnapshot,
  SolanaConsignmentSnapshot,
  SolanaOfferSnapshot,
  ConsignmentCreatedArgs,
} from "../../../src/types";
import {
  loadEvmDeployment as loadEvmDeploymentBase,
  loadSolanaDeployment as loadSolanaDeploymentBase,
  expectDefined,
  expectNonEmptyString,
} from "../../test-utils";

// =============================================================================
// EVM ON-CHAIN VERIFICATION
// =============================================================================

/**
 * Load EVM deployment. Throws if not found or invalid.
 */
export function loadEvmDeployment(): EvmDeploymentSnapshot {
  const deployment = loadEvmDeploymentBase();
  // Convert EvmDeployment to EvmDeploymentSnapshot (they have the same structure)
  return {
    otc: deployment.otc,
    token: deployment.token,
    usdc: deployment.usdc,
  };
}

export const evmClient = createPublicClient({
  chain: {
    ...foundry,
    id: evmSeller.chainId,
  },
  transport: http(evmSeller.rpcUrl),
});

interface OtcArtifact {
  abi: Abi;
}

function loadOtcAbi(): Abi {
  const abiPath = join(process.cwd(), "src/contracts/artifacts/contracts/OTC.sol/OTC.json");
  const artifact = JSON.parse(readFileSync(abiPath, "utf8")) as OtcArtifact;
  return artifact.abi;
}

export async function getOfferCount(otcAddress: Address): Promise<bigint> {
  const abi = loadOtcAbi();
  const result = await safeReadContract<bigint>(evmClient, {
    address: otcAddress,
    abi,
    functionName: "nextOfferId",
  });
  return expectDefined(result, "nextOfferId");
}

export async function getConsignmentCount(otcAddress: Address): Promise<bigint> {
  const abi = loadOtcAbi();
  const result = await safeReadContract<bigint>(evmClient, {
    address: otcAddress,
    abi,
    functionName: "nextConsignmentId",
  });
  return expectDefined(result, "nextConsignmentId");
}

/**
 * Raw consignment data tuple from contract read
 */
type RawConsignmentData = readonly [
  `0x${string}`, // tokenId
  Address, // consigner
  bigint, // totalAmount
  bigint, // remainingAmount
  boolean, // isNegotiable
  bigint | number, // fixedDiscountBps
  bigint | number, // fixedLockupDays
  bigint | number, // minDiscountBps
  bigint | number, // maxDiscountBps
  bigint | number, // minLockupDays
  bigint | number, // maxLockupDays
  bigint, // minDealAmount
  bigint, // maxDealAmount
  bigint | number, // maxPriceVolatilityBps
  boolean, // isActive
  bigint, // createdAt
];

export async function getOffer(otcAddress: Address, offerId: bigint): Promise<OfferSnapshot> {
  const abi = loadOtcAbi();
  const data = await safeReadContract<RawOfferData>(evmClient, {
    address: otcAddress,
    abi,
    functionName: "offers",
    args: [offerId],
  });

  const rawData = expectDefined(data, `offer ${offerId}`);

  // Handle array format
  if (Array.isArray(rawData)) {
    return {
      consignmentId: rawData[0],
      tokenId: rawData[1] as `0x${string}`,
      beneficiary: rawData[2] as Address,
      tokenAmount: rawData[3],
      discountBps: rawData[4],
      createdAt: rawData[5],
      unlockTime: rawData[6],
      priceUsdPerToken: rawData[7],
      maxPriceDeviation: rawData[8],
      ethUsdPrice: rawData[9],
      currency: Number(rawData[10]),
      approved: rawData[11],
      paid: rawData[12],
      fulfilled: rawData[13],
      cancelled: rawData[14],
      payer: rawData[15] as Address,
      amountPaid: rawData[16],
      agentCommissionBps: Number(rawData[17]),
    } satisfies OfferSnapshot;
  }

  // Object format - use parseOfferStruct helper
  const parsed = parseOfferStruct(rawData);
  // Ensure all types match OfferSnapshot interface
  return {
    consignmentId: parsed.consignmentId,
    tokenId: parsed.tokenId as `0x${string}`,
    beneficiary: parsed.beneficiary as Address,
    tokenAmount: parsed.tokenAmount,
    discountBps: parsed.discountBps, // Already bigint from ParsedOffer
    createdAt: parsed.createdAt,
    unlockTime: parsed.unlockTime,
    priceUsdPerToken: parsed.priceUsdPerToken,
    maxPriceDeviation: parsed.maxPriceDeviation,
    ethUsdPrice: parsed.ethUsdPrice,
    currency: parsed.currency,
    approved: parsed.approved,
    paid: parsed.paid,
    fulfilled: parsed.fulfilled,
    cancelled: parsed.cancelled,
    payer: parsed.payer as Address,
    amountPaid: parsed.amountPaid,
    agentCommissionBps: parsed.agentCommissionBps,
  } satisfies OfferSnapshot;
}

export async function getConsignment(
  otcAddress: Address,
  consignmentId: bigint,
): Promise<ConsignmentSnapshot> {
  const abi = loadOtcAbi();
  const data = await safeReadContract<RawConsignmentData>(evmClient, {
    address: otcAddress,
    abi,
    functionName: "consignments",
    args: [consignmentId],
  });

  const rawData = expectDefined(data, `consignment ${consignmentId}`);

  return {
    tokenId: rawData[0],
    consigner: rawData[1],
    totalAmount: rawData[2],
    remainingAmount: rawData[3],
    isNegotiable: rawData[4],
    fixedDiscountBps: BigInt(rawData[5]),
    fixedLockupDays: BigInt(rawData[6]),
    minDiscountBps: BigInt(rawData[7]),
    maxDiscountBps: BigInt(rawData[8]),
    minLockupDays: BigInt(rawData[9]),
    maxLockupDays: BigInt(rawData[10]),
    minDealAmount: rawData[11],
    maxDealAmount: rawData[12],
    maxPriceVolatilityBps: BigInt(rawData[13]),
    isActive: rawData[14],
    createdAt: rawData[15],
  } satisfies ConsignmentSnapshot;
}

export async function getErc20Balance(token: Address, account: Address): Promise<bigint> {
  const erc20Abi = [
    {
      inputs: [{ name: "account", type: "address" }],
      name: "balanceOf",
      outputs: [{ name: "", type: "uint256" }],
      stateMutability: "view",
      type: "function",
    },
  ] as const;

  const result = await safeReadContract<bigint>(evmClient, {
    address: token,
    abi: erc20Abi as Abi,
    functionName: "balanceOf",
    args: [account],
  });

  return expectDefined(result, `ERC20 balance of ${account}`);
}

export function formatEtherAmount(value: bigint): string {
  return formatEther(value);
}

export function computeEvmTokenId(token: Address): `0x${string}` {
  return keccak256(encodePacked(["address"], [token]));
}

// =============================================================================
// SOLANA ON-CHAIN VERIFICATION
// =============================================================================

/**
 * Load Solana deployment. Throws if not found or invalid.
 */
export function loadSolanaDeployment(): SolanaDeploymentSnapshot {
  const deployment = loadSolanaDeploymentBase();
  // Convert SolanaDeployment to SolanaDeploymentSnapshot (they have the same structure)
  return {
    programId: deployment.programId,
    desk: deployment.desk,
    deskOwner: deployment.deskOwner,
    usdcMint: deployment.usdcMint,
    rpc: deployment.rpc,
  };
}

export function solanaConnection(): Connection {
  return new Connection(phantomTrader.rpcUrl, "confirmed");
}

export async function getSolBalance(address: string): Promise<number> {
  expectNonEmptyString(address, "Solana address");
  const connection = solanaConnection();
  const lamports = await connection.getBalance(new PublicKey(address));
  return lamports / LAMPORTS_PER_SOL;
}

interface ParsedTokenAccountData {
  parsed: {
    info: {
      tokenAmount: {
        amount: string;
      };
    };
  };
}

export async function getSolanaTokenBalance(owner: string, mint: string): Promise<bigint> {
  expectNonEmptyString(owner, "token owner");
  expectNonEmptyString(mint, "token mint");

  const connection = solanaConnection();
  const accounts = await connection.getParsedTokenAccountsByOwner(new PublicKey(owner), {
    mint: new PublicKey(mint),
  });

  if (accounts.value.length === 0) {
    return 0n;
  }

  const accountData = accounts.value[0].account.data;
  // FAIL-FAST: Validate parsed token account structure with type narrowing
  if (
    accountData &&
    typeof accountData === "object" &&
    "parsed" in accountData &&
    accountData.parsed &&
    typeof accountData.parsed === "object" &&
    "info" in accountData.parsed &&
    accountData.parsed.info &&
    typeof accountData.parsed.info === "object" &&
    "tokenAmount" in accountData.parsed.info &&
    accountData.parsed.info.tokenAmount &&
    typeof accountData.parsed.info.tokenAmount === "object" &&
    "amount" in accountData.parsed.info.tokenAmount
  ) {
    const parsedData = accountData as ParsedTokenAccountData;
    const amount = parsedData.parsed.info.tokenAmount.amount;
    if (typeof amount === "string") {
      return BigInt(amount);
    }
  }

  return 0n;
}

export async function snapshotBalances(params: {
  readonly evmAddress: Address;
  readonly solanaAddress: string;
  readonly solanaMint: string;
}) {
  const deployment = loadEvmDeployment();
  const evmTokenBalance = await getErc20Balance(deployment.token, params.evmAddress);
  const evmUsdcBalance = await getErc20Balance(deployment.usdc, params.evmAddress);
  const solBalance = await getSolBalance(phantomTrader.address);
  const solTokenBalance = await getSolanaTokenBalance(params.solanaAddress, params.solanaMint);

  return {
    evm: {
      token: evmTokenBalance,
      usdc: evmUsdcBalance,
    },
    solana: {
      sol: solBalance,
      token: solTokenBalance,
    },
  };
}

// =============================================================================
// SOLANA DESK/CONSIGNMENT/OFFER ACCOUNT READERS
// =============================================================================

/**
 * Fetch and deserialize Solana Desk account.
 * Throws if desk not found.
 */
export async function getSolanaDesk(deskAddress: string): Promise<SolanaDeskSnapshot> {
  expectNonEmptyString(deskAddress, "desk address");

  const connection = solanaConnection();
  const accountInfo = await connection.getAccountInfo(new PublicKey(deskAddress));

  // FAIL-FAST: Desk account must exist with data
  if (!accountInfo?.data) {
    throw new Error(`Desk account not found: ${deskAddress}`);
  }

  const data = accountInfo.data;

  // Anchor accounts have 8-byte discriminator prefix
  // Desk struct layout (after discriminator):
  // owner: Pubkey (32 bytes)
  // agent: Pubkey (32 bytes)
  // usdc_mint: Pubkey (32 bytes)
  // usdc_decimals: u8 (1 byte)
  // min_usd_amount_8d: u64 (8 bytes)
  // quote_expiry_secs: i64 (8 bytes)
  // max_price_age_secs: i64 (8 bytes)
  // restrict_fulfill: bool (1 byte)
  // approvers: Vec<Pubkey> (4 bytes length + N*32 bytes)
  // next_consignment_id: u64 (8 bytes)
  // next_offer_id: u64 (8 bytes)
  // paused: bool (1 byte)

  let offset = 8; // Skip discriminator

  const owner = new PublicKey(data.slice(offset, offset + 32)).toBase58();
  offset += 32;

  const agent = new PublicKey(data.slice(offset, offset + 32)).toBase58();
  offset += 32;

  // Skip: usdc_mint (32) + usdc_decimals (1) + min_usd_amount_8d (8) + quote_expiry_secs (8) + max_price_age_secs (8) + restrict_fulfill (1)
  offset += 32 + 1 + 8 + 8 + 8 + 1;

  // Read approvers Vec length (4 bytes LE)
  const approversLen = data.readUInt32LE(offset);
  offset += 4 + approversLen * 32; // Skip approvers data

  // next_consignment_id: u64
  const nextConsignmentId = data.readBigUInt64LE(offset);
  offset += 8;

  // next_offer_id: u64
  const nextOfferId = data.readBigUInt64LE(offset);
  offset += 8;

  // paused: bool
  const paused = data[offset] !== 0;

  return {
    owner,
    agent,
    nextConsignmentId,
    nextOfferId,
    paused,
  };
}

/**
 * Derive Consignment PDA
 */
function deriveConsignmentPda(programId: string, deskPubkey: string, consignmentId: bigint): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("consignment"), new PublicKey(deskPubkey).toBuffer(), Buffer.from(consignmentId.toString())],
    new PublicKey(programId),
  );
  return pda;
}

/**
 * Fetch and deserialize Solana Consignment account.
 * Returns null if not found (account may not exist yet).
 */
export async function getSolanaConsignment(
  deskAddress: string,
  consignmentId: bigint,
): Promise<SolanaConsignmentSnapshot | null> {
  const deployment = loadSolanaDeployment();
  const connection = solanaConnection();

  const pda = deriveConsignmentPda(deployment.programId, deskAddress, consignmentId);
  const accountInfo = await connection.getAccountInfo(pda);

  // Consignment may not exist - return null if account not found
  if (!accountInfo?.data) {
    return null;
  }

  const data = accountInfo.data;
  let offset = 8; // Skip discriminator

  // Consignment struct layout:
  // desk: Pubkey (32)
  // id: u64 (8)
  // token_mint: Pubkey (32)
  // consigner: Pubkey (32)
  // total_amount: u64 (8)
  // remaining_amount: u64 (8)
  // is_negotiable: bool (1)
  // ... more fields ...
  // is_active: bool (1)

  const desk = new PublicKey(data.slice(offset, offset + 32)).toBase58();
  offset += 32;

  const id = data.readBigUInt64LE(offset);
  offset += 8;

  const tokenMint = new PublicKey(data.slice(offset, offset + 32)).toBase58();
  offset += 32;

  const consigner = new PublicKey(data.slice(offset, offset + 32)).toBase58();
  offset += 32;

  const totalAmount = data.readBigUInt64LE(offset);
  offset += 8;

  const remainingAmount = data.readBigUInt64LE(offset);
  offset += 8;

  const isNegotiable = data[offset] !== 0;
  offset += 1;

  // Skip: fixed_discount_bps (2) + fixed_lockup_days (4) + min_discount_bps (2) + max_discount_bps (2)
  //       + min_lockup_days (4) + max_lockup_days (4) + min_deal_amount (8) + max_deal_amount (8)
  //       + is_fractionalized (1) + is_private (1) + max_price_volatility_bps (2) + max_time_to_execute_secs (8)
  offset += 2 + 4 + 2 + 2 + 4 + 4 + 8 + 8 + 1 + 1 + 2 + 8;

  const isActive = data[offset] !== 0;

  return {
    desk,
    id,
    tokenMint,
    consigner,
    totalAmount,
    remainingAmount,
    isNegotiable,
    isActive,
  };
}

/**
 * Derive Offer PDA
 */
function deriveOfferPda(programId: string, deskPubkey: string, offerId: bigint): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("offer"), new PublicKey(deskPubkey).toBuffer(), Buffer.from(offerId.toString())],
    new PublicKey(programId),
  );
  return pda;
}

/**
 * Fetch and deserialize Solana Offer account.
 * Returns null if not found.
 */
export async function getSolanaOffer(deskAddress: string, offerId: bigint): Promise<SolanaOfferSnapshot | null> {
  const deployment = loadSolanaDeployment();
  const connection = solanaConnection();

  const pda = deriveOfferPda(deployment.programId, deskAddress, offerId);
  const accountInfo = await connection.getAccountInfo(pda);

  // Offer may not exist - return null if account not found
  if (!accountInfo?.data) {
    return null;
  }

  const data = accountInfo.data;
  let offset = 8; // Skip discriminator

  // Offer struct layout:
  // desk: Pubkey (32)
  // consignment_id: u64 (8)
  // token_mint: Pubkey (32)
  // token_decimals: u8 (1)
  // id: u64 (8)
  // beneficiary: Pubkey (32)
  // token_amount: u64 (8)
  // discount_bps: u16 (2)
  // created_at: i64 (8)
  // unlock_time: i64 (8)
  // price_usd_per_token_8d: u64 (8)
  // max_price_deviation_bps: u16 (2)
  // sol_usd_price_8d: u64 (8)
  // currency: u8 (1)
  // approved: bool (1)
  // paid: bool (1)
  // fulfilled: bool (1)
  // cancelled: bool (1)

  const desk = new PublicKey(data.slice(offset, offset + 32)).toBase58();
  offset += 32;

  const consignmentId = data.readBigUInt64LE(offset);
  offset += 8;

  const tokenMint = new PublicKey(data.slice(offset, offset + 32)).toBase58();
  offset += 32;

  // token_decimals: u8
  offset += 1;

  const id = data.readBigUInt64LE(offset);
  offset += 8;

  const beneficiary = new PublicKey(data.slice(offset, offset + 32)).toBase58();
  offset += 32;

  const tokenAmount = data.readBigUInt64LE(offset);
  offset += 8;

  const discountBps = data.readUInt16LE(offset);
  offset += 2;

  // Skip: created_at (8) + unlock_time (8) + price_usd_per_token_8d (8) + max_price_deviation_bps (2) + sol_usd_price_8d (8) + currency (1)
  offset += 8 + 8 + 8 + 2 + 8 + 1;

  const approved = data[offset] !== 0;
  offset += 1;

  const paid = data[offset] !== 0;
  offset += 1;

  const fulfilled = data[offset] !== 0;
  offset += 1;

  const cancelled = data[offset] !== 0;

  return {
    desk,
    consignmentId,
    tokenMint,
    id,
    beneficiary,
    tokenAmount,
    discountBps,
    approved,
    paid,
    fulfilled,
    cancelled,
  };
}
