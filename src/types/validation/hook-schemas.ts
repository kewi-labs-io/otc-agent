/**
 * Zod schemas for React hooks input/output validation
 * These schemas validate data at hook boundaries
 */

import { z } from "zod";
import {
  ChainSchema,
  AddressSchema,
  BigIntStringSchema,
  BpsSchema,
  TimestampSchema,
  NonNegativeNumberSchema,
  UrlSchema,
} from "./schemas";

//==============================================================================
// CONSIGNMENTS HOOK
//==============================================================================

// Consignments filter input
export const ConsignmentsFiltersSchema = z.object({
  chains: z.array(ChainSchema).optional(),
  negotiableTypes: z.array(z.enum(["negotiable", "fixed"])).optional(),
  tokenId: z.string().min(1).optional(),
  consigner: AddressSchema.optional(),
  requester: AddressSchema.optional(),
});
export type ConsignmentsFilters = z.infer<typeof ConsignmentsFiltersSchema>;

// Consignment from API response
export const ConsignmentResponseItemSchema = z.object({
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
  allowedBuyers: z.array(AddressSchema).optional(),
  maxPriceVolatilityBps: BpsSchema,
  maxTimeToExecuteSeconds: z.number().int().min(0),
  status: z.enum(["active", "paused", "depleted", "withdrawn"]),
  contractConsignmentId: z.string().optional(),
  chain: ChainSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  lastDealAt: TimestampSchema.optional(),
});

// Consignments API response
export const ConsignmentsResponseSchema = z.object({
  success: z.boolean(),
  consignments: z.array(ConsignmentResponseItemSchema),
  error: z.string().optional(),
});
export type ConsignmentsResponse = z.infer<typeof ConsignmentsResponseSchema>;

//==============================================================================
// DEALS HOOK
//==============================================================================

// Deal from API response - required fields for display and execution
export const DealResponseItemSchema = z.object({
  id: z.string().min(1),
  quoteId: z.string().min(1),
  beneficiary: AddressSchema,
  tokenAmount: BigIntStringSchema,
  discountBps: BpsSchema,
  lockupMonths: z.number().int().min(0),
  lockupDays: z.number().int().min(0),
  paymentCurrency: z.enum(["ETH", "USDC", "BNB", "SOL"]),
  totalUsd: NonNegativeNumberSchema,
  discountUsd: NonNegativeNumberSchema,
  discountedUsd: NonNegativeNumberSchema,
  paymentAmount: BigIntStringSchema,
  status: z.enum(["active", "expired", "executed", "rejected", "approved"]),
  executedAt: TimestampSchema,
  offerId: z.string().min(1),
  transactionHash: z.string().min(1),
  chain: ChainSchema,
  tokenId: z.string().min(1),
  tokenSymbol: z.string().min(1),
  tokenName: z.string(),
  tokenLogoUrl: UrlSchema,
});
export type DealResponseItem = z.infer<typeof DealResponseItemSchema>;

// Deals API response
export const DealsResponseSchema = z.object({
  success: z.boolean(),
  deals: z.array(DealResponseItemSchema),
  error: z.string().optional(),
});

//==============================================================================
// TOKEN BATCH HOOK
//==============================================================================

// Token with market data
export const TokenWithMarketDataSchema = z.object({
  id: z.string().min(1),
  symbol: z.string().min(1),
  name: z.string(),
  contractAddress: AddressSchema,
  chain: ChainSchema,
  decimals: z.number().int().min(0).max(255),
  logoUrl: UrlSchema,
  description: z.string(),
  website: z.string().url().optional(),
  twitter: z.string().optional(),
  isActive: z.boolean(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  poolAddress: AddressSchema.optional(),
  solVault: z.string().optional(),
  tokenVault: z.string().optional(),
  // Market data fields (optional)
  priceUsd: NonNegativeNumberSchema.optional(),
  marketCap: NonNegativeNumberSchema.optional(),
  volume24h: NonNegativeNumberSchema.optional(),
  priceChange24h: z.number().optional(),
  liquidity: NonNegativeNumberSchema.optional(),
});

// Token batch API response
export const TokenBatchResponseSchema = z.object({
  success: z.boolean(),
  tokens: z.record(z.string(), TokenWithMarketDataSchema.nullable()),
  error: z.string().optional(),
});

//==============================================================================
// WALLET TOKENS HOOK
//==============================================================================

// EVM balance token
export const EvmBalanceTokenSchema = z.object({
  contractAddress: AddressSchema,
  symbol: z.string().min(1),
  name: z.string(),
  decimals: z.number().int().min(0).max(255),
  balance: BigIntStringSchema,
  logoUrl: UrlSchema.optional(),
  priceUsd: NonNegativeNumberSchema.optional(),
  balanceUsd: NonNegativeNumberSchema.optional(),
});

// Solana balance token - all fields required for consistent display
export const SolanaBalanceTokenSchema = z.object({
  mint: AddressSchema,
  amount: z.number().int().nonnegative(),
  decimals: z.number().int().min(0).max(255),
  symbol: z.string().min(1),
  name: z.string(),
  logoURI: UrlSchema.nullable(),
  priceUsd: NonNegativeNumberSchema,
  balanceUsd: NonNegativeNumberSchema,
});
export type SolanaBalanceToken = z.infer<typeof SolanaBalanceTokenSchema>;

// EVM balances API response
export const EvmBalancesResponseSchema = z.object({
  tokens: z.array(EvmBalanceTokenSchema),
  error: z.string().optional(),
});
export type EvmBalancesResponse = z.infer<typeof EvmBalancesResponseSchema>;

// Solana balances API response
export const SolanaBalancesResponseSchema = z.object({
  tokens: z.array(SolanaBalanceTokenSchema),
  error: z.string().optional(),
});
export type SolanaBalancesResponse = z.infer<
  typeof SolanaBalancesResponseSchema
>;

// Wallet token (unified format)
export const WalletTokenSchema = z.object({
  id: z.string().min(1),
  symbol: z.string().min(1),
  name: z.string(),
  contractAddress: AddressSchema,
  chain: ChainSchema,
  decimals: z.number().int().min(0).max(255),
  logoUrl: UrlSchema,
  description: z.string(),
  isActive: z.boolean(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  balance: BigIntStringSchema,
  balanceUsd: NonNegativeNumberSchema,
  priceUsd: NonNegativeNumberSchema,
});

//==============================================================================
// TOKEN CACHE HOOK
//==============================================================================

// Token ID validation
export const TokenIdSchema = z
  .string()
  .min(1)
  .regex(
    /^token-[a-z]+-/,
    "Token ID must be in format: token-{chain}-{address}",
  );

// Token cache entry
export const TokenCacheEntrySchema = z.object({
  token: TokenWithMarketDataSchema,
  marketData: z
    .object({
      tokenId: z.string().min(1),
      priceUsd: NonNegativeNumberSchema,
      marketCap: NonNegativeNumberSchema,
      volume24h: NonNegativeNumberSchema,
      priceChange24h: z.number(),
      liquidity: NonNegativeNumberSchema,
      lastUpdated: TimestampSchema,
    })
    .nullable(),
  fetchedAt: TimestampSchema,
});

// Token API response
export const TokenResponseSchema = z.object({
  success: z.boolean(),
  token: TokenWithMarketDataSchema.optional(),
  marketData: z
    .object({
      tokenId: z.string().min(1),
      priceUsd: NonNegativeNumberSchema,
      marketCap: NonNegativeNumberSchema,
      volume24h: NonNegativeNumberSchema,
      priceChange24h: z.number(),
      liquidity: NonNegativeNumberSchema,
      lastUpdated: TimestampSchema,
    })
    .optional(),
  error: z.string().optional(),
});

//==============================================================================
// USEOTC HOOK
//==============================================================================

// Create offer from consignment params
export const CreateOfferFromConsignmentParamsSchema = z.object({
  consignmentId: z.bigint(),
  tokenAmountWei: z.bigint(),
  discountBps: BpsSchema,
  paymentCurrency: z.union([z.literal(0), z.literal(1)]),
  lockupSeconds: z.bigint(),
  agentCommissionBps: z.number().int().min(0).max(150),
  chain: ChainSchema.optional(),
  otcOverride: AddressSchema.optional(),
});

// Offer from contract - all fields required as blockchain always returns complete data
export const OfferSchema = z.object({
  consignmentId: z.bigint(),
  tokenId: z.string(), // bytes32 hex string
  beneficiary: AddressSchema,
  tokenAmount: z.bigint(),
  discountBps: z.bigint(),
  createdAt: z.bigint(),
  unlockTime: z.bigint(),
  priceUsdPerToken: z.bigint(), // 8 decimals
  maxPriceDeviation: z.bigint(),
  ethUsdPrice: z.bigint(), // 8 decimals
  currency: z.union([z.literal(0), z.literal(1)]), // 0 = ETH, 1 = USDC
  approved: z.boolean(),
  paid: z.boolean(),
  fulfilled: z.boolean(),
  cancelled: z.boolean(),
  payer: AddressSchema,
  amountPaid: z.bigint(),
  agentCommissionBps: z.number().int().min(0).max(150), // 0 for P2P, 25-150 for negotiated
});
export type Offer = z.infer<typeof OfferSchema>;
