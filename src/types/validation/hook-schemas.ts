/**
 * Zod schemas for React hooks input/output validation
 * These schemas validate data at hook boundaries
 *
 * NOTE: Balance and entity schemas are imported from db-schemas.ts (single source of truth)
 */

import { z } from "zod";
import {
  SolanaTokenBalanceSchema,
  TokenBalanceSchema,
  TokenMarketDataSchema,
  TokenSchemaExtendable,
} from "./db-schemas";
import {
  AddressSchema,
  BigIntStringSchema,
  BpsSchema,
  ChainSchema,
  ConsignmentStatusSchema,
  NonNegativeNumberSchema,
  PaymentCurrencySchema,
  QuoteStatusSchema,
  TimestampSchema,
  UrlSchema,
} from "./schemas";

// Re-export balance schemas for backward compatibility
export { SolanaTokenBalanceSchema, TokenBalanceSchema };
export type { SolanaTokenBalance, TokenBalance } from "./db-schemas";

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
  status: ConsignmentStatusSchema,
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
  paymentCurrency: PaymentCurrencySchema,
  totalUsd: NonNegativeNumberSchema,
  discountUsd: NonNegativeNumberSchema,
  discountedUsd: NonNegativeNumberSchema,
  paymentAmount: BigIntStringSchema,
  status: QuoteStatusSchema,
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

// Token schema extended with optional market data fields
// Base schema (TokenSchemaExtendable) is imported from db-schemas.ts (single source of truth)
export const TokenWithMarketDataSchema = TokenSchemaExtendable.extend({
  // Market data fields (optional - not always present in API responses)
  priceUsd: NonNegativeNumberSchema.optional(),
  marketCap: NonNegativeNumberSchema.optional(),
  volume24h: NonNegativeNumberSchema.optional(),
  priceChange24h: z.number().optional(),
  liquidity: NonNegativeNumberSchema.optional(),
});

// Token batch API response - passthrough to accept any token structure from API
export const TokenBatchResponseSchema = z.object({
  success: z.boolean(),
  tokens: z.record(z.string(), TokenWithMarketDataSchema.nullable()),
  error: z.string().optional(),
});

//==============================================================================
// WALLET TOKENS HOOK
//==============================================================================

// Balance schemas imported from db-schemas.ts (single source of truth)
// Re-exported above for backward compatibility

// Alias for backward compatibility - EvmBalanceTokenSchema is now TokenBalanceSchema
export const EvmBalanceTokenSchema = TokenBalanceSchema;

// EVM balances API response
export const EvmBalancesResponseSchema = z.object({
  tokens: z.array(TokenBalanceSchema),
  error: z.string().optional(),
});
export type EvmBalancesResponse = z.infer<typeof EvmBalancesResponseSchema>;

// Solana balances API response
export const SolanaBalancesResponseSchema = z.object({
  tokens: z.array(SolanaTokenBalanceSchema),
  error: z.string().optional(),
});
export type SolanaBalancesResponse = z.infer<typeof SolanaBalancesResponseSchema>;

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
  .regex(/^token-[a-z]+-/, "Token ID must be in format: token-{chain}-{address}");

// Token cache entry
// Uses TokenMarketDataSchema from db-schemas.ts (single source of truth)
export const TokenCacheEntrySchema = z.object({
  token: TokenWithMarketDataSchema,
  marketData: TokenMarketDataSchema.nullable(),
  fetchedAt: TimestampSchema,
});

// Token API response
// Uses TokenMarketDataSchema from db-schemas.ts (single source of truth)
export const TokenResponseSchema = z.object({
  success: z.boolean(),
  token: TokenWithMarketDataSchema.optional(),
  marketData: TokenMarketDataSchema.optional(),
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
