/**
 * Zod schemas for service layer function parameters
 * These schemas validate data passed to service methods
 */

import { z } from "zod";
import {
  ChainSchema,
  AddressSchema,
  BigIntStringSchema,
  BpsSchema,
  OptionalAddressArraySchema,
} from "./schemas";
import { UpdateConsignmentRequestSchema } from "./api-schemas";
//==============================================================================
// CONSIGNMENT SERVICE
//==============================================================================

// ConsignmentParams schema - transforms string inputs to bigint outputs
// Output type matches OnChainConsignmentParams interface
export const ConsignmentParamsSchema = z
  .object({
    tokenId: z.string().min(1),
    tokenSymbol: z.string().min(1),
    tokenAddress: AddressSchema,
    amount: BigIntStringSchema.transform((val) => BigInt(val)),
    isNegotiable: z.boolean(),
    fixedDiscountBps: BpsSchema.optional(),
    fixedLockupDays: z.number().int().min(0).optional(),
    minDiscountBps: BpsSchema,
    maxDiscountBps: BpsSchema,
    minLockupDays: z.number().int().min(0),
    maxLockupDays: z.number().int().min(0),
    minDealAmount: BigIntStringSchema.transform((val) => BigInt(val)),
    maxDealAmount: BigIntStringSchema.transform((val) => BigInt(val)),
    isFractionalized: z.boolean(),
    isPrivate: z.boolean(),
    maxPriceVolatilityBps: BpsSchema,
    maxTimeToExecute: z.number().int().min(0),
    gasDeposit: BigIntStringSchema.transform((val) => BigInt(val)),
    selectedPoolAddress: AddressSchema.optional(),
  })
  .refine(
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
        "Fixed consignments must specify fixedDiscountBps and fixedLockupDays",
    },
  )
  .refine(
    (data) => {
      return data.minDealAmount <= data.maxDealAmount;
    },
    {
      message: "minDealAmount cannot exceed maxDealAmount",
    },
  )
  .refine(
    (data) => {
      return data.amount >= data.minDealAmount;
    },
    {
      message: "Total amount must be at least minDealAmount",
    },
  )
  .refine(
    (data) => {
      return data.minDiscountBps <= data.maxDiscountBps;
    },
    {
      message: "minDiscountBps cannot exceed maxDiscountBps",
    },
  )
  .refine(
    (data) => {
      return data.minLockupDays <= data.maxLockupDays;
    },
    {
      message: "minLockupDays cannot exceed maxLockupDays",
    },
  );

// Create consignment input (from API, uses strings)
// Matches ConsignmentParams interface but with optional fields that have defaults
export const CreateConsignmentInputSchema = z
  .object({
    tokenId: z.string().min(1),
    consignerAddress: AddressSchema,
    amount: BigIntStringSchema,
    isNegotiable: z.boolean(),
    fixedDiscountBps: BpsSchema.optional(),
    fixedLockupDays: z.number().int().min(0).optional(),
    minDiscountBps: BpsSchema.optional(),
    maxDiscountBps: BpsSchema.optional(),
    minLockupDays: z.number().int().min(0).optional(),
    maxLockupDays: z.number().int().min(0).optional(),
    minDealAmount: BigIntStringSchema.optional(),
    maxDealAmount: BigIntStringSchema.optional(),
    isFractionalized: z.boolean().optional(),
    isPrivate: z.boolean().optional(),
    allowedBuyers: OptionalAddressArraySchema,
    maxPriceVolatilityBps: BpsSchema.optional(),
    maxTimeToExecuteSeconds: z.number().int().min(0).optional(),
    chain: ChainSchema,
    contractConsignmentId: z.string().optional(),
  })
  .refine(
    (data) => {
      if (data.chain === "solana") {
        return !!data.contractConsignmentId;
      }
      return true;
    },
    {
      message: "Solana consignments require contractConsignmentId",
    },
  );

// Update consignment input (reuses API schema but omits callerAddress)
export const UpdateConsignmentInputSchema = UpdateConsignmentRequestSchema.omit(
  {
    callerAddress: true,
  },
);

// Reserve amount input
export const ReserveAmountInputSchema = z.object({
  consignmentId: z.string().min(1),
  amount: BigIntStringSchema,
});

// Release reservation input
export const ReleaseReservationInputSchema = z.object({
  consignmentId: z.string().min(1),
  amount: BigIntStringSchema,
});

// Record deal input
export const RecordDealInputSchema = z.object({
  consignmentId: z.string().min(1),
  quoteId: z.string().min(1),
  tokenId: z.string().min(1),
  buyerAddress: AddressSchema,
  amount: BigIntStringSchema,
  discountBps: BpsSchema,
  lockupDays: z.number().int().min(0),
});

//==============================================================================
// TOKEN SERVICE
//==============================================================================

// Create token input
export const CreateTokenInputSchema = z.object({
  symbol: z.string().min(1),
  name: z.string(),
  contractAddress: AddressSchema,
  chain: ChainSchema,
  decimals: z.number().int().min(0).max(255),
  logoUrl: z.string().url().or(z.literal("")),
  description: z.string(),
  isActive: z.boolean(),
});

// Update token input
export const UpdateTokenInputSchema = z.object({
  symbol: z.string().min(1).optional(),
  name: z.string().optional(),
  logoUrl: z.string().url().or(z.literal("")).optional(),
  description: z.string().optional(),
  website: z.string().url().optional(),
  twitter: z.string().optional(),
  isActive: z.boolean().optional(),
  poolAddress: AddressSchema.optional(),
  solVault: z.string().optional(),
  tokenVault: z.string().optional(),
});

//==============================================================================
// MARKET DATA SERVICE
//==============================================================================

// Fetch token price input
export const FetchTokenPriceInputSchema = z.object({
  tokenAddress: z.string().min(1),
  chain: ChainSchema,
});

// Fetch market data input
export const FetchMarketDataInputSchema = z.object({
  tokenAddress: z.string().min(1),
  chain: ChainSchema,
});

// Update market data input
export const UpdateMarketDataInputSchema = z.object({
  tokenId: z.string().min(1),
  priceUsd: z.number().nonnegative(),
  marketCap: z.number().nonnegative().optional(),
  volume24h: z.number().nonnegative().optional(),
  priceChange24h: z.number().optional(),
  liquidity: z.number().nonnegative().optional(),
});

//==============================================================================
// PRICE PROTECTION SERVICE
//==============================================================================

// Validate quote price input
export const ValidateQuotePriceInputSchema = z.object({
  tokenId: z.string().min(1),
  tokenAddress: AddressSchema,
  chain: ChainSchema,
  priceAtQuote: z.number().nonnegative(),
  maxDeviationBps: BpsSchema,
});

//==============================================================================
// QUOTE SERVICE
//==============================================================================

// Create quote input
export const CreateQuoteInputSchema = z.object({
  entityId: z.string().min(1),
  beneficiary: AddressSchema,
  tokenAmount: BigIntStringSchema,
  discountBps: BpsSchema,
  apr: z.number(),
  lockupMonths: z.number().int().min(0),
  paymentCurrency: z.enum(["ETH", "USDC", "BNB", "SOL"]),
  totalUsd: z.number().nonnegative(),
  discountUsd: z.number().nonnegative(),
  discountedUsd: z.number().nonnegative(),
  paymentAmount: BigIntStringSchema,
});

// Update quote status input
export const UpdateQuoteStatusInputSchema = z.object({
  quoteId: z.string().min(1),
  status: z.enum(["active", "expired", "executed", "rejected", "approved"]),
  offerId: z.string().optional(),
  transactionHash: z.string().optional(),
  blockNumber: z.number().int().nonnegative().optional(),
  rejectionReason: z.string().optional(),
  approvalNote: z.string().optional(),
});

// Update quote execution input
export const UpdateQuoteExecutionInputSchema = z.object({
  quoteId: z.string().min(1),
  tokenAmount: BigIntStringSchema,
  totalUsd: z.number().nonnegative(),
  discountUsd: z.number().nonnegative(),
  discountedUsd: z.number().nonnegative(),
  paymentCurrency: z.enum(["ETH", "USDC", "BNB", "SOL"]),
  paymentAmount: BigIntStringSchema,
  offerId: z.string(),
  transactionHash: z.string(),
  blockNumber: z.number().int().nonnegative(),
  priceUsdPerToken: z.number().nonnegative().optional(),
  ethUsdPrice: z.number().nonnegative().optional(),
  lockupDays: z.number().int().min(0).optional(),
});

//==============================================================================
// RECONCILIATION SERVICE
//==============================================================================

// Reconcile consignment input
export const ReconcileConsignmentInputSchema = z.object({
  consignmentId: z.string().min(1),
  chain: ChainSchema,
  contractConsignmentId: z.string().optional(),
});

//==============================================================================
// TOKEN REGISTRY SERVICE
//==============================================================================

// Register token input
export const RegisterTokenInputSchema = z.object({
  symbol: z.string().min(1),
  name: z.string().min(1),
  contractAddress: AddressSchema,
  chain: ChainSchema,
  decimals: z.number().int().min(0).max(255),
  logoUrl: z.string().url().optional(),
  description: z.string().optional(),
  website: z.string().url().optional(),
  twitter: z.string().optional(),
  poolAddress: AddressSchema.optional(),
  solVault: AddressSchema.optional(),
  tokenVault: AddressSchema.optional(),
});

//==============================================================================
// OUTPUT SCHEMAS - For validating service method return values
//==============================================================================

// Token output schema (from TokenDB.getToken)
// Handles legacy data that may be missing optional fields
// Uses preprocess to convert undefined/null to defaults before validation
export const TokenOutputSchema = z.object({
  id: z.string().min(1),
  symbol: z.string().min(1),
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
  createdAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
  poolAddress: AddressSchema.optional(),
  solVault: z.string().optional(),
  tokenVault: z.string().optional(),
});

// Token list output schema
export const TokenListOutputSchema = z.array(TokenOutputSchema);

// Market data output schema
// NOTE: Market data fields may be null/undefined from external APIs or cache
// Uses preprocess to convert null/undefined to 0 for safe consumption
export const MarketDataOutputSchema = z.object({
  tokenId: z.string().min(1),
  priceUsd: z.preprocess(
    (val) => (val === undefined || val === null ? 0 : val),
    z.number().nonnegative(),
  ),
  marketCap: z.preprocess(
    (val) => (val === undefined || val === null ? 0 : val),
    z.number().nonnegative(),
  ),
  volume24h: z.preprocess(
    (val) => (val === undefined || val === null ? 0 : val),
    z.number().nonnegative(),
  ),
  priceChange24h: z.preprocess(
    (val) => (val === undefined || val === null ? 0 : val),
    z.number(),
  ),
  liquidity: z.preprocess(
    (val) => (val === undefined || val === null ? 0 : val),
    z.number().nonnegative(),
  ),
  lastUpdated: z.preprocess(
    (val) => (val === undefined || val === null ? Date.now() : val),
    z.number().int().positive(),
  ),
});

// Consignment output base schema
const ConsignmentOutputBaseSchema = z.object({
  id: z.string().min(1),
  tokenId: z.string().min(1),
  consignerAddress: AddressSchema,
  consignerEntityId: z.string().min(1),
  totalAmount: BigIntStringSchema,
  remainingAmount: BigIntStringSchema,
  isNegotiable: z.boolean(),
  fixedDiscountBps: BpsSchema.optional(),
  fixedLockupDays: z.number().int().min(0).optional(),
  minDiscountBps: BpsSchema,
  maxDiscountBps: BpsSchema,
  minLockupDays: z.number().int().min(0),
  maxLockupDays: z.number().int().min(0),
  minDealAmount: BigIntStringSchema,
  maxDealAmount: BigIntStringSchema,
  isFractionalized: z.boolean(),
  isPrivate: z.boolean(),
  allowedBuyers: OptionalAddressArraySchema,
  maxPriceVolatilityBps: BpsSchema,
  maxTimeToExecuteSeconds: z.number().int().min(0),
  status: z.enum(["active", "paused", "depleted", "withdrawn"]),
  contractConsignmentId: z.string().optional(),
  chain: ChainSchema,
  createdAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
  lastDealAt: z.number().int().positive().optional(),
});

// Consignment output schema with refinements
export const ConsignmentOutputSchema = ConsignmentOutputBaseSchema.refine(
  (data) => {
    // Non-negotiable consignments MUST have fixed values
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
);

// Consignment list output schema
export const ConsignmentListOutputSchema = z.array(ConsignmentOutputBaseSchema);

// Consignment deal output schema
export const ConsignmentDealOutputSchema = z.object({
  id: z.string().min(1),
  consignmentId: z.string().min(1),
  quoteId: z.string().min(1),
  tokenId: z.string().min(1),
  buyerAddress: AddressSchema,
  amount: BigIntStringSchema,
  discountBps: BpsSchema,
  lockupDays: z.number().int().min(0),
  executedAt: z.number().int().positive(),
  offerId: z.string().optional(),
  status: z.enum(["pending", "executed", "failed"]),
});

// Price validation result output schema
export const PriceValidationResultSchema = z.object({
  isValid: z.boolean(),
  currentPrice: z.number().nonnegative(),
  priceAtQuote: z.number().nonnegative(),
  deviation: z.number().nonnegative(),
  deviationBps: z.number().int().nonnegative(),
  maxAllowedDeviationBps: z.number().int().nonnegative(),
  reason: z.string().optional(),
});

// Quote output schema
export const QuoteOutputSchema = z.object({
  id: z.string().min(1),
  quoteId: z.string().min(1),
  entityId: z.string().min(1),
  beneficiary: AddressSchema,
  tokenAmount: BigIntStringSchema,
  discountBps: BpsSchema,
  apr: z.number(),
  lockupMonths: z.number().int().min(0),
  lockupDays: z.number().int().min(0),
  paymentCurrency: z.enum(["ETH", "USDC", "BNB", "SOL"]),
  priceUsdPerToken: z.number().nonnegative(),
  totalUsd: z.number().nonnegative(),
  discountUsd: z.number().nonnegative(),
  discountedUsd: z.number().nonnegative(),
  paymentAmount: BigIntStringSchema,
  status: z.enum(["active", "expired", "executed", "rejected", "approved"]),
  signature: z.string(),
  createdAt: z.number().int().positive(),
  executedAt: z.number().int().nonnegative(),
  rejectedAt: z.number().int().nonnegative(),
  approvedAt: z.number().int().nonnegative(),
  offerId: z.string(),
  transactionHash: z.string(),
  blockNumber: z.number().int().nonnegative(),
  rejectionReason: z.string(),
  approvalNote: z.string(),
});

// Reconciliation result output schema
export const ReconciliationResultSchema = z.object({
  updated: z.boolean(),
  oldStatus: z.string(),
  newStatus: z.string(),
});

// Reconciliation summary output schema
export const ReconciliationSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
});

// Health check output schema
export const HealthCheckOutputSchema = z.object({
  blockNumber: z.number().int().nonnegative(),
  contractAddress: z.string().min(1),
});
