/**
 * Zod schemas for database types
 * These schemas match the TypeScript interfaces in src/types/index.ts
 *
 * NOTE: This file is the single source of truth for entity schemas.
 * Other validation files (api-schemas, hook-schemas, service-schemas) should
 * import from here rather than redefining schemas.
 */

import { z } from "zod";
import type { QuoteMemory } from "@/lib/plugin-otc-desk/types";
import type {
  ConsignmentDeal,
  OTCConsignment,
  Token,
  TokenMarketData,
  UserSessionMemory,
} from "../index";
import {
  AddressSchema,
  BigIntStringSchema,
  ChainSchema,
  ConsignmentStatusSchema,
  DealStatusSchema,
  NonEmptyStringSchema,
  NonNegativeNumberSchema,
  OptionalAddressArraySchema,
  PaymentCurrencySchema,
  QuoteStatusSchema,
  TimestampSchema,
  UrlSchema,
} from "./schemas";

//==============================================================================
// BALANCE TOKEN SCHEMAS (used by hooks and API routes)
//==============================================================================

/**
 * EVM token balance structure
 * Single source of truth - used by both API routes and hooks
 */
export const TokenBalanceSchema = z.object({
  contractAddress: AddressSchema,
  symbol: NonEmptyStringSchema,
  name: z.string(),
  decimals: z.number().int().min(0).max(255),
  balance: BigIntStringSchema,
  logoUrl: UrlSchema.optional(),
  priceUsd: NonNegativeNumberSchema.optional(),
  balanceUsd: NonNegativeNumberSchema.optional(),
});
export type TokenBalance = z.infer<typeof TokenBalanceSchema>;

/**
 * Solana token balance structure
 * Single source of truth - used by both API routes and hooks
 */
export const SolanaTokenBalanceSchema = z.object({
  mint: AddressSchema,
  amount: z.number().int().nonnegative(),
  decimals: z.number().int().min(0).max(255),
  symbol: NonEmptyStringSchema,
  name: z.string(),
  logoURI: UrlSchema.nullable(),
  priceUsd: NonNegativeNumberSchema,
  balanceUsd: NonNegativeNumberSchema,
});
export type SolanaTokenBalance = z.infer<typeof SolanaTokenBalanceSchema>;

//==============================================================================
// TOKEN SCHEMA
//==============================================================================

// Token schema with defensive defaults for fields that may be missing in legacy data
// We use preprocess to handle undefined/null values before validation
const TokenSchemaRaw = z.object({
  id: z.string(),
  symbol: z.string(),
  name: z.string(),
  contractAddress: AddressSchema,
  chain: ChainSchema,
  decimals: z.number().int().min(0).max(255),
  // logoUrl can be missing or invalid in legacy data
  // Accept any string and validate, defaulting invalid values to empty string
  logoUrl: z.preprocess((val) => {
    if (val === undefined || val === null || val === "") return "";
    if (typeof val !== "string") return "";
    // Check if it's a valid absolute URL
    try {
      new URL(val);
      return val;
    } catch {
      // Allow relative paths starting with /
      if (val.startsWith("/")) return val;
      // Invalid URL format - default to empty string
      return "";
    }
  }, z.string()),
  // description can be missing in legacy data - default to empty string
  description: z.preprocess((val) => (val === undefined || val === null ? "" : val), z.string()),
  // website can be empty string, undefined, or valid URL - normalize to undefined or valid URL
  website: z.preprocess(
    (val) => (val === "" || val === null ? undefined : val),
    z.string().url().optional(),
  ),
  twitter: z.string().optional(),
  // isActive can be missing in legacy data - default to true
  isActive: z.preprocess((val) => (val === undefined || val === null ? true : val), z.boolean()),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  poolAddress: AddressSchema.optional(),
  solVault: z.string().optional(),
  tokenVault: z.string().optional(),
});

// Export raw schema for extension (used by hook-schemas.ts TokenWithMarketDataSchema)
export const TokenSchemaExtendable = TokenSchemaRaw;

// Cast to typed schema for use where strict Token type is needed
export const TokenSchema: z.ZodType<Token> = TokenSchemaRaw as z.ZodType<Token>;

//==============================================================================
// TOKEN MARKET DATA SCHEMA
//==============================================================================

// NOTE: Market data fields may be null/undefined from external APIs or cache
// We use preprocess to convert null/undefined to 0 for safe consumption
export const TokenMarketDataSchema: z.ZodType<TokenMarketData> = z.object({
  tokenId: z.string(),
  priceUsd: z.preprocess(
    (val) => (val === undefined || val === null ? 0 : val),
    NonNegativeNumberSchema,
  ),
  marketCap: z.preprocess(
    (val) => (val === undefined || val === null ? 0 : val),
    NonNegativeNumberSchema,
  ),
  volume24h: z.preprocess(
    (val) => (val === undefined || val === null ? 0 : val),
    NonNegativeNumberSchema,
  ),
  priceChange24h: z.preprocess((val) => (val === undefined || val === null ? 0 : val), z.number()),
  liquidity: z.preprocess(
    (val) => (val === undefined || val === null ? 0 : val),
    NonNegativeNumberSchema,
  ),
  lastUpdated: z.preprocess(
    (val) => (val === undefined || val === null ? Date.now() : val),
    TimestampSchema,
  ),
}) as z.ZodType<TokenMarketData>;

//==============================================================================
// OTC CONSIGNMENT SCHEMA
//==============================================================================

// Base consignment schema without refinements
// Uses preprocess to provide defaults for legacy data missing optional fields
const OTCConsignmentBaseSchema = z.object({
  id: z.string(),
  tokenId: z.string(),
  consignerAddress: AddressSchema,
  consignerEntityId: z.string(),
  totalAmount: BigIntStringSchema,
  remainingAmount: BigIntStringSchema,
  isNegotiable: z.boolean(),
  fixedDiscountBps: z.number().int().min(0).max(10000).optional(),
  fixedLockupDays: z.number().int().min(0).optional(),
  // Legacy data may be missing these fields - provide sensible defaults
  minDiscountBps: z.preprocess(
    (val) => (val === undefined || val === null ? 0 : val),
    z.number().int().min(0).max(10000),
  ),
  maxDiscountBps: z.preprocess(
    (val) => (val === undefined || val === null ? 10000 : val),
    z.number().int().min(0).max(10000),
  ),
  minLockupDays: z.preprocess(
    (val) => (val === undefined || val === null ? 0 : val),
    z.number().int().min(0),
  ),
  maxLockupDays: z.preprocess(
    (val) => (val === undefined || val === null ? 365 : val),
    z.number().int().min(0),
  ),
  minDealAmount: z.preprocess(
    (val) => (val === undefined || val === null ? "1" : val),
    BigIntStringSchema,
  ),
  maxDealAmount: z.preprocess(
    (val) => (val === undefined || val === null ? "0" : val),
    BigIntStringSchema,
  ),
  isFractionalized: z.boolean(),
  isPrivate: z.boolean(),
  allowedBuyers: OptionalAddressArraySchema,
  maxPriceVolatilityBps: z.preprocess(
    (val) => (val === undefined || val === null ? 1000 : val),
    z.number().int().min(0).max(10000),
  ),
  maxTimeToExecuteSeconds: z.preprocess(
    (val) => (val === undefined || val === null ? 3600 : val),
    z.number().int().min(0),
  ),
  status: ConsignmentStatusSchema,
  contractConsignmentId: z.string().optional(),
  chain: ChainSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  lastDealAt: TimestampSchema.optional(),
});

// Add refinement: non-negotiable consignments MUST have fixed values
export const OTCConsignmentSchema: z.ZodType<OTCConsignment> = OTCConsignmentBaseSchema.refine(
  (data) => {
    if (!data.isNegotiable) {
      return data.fixedDiscountBps !== undefined && data.fixedLockupDays !== undefined;
    }
    return true;
  },
  {
    message: "Non-negotiable consignments require fixedDiscountBps and fixedLockupDays",
  },
)
  .refine(
    (data) => {
      // minDiscountBps <= maxDiscountBps
      return data.minDiscountBps <= data.maxDiscountBps;
    },
    { message: "minDiscountBps cannot exceed maxDiscountBps" },
  )
  .refine(
    (data) => {
      // minLockupDays <= maxLockupDays
      return data.minLockupDays <= data.maxLockupDays;
    },
    { message: "minLockupDays cannot exceed maxLockupDays" },
  ) as z.ZodType<OTCConsignment>;

//==============================================================================
// CONSIGNMENT DEAL SCHEMA
//==============================================================================

export const ConsignmentDealSchema: z.ZodType<ConsignmentDeal> = z.object({
  id: z.string(),
  consignmentId: z.string(),
  quoteId: z.string(),
  tokenId: z.string(),
  buyerAddress: AddressSchema,
  amount: BigIntStringSchema,
  discountBps: z.number().int().min(0).max(10000),
  lockupDays: z.number().int().min(0),
  executedAt: TimestampSchema,
  offerId: z.string().optional(),
  status: DealStatusSchema,
});

//==============================================================================
// USER SESSION MEMORY SCHEMA
//==============================================================================

// Session data can contain string, number, or boolean values
const SessionDataValueSchema = z.union([z.string(), z.number(), z.boolean()]);

export const UserSessionMemorySchema: z.ZodType<UserSessionMemory> = z.object({
  id: z.string(),
  entityId: z.string(),
  walletAddress: AddressSchema,
  chainFamily: z.enum(["evm", "solana"]),
  preferredChain: z.string().optional(),
  lastActiveAt: TimestampSchema,
  sessionData: z.record(z.string(), SessionDataValueSchema).optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

//==============================================================================
// QUOTE MEMORY SCHEMA (from plugin types)
//==============================================================================

// ChainType schema matches the ChainType union in plugin-otc-desk/types.ts
const ChainTypeSchema = z.enum(["evm", "solana", "base", "bsc", "ethereum"]);

// Base quote schema without refinements
const QuoteMemoryBaseSchema = z.object({
  id: z.string(),
  quoteId: z.string(),
  entityId: z.string(),
  beneficiary: AddressSchema,
  tokenAmount: BigIntStringSchema,
  discountBps: z.number().int().min(0).max(10000),
  apr: z.number(),
  lockupMonths: z.number().int().min(0),
  lockupDays: z.number().int().min(0),
  paymentCurrency: PaymentCurrencySchema,
  priceUsdPerToken: NonNegativeNumberSchema,
  totalUsd: NonNegativeNumberSchema,
  discountUsd: NonNegativeNumberSchema,
  discountedUsd: NonNegativeNumberSchema,
  paymentAmount: BigIntStringSchema,
  status: QuoteStatusSchema,
  signature: z.string(),
  createdAt: TimestampSchema,
  executedAt: TimestampSchema,
  rejectedAt: TimestampSchema,
  approvedAt: TimestampSchema,
  offerId: z.string(),
  transactionHash: z.string(),
  blockNumber: z.number().int().nonnegative(),
  rejectionReason: z.string(),
  approvalNote: z.string(),
  // Required fields - quotes always operate on a specific chain/token/consignment
  chain: ChainTypeSchema,
  tokenId: z.string().min(1),
  tokenSymbol: z.string().min(1),
  tokenName: z.string(),
  tokenLogoUrl: UrlSchema,
  consignmentId: z.string(),
  agentCommissionBps: z.number().int().min(0).max(150),
});

// Add refinement: executed quotes MUST have transaction details
export const QuoteMemorySchema: z.ZodType<QuoteMemory> = QuoteMemoryBaseSchema.refine(
  (data) => {
    if (data.status === "executed") {
      return data.offerId !== "" && data.transactionHash !== "" && data.blockNumber > 0;
    }
    return true;
  },
  {
    message: "Executed quotes must have offerId, transactionHash, and blockNumber",
  },
).refine(
  (data) => {
    if (data.status === "rejected") {
      return data.rejectionReason !== "";
    }
    return true;
  },
  { message: "Rejected quotes must have rejectionReason" },
) as z.ZodType<QuoteMemory>;
