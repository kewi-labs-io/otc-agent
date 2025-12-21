/**
 * Zod schemas for database types
 * These schemas match the TypeScript interfaces in src/types/index.ts
 */

import { z } from "zod";
import {
  ChainSchema,
  AddressSchema,
  BigIntStringSchema,
  TimestampSchema,
  NonNegativeNumberSchema,
  UrlSchema,
  ConsignmentStatusSchema,
  DealStatusSchema,
  PaymentCurrencySchema,
  QuoteStatusSchema,
  OptionalAddressArraySchema,
} from "./schemas";
import type {
  Token,
  TokenMarketData,
  OTCConsignment,
  ConsignmentDeal,
  UserSessionMemory,
} from "../index";
import type { QuoteMemory } from "@/lib/plugin-otc-desk/types";

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
  description: z.preprocess(
    (val) => (val === undefined || val === null ? "" : val),
    z.string(),
  ),
  website: z.string().url().optional(),
  twitter: z.string().optional(),
  // isActive can be missing in legacy data - default to true
  isActive: z.preprocess(
    (val) => (val === undefined || val === null ? true : val),
    z.boolean(),
  ),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  poolAddress: AddressSchema.optional(),
  solVault: z.string().optional(),
  tokenVault: z.string().optional(),
});

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
  priceChange24h: z.preprocess(
    (val) => (val === undefined || val === null ? 0 : val),
    z.number(),
  ),
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
  minDiscountBps: z.number().int().min(0).max(10000),
  maxDiscountBps: z.number().int().min(0).max(10000),
  minLockupDays: z.number().int().min(0),
  maxLockupDays: z.number().int().min(0),
  minDealAmount: BigIntStringSchema,
  maxDealAmount: BigIntStringSchema,
  isFractionalized: z.boolean(),
  isPrivate: z.boolean(),
  allowedBuyers: OptionalAddressArraySchema,
  maxPriceVolatilityBps: z.number().int().min(0).max(10000),
  maxTimeToExecuteSeconds: z.number().int().min(0),
  status: ConsignmentStatusSchema,
  contractConsignmentId: z.string().optional(),
  chain: ChainSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  lastDealAt: TimestampSchema.optional(),
});

// Add refinement: non-negotiable consignments MUST have fixed values
export const OTCConsignmentSchema: z.ZodType<OTCConsignment> =
  OTCConsignmentBaseSchema.refine(
    (data) => {
      if (!data.isNegotiable) {
        return (
          data.fixedDiscountBps !== undefined &&
          data.fixedLockupDays !== undefined
        );
      }
      return true;
    },
    {
      message:
        "Non-negotiable consignments require fixedDiscountBps and fixedLockupDays",
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
export const QuoteMemorySchema: z.ZodType<QuoteMemory> =
  QuoteMemoryBaseSchema.refine(
    (data) => {
      if (data.status === "executed") {
        return (
          data.offerId !== "" &&
          data.transactionHash !== "" &&
          data.blockNumber > 0
        );
      }
      return true;
    },
    {
      message:
        "Executed quotes must have offerId, transactionHash, and blockNumber",
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
