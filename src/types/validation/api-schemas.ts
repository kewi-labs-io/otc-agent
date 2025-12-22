/**
 * Zod schemas for API request/response validation
 * These schemas validate data at API boundaries
 *
 * NOTE: Balance schemas are imported from db-schemas.ts (single source of truth)
 */

import { z } from "zod";
import {
  OTCConsignmentSchema,
  QuoteMemorySchema,
  SolanaTokenBalanceSchema,
  TokenBalanceSchema,
  TokenMarketDataSchema,
  TokenSchema,
} from "./db-schemas";
import {
  AddressSchema,
  BigIntStringSchema,
  BpsSchema,
  ChainSchema,
  EvmAddressSchema,
  NonEmptyStringSchema,
  NonNegativeNumberSchema,
  OptionalAddressArraySchema,
  PaymentCurrencySchema,
  SolanaAddressSchema,
  UrlSchema,
} from "./schemas";

// Re-export balance schemas for backward compatibility
export { SolanaTokenBalanceSchema, TokenBalanceSchema };
export type { SolanaTokenBalance, TokenBalance } from "./db-schemas";

//==============================================================================
// CONSIGNMENTS API
//==============================================================================

// Helper to coerce string or string[] to array (for URL query params)
const toArray = <T extends z.ZodTypeAny>(schema: T) =>
  z.union([schema, z.array(schema)]).transform((val) => (Array.isArray(val) ? val : [val]));

// GET /api/consignments query parameters
export const GetConsignmentsQuerySchema = z.object({
  tokenId: z.string().optional(),
  // URL params can be single string or array - coerce to array
  chains: toArray(ChainSchema).optional(),
  negotiableTypes: toArray(z.enum(["negotiable", "fixed"])).optional(),
  isFractionalized: z
    .string()
    .transform((val) => val === "true")
    .optional(),
  consigner: AddressSchema.optional(),
  requester: AddressSchema.optional(),
});

// POST /api/consignments request body
export const CreateConsignmentRequestSchema = z
  .object({
    tokenId: NonEmptyStringSchema,
    consignerAddress: AddressSchema,
    amount: z
      .union([BigIntStringSchema, z.number(), z.string()])
      .transform((val) => {
        if (typeof val === "number") {
          if (!Number.isInteger(val)) {
            throw new Error(
              "Amount must be a whole number - decimals are not allowed. Use the smallest unit (e.g., wei for ETH).",
            );
          }
          if (val < 0) {
            throw new Error("Amount must be non-negative");
          }
          return val.toString();
        }
        if (typeof val === "string") {
          // Reject decimal inputs
          if (val.includes(".")) {
            throw new Error(
              "Amount must be a whole number - decimals are not allowed. Use the smallest unit (e.g., wei for ETH).",
            );
          }
          const num = Number(val);
          if (Number.isNaN(num) || !Number.isFinite(num)) {
            throw new Error(`Invalid number: ${val}`);
          }
          if (num < 0) {
            throw new Error("Amount must be non-negative");
          }
          return BigInt(val).toString();
        }
        return val;
      })
      .refine(
        (val) => {
          const num = BigInt(val);
          return num > 0n;
        },
        { message: "Amount must be a positive integer" },
      ),
    isNegotiable: z.boolean(),
    fixedDiscountBps: BpsSchema.optional(),
    fixedLockupDays: z.number().int().min(0).optional(),
    minDiscountBps: BpsSchema.optional(),
    maxDiscountBps: BpsSchema.optional(),
    minLockupDays: z.number().int().min(0).optional(),
    maxLockupDays: z.number().int().min(0).optional(),
    minDealAmount: z
      .union([BigIntStringSchema, z.number(), z.string()])
      .optional()
      .transform((val) => {
        if (val === undefined) return undefined;
        if (typeof val === "number") {
          if (!Number.isInteger(val)) {
            throw new Error(
              "minDealAmount must be a whole number - decimals are not allowed. Use the smallest unit (e.g., wei for ETH).",
            );
          }
          if (val < 0) {
            throw new Error("minDealAmount must be non-negative");
          }
          return val.toString();
        }
        if (typeof val === "string") {
          // Reject decimal inputs
          if (val.includes(".")) {
            throw new Error(
              "minDealAmount must be a whole number - decimals are not allowed. Use the smallest unit (e.g., wei for ETH).",
            );
          }
          const num = Number(val);
          if (Number.isNaN(num) || !Number.isFinite(num)) {
            throw new Error(`Invalid number: ${val}`);
          }
          if (num < 0) {
            throw new Error("minDealAmount must be non-negative");
          }
          return BigInt(val).toString();
        }
        return val;
      }),
    maxDealAmount: z
      .union([BigIntStringSchema, z.number(), z.string()])
      .optional()
      .transform((val) => {
        if (val === undefined) return undefined;
        if (typeof val === "number") {
          if (!Number.isInteger(val)) {
            throw new Error(
              "maxDealAmount must be a whole number - decimals are not allowed. Use the smallest unit (e.g., wei for ETH).",
            );
          }
          if (val < 0) {
            throw new Error("maxDealAmount must be non-negative");
          }
          return val.toString();
        }
        if (typeof val === "string") {
          // Reject decimal inputs
          if (val.includes(".")) {
            throw new Error(
              "maxDealAmount must be a whole number - decimals are not allowed. Use the smallest unit (e.g., wei for ETH).",
            );
          }
          const num = Number(val);
          if (Number.isNaN(num) || !Number.isFinite(num)) {
            throw new Error(`Invalid number: ${val}`);
          }
          if (num < 0) {
            throw new Error("maxDealAmount must be non-negative");
          }
          return BigInt(val).toString();
        }
        return val;
      }),
    isFractionalized: z.boolean().optional(),
    isPrivate: z.boolean().optional(),
    allowedBuyers: OptionalAddressArraySchema,
    maxPriceVolatilityBps: BpsSchema.optional(),
    maxTimeToExecuteSeconds: z.number().int().min(0).optional(),
    chain: ChainSchema,
    contractConsignmentId: z.string().optional(),
    tokenSymbol: NonEmptyStringSchema.optional(),
    tokenName: z.string().optional(),
    tokenDecimals: z.number().int().min(0).max(255).optional(),
    tokenLogoUrl: UrlSchema.optional(),
    tokenAddress: AddressSchema.optional(),
  })
  .refine(
    (data) => {
      if (data.chain === "solana") {
        return !!data.contractConsignmentId;
      }
      return true;
    },
    {
      message: "Solana consignments require contractConsignmentId (on-chain pubkey)",
    },
  )
  .refine(
    (data) => {
      return !!(data.tokenSymbol && data.tokenAddress);
    },
    {
      message: "Token metadata (tokenSymbol, tokenAddress) required",
    },
  );

// PUT /api/consignments/[id] request body
export const UpdateConsignmentRequestSchema = z.object({
  callerAddress: AddressSchema,
  isNegotiable: z.boolean().optional(),
  fixedDiscountBps: BpsSchema.optional(),
  fixedLockupDays: z.number().int().min(0).optional(),
  minDiscountBps: BpsSchema.optional(),
  maxDiscountBps: BpsSchema.optional(),
  minLockupDays: z.number().int().min(0).optional(),
  maxLockupDays: z.number().int().min(0).optional(),
  isPrivate: z.boolean().optional(),
  allowedBuyers: OptionalAddressArraySchema,
  maxPriceVolatilityBps: BpsSchema.optional(),
  maxTimeToExecuteSeconds: z.number().int().min(0).optional(),
});

// GET /api/consignments/[id] route parameters
export const GetConsignmentByIdParamsSchema = z.object({
  id: NonEmptyStringSchema,
});

// GET /api/consignments/[id] query parameters
export const GetConsignmentByIdQuerySchema = z.object({
  callerAddress: AddressSchema.optional(),
});

// DELETE /api/consignments/[id] query parameters
// Note: callerAddress can come from query param or header
export const DeleteConsignmentQuerySchema = z.object({
  callerAddress: AddressSchema.optional(),
});

//==============================================================================
// DEAL COMPLETION API
//==============================================================================

// POST /api/deal-completion request body
export const DealCompletionRequestSchema = z
  .object({
    quoteId: NonEmptyStringSchema,
    action: z.enum(["complete", "share"]),
    tokenId: z.string().optional(),
    consignmentId: z.string().optional(),
    tokenAmount: BigIntStringSchema.optional(),
    priceAtQuote: NonNegativeNumberSchema.optional(),
    maxPriceDeviationBps: BpsSchema.optional(),
  })
  .refine(
    (data) => {
      if (data.action === "complete") {
        return !!(data.consignmentId && data.tokenId);
      }
      return true;
    },
    {
      message: "consignmentId and tokenId required for complete action",
    },
  );

//==============================================================================
// OTC APPROVE API
//==============================================================================

// POST /api/otc/approve request body
export const ApproveOfferRequestSchema = z.object({
  offerId: z.union([z.string(), z.number(), z.string().transform(Number)]),
  chain: ChainSchema.optional(),
  offerAddress: AddressSchema.optional(),
  consignmentAddress: AddressSchema.optional(),
});

//==============================================================================
// SOLANA CLAIM API
//==============================================================================

// POST /api/solana/claim request body
export const SolanaClaimRequestSchema = z.object({
  offerAddress: SolanaAddressSchema,
  beneficiary: SolanaAddressSchema,
});

//==============================================================================
// SOLANA UPDATE PRICE API
//==============================================================================

// POST /api/solana/update-price request body
export const SolanaUpdatePriceRequestSchema = z.object({
  tokenMint: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Invalid Solana address format"),
  forceUpdate: z.boolean().optional(),
});

//==============================================================================
// SOLANA WITHDRAW CONSIGNMENT API
//==============================================================================

// POST /api/solana/withdraw-consignment request body
export const SolanaWithdrawConsignmentRequestSchema = z.object({
  consignmentAddress: AddressSchema,
  consignerAddress: AddressSchema,
});

// POST /api/solana/withdraw-consignment request body (with signed transaction)
export const SolanaWithdrawConsignmentRequestWithSignedTxSchema =
  SolanaWithdrawConsignmentRequestSchema.extend({
    signedTransaction: NonEmptyStringSchema,
  });

//==============================================================================
// TOKEN PRICES API
//==============================================================================

// GET /api/token-prices query parameters
// Both chain and addresses are required for a valid price lookup
// addresses transforms comma-separated string to array, defaulting empty string to empty array
export const GetTokenPricesQuerySchema = z.object({
  chain: ChainSchema,
  addresses: z.preprocess(
    (val) => (val === undefined || val === null ? "" : val),
    z.string().transform((val) => val.split(",").filter(Boolean)),
  ),
});

//==============================================================================
// TOKENS API
//==============================================================================

// GET /api/tokens query parameters
export const GetTokensQuerySchema = z.object({
  chain: ChainSchema.optional(),
  symbol: z.string().optional(),
  address: AddressSchema.optional(),
  minMarketCap: z.string().optional(),
  maxMarketCap: z.string().optional(),
  isActive: z
    .string()
    .transform((val) => val === "true")
    .optional(),
});

// POST /api/tokens request body
export const CreateTokenRequestSchema = z.object({
  symbol: NonEmptyStringSchema,
  name: z.string(),
  contractAddress: AddressSchema,
  chain: ChainSchema,
  decimals: z.number().int().min(0).max(255),
  logoUrl: UrlSchema.optional(),
  description: z.string().optional(),
});

// GET /api/tokens/[tokenId] route parameters
export const GetTokenByIdParamsSchema = z.object({
  tokenId: NonEmptyStringSchema,
});

// GET /api/tokens/by-symbol query parameters
export const GetTokenBySymbolQuerySchema = z.object({
  symbol: NonEmptyStringSchema,
  chain: ChainSchema.optional(),
});

// GET /api/tokens/batch query parameters
export const GetTokenBatchQuerySchema = z.object({
  ids: z
    .string()
    .default("")
    .transform((val) => (val ? val.split(",").filter(Boolean) : [])),
});

// GET /api/tokens/addresses query parameters
export const GetTokenAddressesQuerySchema = z.object({
  chain: ChainSchema.optional(),
});

// GET /api/tokens/decimals query parameters
export const GetTokenDecimalsQuerySchema = z
  .object({
    address: NonEmptyStringSchema,
    chain: ChainSchema.optional().default("solana"),
  })
  .refine(
    (data) => {
      if (data.chain === "solana") {
        return SolanaAddressSchema.safeParse(data.address).success;
      }
      return EvmAddressSchema.safeParse(data.address).success;
    },
    {
      message: "Address format does not match chain type",
    },
  );

// POST /api/tokens/sync request body
export const TokenSyncRequestSchema = z.object({
  chain: ChainSchema,
  transactionHash: NonEmptyStringSchema,
  blockNumber: z.string().optional(),
});

//==============================================================================
// QUOTE API
//==============================================================================

// GET /api/quote/latest query parameters
export const GetLatestQuoteQuerySchema = z.object({
  entityId: z.string().min(1),
  tokenId: z.string().min(1),
});

// POST /api/quote/latest request body
export const GetLatestQuoteRequestSchema = z.object({
  quoteId: z.string().min(1),
  beneficiary: AddressSchema.optional(),
  entityId: z.string().optional(),
  tokenAmount: BigIntStringSchema.optional(),
  paymentCurrency: PaymentCurrencySchema.optional(),
  totalUsd: z.number().nonnegative().optional(),
  discountUsd: z.number().nonnegative().optional(),
  discountedUsd: z.number().nonnegative().optional(),
  paymentAmount: BigIntStringSchema.optional(),
});

// GET /api/quote/by-offer/[offerId] route parameters
export const GetQuoteByOfferParamsSchema = z.object({
  offerId: z.union([z.string(), z.number()]),
});

// GET /api/quote/executed/[id] route parameters
export const GetExecutedQuoteParamsSchema = z.object({
  id: NonEmptyStringSchema,
});

//==============================================================================
// MARKET DATA API
//==============================================================================

// GET /api/market-data/[tokenId] route parameters
export const GetMarketDataParamsSchema = z.object({
  tokenId: NonEmptyStringSchema,
});

//==============================================================================
// EVM BALANCES API
//==============================================================================

// GET /api/evm-balances query parameters
export const GetEvmBalancesQuerySchema = z.object({
  address: AddressSchema,
  chain: ChainSchema,
});

//==============================================================================
// SOLANA BALANCES API
//==============================================================================

// GET /api/solana-balances query parameters
export const GetSolanaBalancesQuerySchema = z.object({
  address: AddressSchema,
});

//==============================================================================
// TOKEN LOOKUP API
//==============================================================================

// GET /api/token-lookup query parameters
// chain is optional - will be auto-detected from address format
export const TokenLookupQuerySchema = z.object({
  chain: ChainSchema.optional(),
  address: AddressSchema,
});

//==============================================================================
// TOKEN POOL CHECK API
//==============================================================================

// GET /api/token-pool-check query parameters
export const TokenPoolCheckQuerySchema = z.object({
  chain: ChainSchema,
  tokenAddress: AddressSchema,
});

//==============================================================================
// NATIVE PRICES API
//==============================================================================

// GET /api/native-prices query parameters
export const GetNativePricesQuerySchema = z.object({
  chains: z
    .string()
    .transform((val) => val.split(",").filter(Boolean))
    .pipe(z.array(ChainSchema)),
});

//==============================================================================
// ROOMS API
//==============================================================================

// POST /api/rooms request body
export const CreateRoomRequestSchema = z.object({
  entityId: z.string().optional(),
  walletAddress: AddressSchema.optional(),
});

// GET /api/rooms/[roomId]/messages query parameters
export const GetRoomMessagesQuerySchema = z.object({
  limit: z.string().transform(Number).pipe(z.number().int().positive()).optional(),
  before: z.string().optional(),
});

// GET /api/rooms/[roomId] route parameters
export const GetRoomParamsSchema = z.object({
  roomId: NonEmptyStringSchema,
});

//==============================================================================
// RPC PROXY API
//==============================================================================

// JSON-RPC primitive value schema (recursive type for nested structures)
// JSON values can be: string, number, boolean, null, object, or array
const JsonPrimitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

// For RPC params, we accept primitives, arrays of primitives, or objects with primitive values
// This covers 99% of actual RPC calls without using z.unknown()
const RpcParamValueSchema: z.ZodType<
  string | number | boolean | null | Record<string, string | number | boolean | null>
> = z.union([JsonPrimitiveSchema, z.record(z.string(), JsonPrimitiveSchema)]);

// POST /api/rpc/base, /api/rpc/ethereum, /api/rpc/solana request body
export const RpcRequestSchema = z.object({
  method: z.string(),
  params: z.array(RpcParamValueSchema).optional(),
  id: z.union([z.string(), z.number()]).optional(),
  jsonrpc: z.literal("2.0").optional(),
});

//==============================================================================
// NOTIFICATIONS API
//==============================================================================

// POST /api/notifications/send request body (Farcaster via Neynar)
export const SendNotificationRequestSchema = z.object({
  fid: z.union([z.number().int().positive(), z.string().min(1)]),
  title: NonEmptyStringSchema,
  body: NonEmptyStringSchema,
});

//==============================================================================
// TOKENS API
//==============================================================================

// PATCH /api/tokens request body
export const UpdateTokenRequestSchema = z.object({
  tokenId: NonEmptyStringSchema,
  updates: z.object({
    name: z.string().optional(),
    symbol: z.string().optional(),
    logoUrl: UrlSchema.or(z.literal("")).optional(),
    description: z.string().optional(),
    isActive: z.boolean().optional(),
  }),
});

//==============================================================================
// COMMON RESPONSE SCHEMAS
//==============================================================================

// Success response wrapper
export const SuccessResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.literal(true),
    data: dataSchema,
  });

// Error detail item schema - structured error information
const ErrorDetailItemSchema = z.object({
  path: z.string().optional(),
  message: z.string(),
  code: z.string().optional(),
  expected: z.string().optional(),
  received: z.string().optional(),
});

// Error response wrapper
// Details can be array of strings or structured error objects
export const ErrorResponseSchema = z.object({
  success: z.literal(false).optional(),
  error: z.string(),
  details: z.array(z.union([z.string(), ErrorDetailItemSchema])).optional(),
});

//==============================================================================
// API RESPONSE SCHEMAS
//==============================================================================

// Balance schemas (TokenBalanceSchema, SolanaTokenBalanceSchema) are imported
// from db-schemas.ts and re-exported above for backward compatibility

// EVM balances response
export const EvmBalancesResponseSchema = z.object({
  tokens: z.array(TokenBalanceSchema),
  error: z.string().optional(),
});

// Solana balances response
export const SolanaBalancesResponseSchema = z.object({
  tokens: z.array(SolanaTokenBalanceSchema),
  source: z.enum(["codex", "helius", "local"]).optional(),
});

// Token prices response
export const TokenPricesResponseSchema = z.object({
  prices: z.record(z.string(), z.number().nonnegative()),
});

// Native prices response
export const NativePricesResponseSchema = z.object({
  prices: z.record(z.string(), z.number().nonnegative()),
});

// Attachment schema for message attachments
const MessageAttachmentSchema = z.object({
  type: z.enum(["image", "file", "link", "quote"]).optional(),
  url: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  mimeType: z.string().optional(),
  size: z.number().int().nonnegative().optional(),
});

// Send message request body
export const SendMessageRequestSchema = z.object({
  entityId: NonEmptyStringSchema,
  text: NonEmptyStringSchema,
  attachments: z.array(MessageAttachmentSchema).optional().default([]),
});

// Message content schema - can be plain text or structured with action
const MessageContentSchema = z.union([
  z.string(),
  z.object({
    text: z.string(),
    action: z.string().optional(),
    type: z.string().optional(),
    xml: z.string().optional(),
    quote: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  }),
]);

// Room messages response
export const RoomMessagesResponseSchema = z.object({
  success: z.literal(true),
  messages: z.array(
    z.object({
      id: z.string(),
      entityId: z.string().optional(),
      agentId: z.string().optional(),
      content: MessageContentSchema,
      createdAt: z.number().int().nonnegative(),
      isAgent: z.boolean(),
    }),
  ),
  hasMore: z.boolean(),
  lastTimestamp: z.number().int().nonnegative(),
});

// Send message response
export const SendMessageResponseSchema = z.object({
  success: z.literal(true),
  message: z.object({
    id: z.string(),
    entityId: z.string(),
    agentId: z.string(),
    content: MessageContentSchema,
    createdAt: z.number().int().nonnegative().optional(),
    roomId: z.string(),
  }),
  pollForResponse: z.boolean(),
  pollDuration: z.number().int().positive(),
  pollInterval: z.number().int().positive(),
});

// Tokens response
export const TokensResponseSchema = z.object({
  success: z.literal(true),
  tokens: z.array(TokenSchema),
});

// Token by symbol response - discriminated union
export const TokenBySymbolResponseSchema = z.discriminatedUnion("success", [
  z.object({
    success: z.literal(true),
    token: TokenSchema,
    marketData: TokenMarketDataSchema.nullable(),
  }),
  z.object({
    success: z.literal(false),
    error: z.string(),
  }),
]);

// Token by ID response - discriminated union
export const TokenByIdResponseSchema = z.discriminatedUnion("success", [
  z.object({
    success: z.literal(true),
    token: TokenSchema,
    marketData: TokenMarketDataSchema.nullable(),
    consignments: z.array(OTCConsignmentSchema),
  }),
  z.object({
    success: z.literal(false),
    error: z.string(),
  }),
]);

// Consignments response
export const ConsignmentsResponseSchema = z.object({
  success: z.literal(true),
  consignments: z.array(OTCConsignmentSchema),
});

// Consignment by ID response - discriminated union
export const ConsignmentByIdResponseSchema = z.discriminatedUnion("success", [
  z.object({
    success: z.literal(true),
    consignment: OTCConsignmentSchema,
  }),
  z.object({
    success: z.literal(false),
    error: z.string(),
  }),
]);

// Create consignment response - discriminated union
export const CreateConsignmentResponseSchema = z.discriminatedUnion("success", [
  z.object({
    success: z.literal(true),
    consignment: OTCConsignmentSchema,
  }),
  z.object({
    success: z.literal(false),
    error: z.string(),
  }),
]);

// Update consignment response - discriminated union
export const UpdateConsignmentResponseSchema = z.discriminatedUnion("success", [
  z.object({
    success: z.literal(true),
    consignment: OTCConsignmentSchema,
  }),
  z.object({
    success: z.literal(false),
    error: z.string(),
  }),
]);

// Delete consignment response - discriminated union
export const DeleteConsignmentResponseSchema = z.discriminatedUnion("success", [
  z.object({
    success: z.literal(true),
    message: z.string(),
  }),
  z.object({
    success: z.literal(false),
    error: z.string(),
  }),
]);

// Quote response - discriminated union
export const QuoteResponseSchema = z.discriminatedUnion("success", [
  z.object({
    success: z.literal(true),
    quote: QuoteMemorySchema.nullable(),
  }),
  z.object({
    success: z.literal(false),
    error: z.string(),
  }),
]);

// Market data response - discriminated union
export const MarketDataResponseSchema = z.discriminatedUnion("success", [
  z.object({
    success: z.literal(true),
    marketData: TokenMarketDataSchema.nullable(),
  }),
  z.object({
    success: z.literal(false),
    error: z.string(),
  }),
]);

// Token decimals response - discriminated union
export const TokenDecimalsResponseSchema = z.discriminatedUnion("success", [
  z.object({
    success: z.literal(true),
    decimals: z.number().int().min(0).max(255),
    source: z.enum(["database", "chain"]),
  }),
  z.object({
    success: z.literal(false),
    error: z.string(),
  }),
]);

// Token lookup token schema
const TokenLookupDataSchema = z.object({
  address: z.string(),
  symbol: z.string(),
  name: z.string(),
  decimals: z.number().int().min(0).max(255),
  logoUrl: z.string().nullable(),
  chain: z.string(),
  priceUsd: z.number().nullable(),
});

// Token lookup response - discriminated union
export const TokenLookupResponseSchema = z.discriminatedUnion("success", [
  z.object({
    success: z.literal(true),
    token: TokenLookupDataSchema,
  }),
  z.object({
    success: z.literal(false),
    error: z.string(),
  }),
]);

// Pool info schema
const PoolInfoSchema = z.object({
  address: z.string(),
  protocol: z.string(),
  tvlUsd: z.number().nonnegative(),
  priceUsd: z.number().nonnegative(),
  baseToken: z.string(),
});

// Token pool check response - discriminated union
export const TokenPoolCheckResponseSchema = z.discriminatedUnion("success", [
  z.object({
    success: z.literal(true),
    tokenAddress: AddressSchema,
    chain: ChainSchema,
    isRegistered: z.boolean(),
    hasPool: z.boolean(),
    warning: z.string().optional(),
    pool: PoolInfoSchema.optional(),
    allPools: z.array(PoolInfoSchema).optional(),
    registrationFee: z.string().optional(),
    registrationFeeEth: z.string().optional(),
  }),
  z.object({
    success: z.literal(false),
    tokenAddress: AddressSchema,
    chain: ChainSchema,
    error: z.string(),
  }),
]);

// Approve offer response - discriminated union
export const ApproveOfferResponseSchema = z.discriminatedUnion("success", [
  z.object({
    success: z.literal(true),
    approved: z.boolean(),
    txHash: z.string().optional(),
    approvalTx: z.string().optional(),
    fulfillTx: z.string().optional(),
    offerId: z.string(),
    autoFulfilled: z.boolean().optional(),
    alreadyApproved: z.boolean().optional(),
    message: z.string().optional(),
    chain: z.string(),
    offerAddress: z.string().optional(),
  }),
  z.object({
    success: z.literal(false),
    error: z.string(),
    offerId: z.string().optional(),
    chain: z.string().optional(),
  }),
]);

// Solana claim response - discriminated union
export const SolanaClaimResponseSchema = z.discriminatedUnion("success", [
  z.object({
    success: z.literal(true),
    tx: z.string().optional(),
    offerAddress: z.string(),
    beneficiary: z.string(),
    alreadyClaimed: z.boolean().optional(),
    scheduled: z.boolean().optional(),
    message: z.string().optional(),
    unlockTime: z.number().optional(),
    secondsRemaining: z.number().optional(),
  }),
  z.object({
    success: z.literal(false),
    error: z.string(),
    offerAddress: z.string().optional(),
    unlockTime: z.number().optional(),
    secondsRemaining: z.number().optional(),
  }),
]);

// Solana withdraw consignment response - discriminated union
export const SolanaWithdrawConsignmentResponseSchema = z.discriminatedUnion("success", [
  z.object({
    success: z.literal(true),
    signature: z.string(),
  }),
  z.object({
    success: z.literal(false),
    error: z.string(),
  }),
]);

// Solana update price response - discriminated union
export const SolanaUpdatePriceResponseSchema = z.discriminatedUnion("success", [
  z.object({
    success: z.literal(true),
    updated: z.boolean(),
    reason: z.string().optional(),
    price: z.number().nonnegative(),
    oldPrice: z.number().nonnegative().optional(),
    newPrice: z.number().nonnegative().optional(),
    priceAge: z.number().optional(),
    maxAge: z.number().optional(),
    method: z.enum(["pumpswap", "manual", "manual_fallback"]).optional(),
    pool: z.string().optional(),
    transaction: z.string().optional(),
    stale: z.boolean().optional(),
    updatedAt: z.string().optional(),
    isStale: z.boolean().optional(),
  }),
  z.object({
    success: z.literal(false),
    error: z.string(),
  }),
]);

// Share data schema
const ShareDataSchema = z.object({
  url: z.string(),
  text: z.string(),
  imageUrl: z.string().optional(),
});

// Deal completion response - discriminated union
export const DealCompletionResponseSchema = z.discriminatedUnion("success", [
  z.object({
    success: z.literal(true),
    quoteId: z.string(),
    message: z.string().optional(),
    shareData: ShareDataSchema.optional(),
  }),
  z.object({
    success: z.literal(false),
    error: z.string(),
  }),
]);

// Quote by offer response - discriminated union
export const QuoteByOfferResponseSchema = z.discriminatedUnion("success", [
  z.object({
    success: z.literal(true),
    quote: QuoteMemorySchema,
  }),
  z.object({
    success: z.literal(false),
    error: z.string(),
  }),
]);

// Executed quote data schema
const ExecutedQuoteDataSchema = z.object({
  quoteId: z.string(),
  entityId: z.string(),
  beneficiary: z.string(),
  status: z.string(),
  offerId: z.string(),
  tokenAmount: z.string(),
  lockupMonths: z.number(),
  discountBps: z.number(),
  totalUsd: z.number(),
  discountUsd: z.number(),
  discountedUsd: z.number(),
  paymentAmount: z.string(),
  paymentCurrency: z.string(),
  transactionHash: z.string(),
  blockNumber: z.number(),
  chain: z.string(),
});

// Executed quote response - discriminated union
export const ExecutedQuoteResponseSchema = z.discriminatedUnion("success", [
  z.object({
    success: z.literal(true),
    quote: ExecutedQuoteDataSchema,
  }),
  z.object({
    success: z.literal(false),
    error: z.string(),
  }),
]);

// Room object schema (matches @elizaos/core Room type)
const RoomSchema = z.object({
  id: z.string(),
  source: z.enum(["web", "discord", "telegram", "api"]).optional(),
  type: z.enum(["dm", "channel", "group"]).optional(),
  channelId: z.string().nullable(),
  serverId: z.string().nullable(),
  worldId: z.string().nullable(),
  agentId: z.string(),
  name: z.string().optional(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

// Rooms response - discriminated union
export const RoomsResponseSchema = z.discriminatedUnion("success", [
  z.object({
    success: z.literal(true),
    rooms: z.array(RoomSchema).optional(),
    roomId: z.string().optional(),
    createdAt: z.number().optional(),
  }),
  z.object({
    success: z.literal(false),
    error: z.string(),
  }),
]);

// Notification delivery schema - strict shape
const NotificationDeliverySchema = z.object({
  recipient: z.string(),
  channel: z.enum(["email", "sms", "push", "webhook"]).optional(),
  status: z.enum(["sent", "delivered", "failed", "pending"]).optional(),
  error: z.string().optional(),
  timestamp: z.number().optional(),
  messageId: z.string().optional(),
});

// Notification response
export const NotificationResponseSchema = z.object({
  state: z.enum(["success", "partial", "failed"]),
  simulated: z.boolean().optional(),
  deliveries: z.array(NotificationDeliverySchema).optional(),
  error: z.string().optional(),
});

// Token batch response - discriminated union
export const TokenBatchResponseSchema = z.discriminatedUnion("success", [
  z.object({
    success: z.literal(true),
    tokens: z.record(z.string(), TokenSchema.nullable()),
  }),
  z.object({
    success: z.literal(false),
    error: z.string(),
  }),
]);

// Token addresses response - always succeeds with array
export const TokenAddressesResponseSchema = z.object({
  success: z.literal(true),
  addresses: z.array(
    z.object({
      address: z.string(),
      chain: ChainSchema,
    }),
  ),
});

// Create token response - discriminated union
export const CreateTokenResponseSchema = z.discriminatedUnion("success", [
  z.object({
    success: z.literal(true),
    token: TokenSchema,
  }),
  z.object({
    success: z.literal(false),
    error: z.string(),
  }),
]);

// Update token response - discriminated union
export const UpdateTokenResponseSchema = z.discriminatedUnion("success", [
  z.object({
    success: z.literal(true),
    token: TokenSchema,
  }),
  z.object({
    success: z.literal(false),
    error: z.string(),
  }),
]);

// Delete token response - discriminated union
export const DeleteTokenResponseSchema = z.discriminatedUnion("success", [
  z.object({
    success: z.literal(true),
    message: z.string(),
    deletedTokens: z.array(z.string()).optional(),
  }),
  z.object({
    success: z.literal(false),
    error: z.string(),
  }),
]);

// Cache image response - always returns cachedUrl or throws
export const CacheImageResponseSchema = z.object({
  cachedUrl: z.string(),
});

// Token sync data schema
const SyncedTokenDataSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  name: z.string(),
  mint: z.string(),
});

// Token sync response - discriminated union
export const TokenSyncResponseSchema = z.discriminatedUnion("success", [
  z.object({
    success: z.literal(true),
    processed: z.number().optional(),
    tokens: z.array(z.string()).optional(),
    token: SyncedTokenDataSchema.optional(),
    message: z.string().optional(),
  }),
  z.object({
    success: z.literal(false),
    error: z.string(),
  }),
]);

// RPC result value - can be primitive, array, or object (JSON-RPC standard)
// Using a recursive lazy type to handle nested structures
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

// RPC proxy response (JSON-RPC 2.0 compliant)
export const RpcProxyResponseSchema = z.object({
  jsonrpc: z.string().optional(),
  id: z.union([z.number(), z.string()]).optional(),
  result: JsonValueSchema.optional(),
  error: z
    .object({
      code: z.number(),
      message: z.string(),
      data: JsonValueSchema.optional(),
    })
    .optional(),
});

// RPC proxy error response
export const RpcProxyErrorResponseSchema = z.object({
  error: z.string(),
  details: z.string().optional(),
});

// Clear tokens response - discriminated union
export const ClearTokensResponseSchema = z.discriminatedUnion("success", [
  z.object({
    success: z.literal(true),
    message: z.string(),
    clearedTokens: z.array(z.string()).optional(),
  }),
  z.object({
    success: z.literal(false),
    error: z.string(),
  }),
]);

// Failed offer schema for cron jobs
const FailedOfferSchema = z.object({
  id: z.string(),
  error: z.string(),
});

// Cron check matured OTC response - discriminated union
export const CronCheckMaturedOtcResponseSchema = z.discriminatedUnion("success", [
  z.object({
    success: z.literal(true),
    timestamp: z.string(),
    maturedOffers: z.array(z.string()),
    claimedOffers: z.array(z.string()),
    failedOffers: z.array(FailedOfferSchema),
    txHash: z.string().optional(),
    message: z.string().optional(),
  }),
  z.object({
    success: z.literal(false),
    error: z.string(),
    timestamp: z.string().optional(),
  }),
]);

// Chain results schema for poll
const ChainPollResultSchema = z.object({
  processed: z.number(),
  error: z.string().nullable(),
  latestBlock: z.string().nullable(),
});

const SolanaChainPollResultSchema = z.object({
  processed: z.number(),
  error: z.string().nullable(),
  lastSignature: z.string().nullable(),
});

// Cron poll token registrations response - discriminated union
export const CronPollTokenRegistrationsResponseSchema = z.discriminatedUnion("success", [
  z.object({
    success: z.literal(true),
    message: z.string().optional(),
    results: z.object({
      base: ChainPollResultSchema,
      solana: SolanaChainPollResultSchema,
      timestamp: z.string(),
    }),
  }),
  z.object({
    success: z.literal(false),
    error: z.string(),
  }),
]);

// Cron reconcile response - discriminated union
export const CronReconcileResponseSchema = z.discriminatedUnion("success", [
  z.object({
    success: z.literal(true),
    action: z.string(),
    duration: z.number(),
    timestamp: z.string(),
  }),
  z.object({
    success: z.literal(false),
    error: z.string(),
    timestamp: z.string().optional(),
  }),
]);

// Quote by offer error response (for redirect failures)
export const QuoteByOfferErrorResponseSchema = z.object({
  error: z.string(),
});

// Solana RPC health check response - discriminated union
export const SolanaRpcHealthResponseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("healthy"),
    provider: z.string(),
    message: z.string().optional(),
  }),
  z.object({
    status: z.literal("unhealthy"),
    message: z.string(),
    provider: z.string().optional(),
  }),
]);

// Pool price proxy error response
export const PoolPriceProxyErrorResponseSchema = z.object({
  error: z.string(),
});

//==============================================================================
// EXPORT INFERRED TYPES FOR USE IN TESTS AND CLIENT CODE
//==============================================================================

// Error response type (used by tests)
export type ApiErrorResponse = z.infer<typeof ErrorResponseSchema>;

// Token response types
export type TokenResponse = z.infer<typeof TokensResponseSchema>;
export type TokenBatchResponse = z.infer<typeof TokenBatchResponseSchema>;
export type TokenAddressesResponse = z.infer<typeof TokenAddressesResponseSchema>;
export type TokenDecimalsResponse = z.infer<typeof TokenDecimalsResponseSchema>;
export type TokenBySymbolResponse = z.infer<typeof TokenBySymbolResponseSchema>;
export type TokenByIdResponse = z.infer<typeof TokenByIdResponseSchema>;
export type TokenLookupResponse = z.infer<typeof TokenLookupResponseSchema>;
export type TokenPoolCheckResponse = z.infer<typeof TokenPoolCheckResponseSchema>;

// Balance response types
export type EvmBalanceResponse = z.infer<typeof EvmBalancesResponseSchema>;
export type SolanaBalanceResponse = z.infer<typeof SolanaBalancesResponseSchema>;

// Price response types
export type TokenPricesResponse = z.infer<typeof TokenPricesResponseSchema>;
export type NativePricesResponse = z.infer<typeof NativePricesResponseSchema>;

// Consignment response types
export type ConsignmentsResponse = z.infer<typeof ConsignmentsResponseSchema>;
export type ConsignmentByIdResponse = z.infer<typeof ConsignmentByIdResponseSchema>;
export type CreateConsignmentResponse = z.infer<typeof CreateConsignmentResponseSchema>;
export type UpdateConsignmentResponse = z.infer<typeof UpdateConsignmentResponseSchema>;
export type DeleteConsignmentResponse = z.infer<typeof DeleteConsignmentResponseSchema>;

// Quote response types
export type QuoteResponse = z.infer<typeof QuoteResponseSchema>;
export type QuoteByOfferResponse = z.infer<typeof QuoteByOfferResponseSchema>;
export type ExecutedQuoteResponse = z.infer<typeof ExecutedQuoteResponseSchema>;

// Market data response type
export type MarketDataResponse = z.infer<typeof MarketDataResponseSchema>;

// Other response types
export type RoomMessagesResponse = z.infer<typeof RoomMessagesResponseSchema>;
export type SendMessageResponse = z.infer<typeof SendMessageResponseSchema>;
export type ApproveOfferResponse = z.infer<typeof ApproveOfferResponseSchema>;
export type SolanaClaimResponse = z.infer<typeof SolanaClaimResponseSchema>;
export type SolanaWithdrawConsignmentResponse = z.infer<
  typeof SolanaWithdrawConsignmentResponseSchema
>;
export type SolanaUpdatePriceResponse = z.infer<typeof SolanaUpdatePriceResponseSchema>;
export type DealCompletionResponse = z.infer<typeof DealCompletionResponseSchema>;
export type RoomsResponse = z.infer<typeof RoomsResponseSchema>;
export type NotificationResponse = z.infer<typeof NotificationResponseSchema>;
export type CreateTokenResponse = z.infer<typeof CreateTokenResponseSchema>;
export type UpdateTokenResponse = z.infer<typeof UpdateTokenResponseSchema>;
export type DeleteTokenResponse = z.infer<typeof DeleteTokenResponseSchema>;
export type CacheImageResponse = z.infer<typeof CacheImageResponseSchema>;
export type TokenSyncResponse = z.infer<typeof TokenSyncResponseSchema>;
export type RpcProxyResponse = z.infer<typeof RpcProxyResponseSchema>;
export type RpcProxyErrorResponse = z.infer<typeof RpcProxyErrorResponseSchema>;
export type ClearTokensResponse = z.infer<typeof ClearTokensResponseSchema>;
export type CronCheckMaturedOtcResponse = z.infer<typeof CronCheckMaturedOtcResponseSchema>;
export type CronPollTokenRegistrationsResponse = z.infer<
  typeof CronPollTokenRegistrationsResponseSchema
>;
export type CronReconcileResponse = z.infer<typeof CronReconcileResponseSchema>;
export type QuoteByOfferErrorResponse = z.infer<typeof QuoteByOfferErrorResponseSchema>;
export type SolanaRpcHealthResponse = z.infer<typeof SolanaRpcHealthResponseSchema>;
export type PoolPriceProxyErrorResponse = z.infer<typeof PoolPriceProxyErrorResponseSchema>;
