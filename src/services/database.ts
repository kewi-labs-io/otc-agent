// Database service layer using Eliza runtime services
// With fail-fast Zod validation at all boundaries

import { z } from "zod";
import { agentRuntime } from "@/lib/agent-runtime";
import type QuoteService from "@/lib/plugin-otc-desk/services/quoteService";
import { parseOrThrow } from "@/lib/validation/helpers";
import type {
  Chain,
  ConsignmentDeal,
  OTCConsignment,
  PaymentCurrency,
  QuoteMemory as Quote,
  QuoteStatus,
  Token,
  TokenMarketData,
} from "@/types";
import { AddressSchema, BigIntStringSchema, ChainSchema } from "@/types/validation/schemas";
import {
  ConsignmentDealOutputSchema,
  ConsignmentOutputSchema,
  MarketDataOutputSchema,
  TokenOutputSchema,
} from "@/types/validation/service-schemas";
import { isEvmAddress } from "@/utils/address-utils";

export type {
  PaymentCurrency,
  QuoteStatus,
  Chain,
  Token,
  TokenMarketData,
  OTCConsignment,
  ConsignmentDeal,
};

// =============================================================================
// INTERNAL VALIDATION SCHEMAS
// =============================================================================

// ChainType schema for quote chain field
const ChainTypeSchema = z.enum(["evm", "solana", "base", "bsc", "ethereum"]);

// Quote creation input schema - includes all required fields
const QuoteCreateInputSchema = z.object({
  entityId: z.string().min(1),
  beneficiary: AddressSchema,
  tokenAmount: BigIntStringSchema,
  discountBps: z.number().int().min(0).max(10000),
  apr: z.number(),
  lockupMonths: z.number().int().min(0),
  paymentCurrency: z.enum(["ETH", "USDC", "BNB", "SOL"]),
  totalUsd: z.number().nonnegative(),
  discountUsd: z.number().nonnegative(),
  discountedUsd: z.number().nonnegative(),
  paymentAmount: BigIntStringSchema,
  // Required token metadata
  tokenId: z.string().min(1),
  tokenSymbol: z.string().min(1),
  tokenName: z.string(),
  tokenLogoUrl: z.string(),
  chain: ChainTypeSchema,
  consignmentId: z.string(), // Can be empty string for initial quotes
  agentCommissionBps: z.number().int().min(0).max(150),
});

// Quote status update input schema
const QuoteStatusUpdateInputSchema = z.object({
  quoteId: z.string().min(1),
  status: z.enum(["active", "expired", "executed", "rejected", "approved"]),
  data: z.object({
    offerId: z.string(),
    transactionHash: z.string(),
    blockNumber: z.number().int().nonnegative(),
    rejectionReason: z.string(),
    approvalNote: z.string(),
  }),
});

// Quote execution update input schema
const QuoteExecutionUpdateInputSchema = z.object({
  quoteId: z.string().min(1),
  data: z.object({
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
  }),
});

export class QuoteDB {
  static async createQuote(data: {
    entityId: string;
    beneficiary: string;
    tokenAmount: string;
    discountBps: number;
    apr: number;
    lockupMonths: number;
    paymentCurrency: PaymentCurrency;
    totalUsd: number;
    discountUsd: number;
    discountedUsd: number;
    paymentAmount: string;
    // Required token metadata
    tokenId: string;
    tokenSymbol: string;
    tokenName: string;
    tokenLogoUrl: string;
    chain: "evm" | "solana" | "base" | "bsc" | "ethereum";
    consignmentId: string;
    agentCommissionBps: number;
  }): Promise<Quote> {
    // FAIL-FAST: Validate input at boundary
    parseOrThrow(QuoteCreateInputSchema, data);

    const runtime = await agentRuntime.getRuntime();
    const service = runtime.getService<QuoteService>("QuoteService");
    if (!service) throw new Error("QuoteService not registered");
    return await service.createQuote(data);
  }

  static async getActiveQuotes(): Promise<Quote[]> {
    const runtime = await agentRuntime.getRuntime();
    const service = runtime.getService<QuoteService>("QuoteService");
    if (!service) throw new Error("QuoteService not registered");
    return await service.getActiveQuotes();
  }

  static async getQuoteByBeneficiary(beneficiary: string): Promise<Quote> {
    // FAIL-FAST: Validate address format
    parseOrThrow(AddressSchema, beneficiary);

    const runtime = await agentRuntime.getRuntime();
    const service = runtime.getService<QuoteService>("QuoteService");
    if (!service) throw new Error("QuoteService not registered");
    return await service.getQuoteByBeneficiary(beneficiary);
  }

  static async getQuoteByQuoteId(quoteId: string): Promise<Quote> {
    // FAIL-FAST: Validate quoteId is non-empty
    if (!quoteId || quoteId.trim() === "") {
      throw new Error("getQuoteByQuoteId: quoteId is required");
    }

    const runtime = await agentRuntime.getRuntime();
    const service = runtime.getService<QuoteService>("QuoteService");
    if (!service) throw new Error("QuoteService not registered");
    return await service.getQuoteByQuoteId(quoteId);
  }

  static async updateQuoteStatus(
    quoteId: string,
    status: QuoteStatus,
    data: {
      offerId: string;
      transactionHash: string;
      blockNumber: number;
      rejectionReason: string;
      approvalNote: string;
    },
  ): Promise<Quote> {
    // FAIL-FAST: Validate inputs
    parseOrThrow(QuoteStatusUpdateInputSchema, { quoteId, status, data });

    const runtime = await agentRuntime.getRuntime();
    const service = runtime.getService<QuoteService>("QuoteService");
    if (!service) throw new Error("QuoteService not registered");
    return await service.updateQuoteStatus(quoteId, status, data);
  }

  static async updateQuoteExecution(
    quoteId: string,
    data: {
      tokenAmount: string;
      totalUsd: number;
      discountUsd: number;
      discountedUsd: number;
      paymentCurrency: PaymentCurrency;
      paymentAmount: string;
      offerId: string;
      transactionHash: string;
      blockNumber: number;
      priceUsdPerToken?: number;
      ethUsdPrice?: number;
      lockupDays?: number;
    },
  ): Promise<Quote> {
    // FAIL-FAST: Validate inputs
    parseOrThrow(QuoteExecutionUpdateInputSchema, { quoteId, data });

    const runtime = await agentRuntime.getRuntime();
    const service = runtime.getService<QuoteService>("QuoteService");
    if (!service) throw new Error("QuoteService not registered");
    return await service.updateQuoteExecution(quoteId, data);
  }

  static async setQuoteBeneficiary(quoteId: string, beneficiary: string): Promise<Quote> {
    // FAIL-FAST: Validate inputs
    if (!quoteId || quoteId.trim() === "") {
      throw new Error("setQuoteBeneficiary: quoteId is required");
    }
    parseOrThrow(AddressSchema, beneficiary);

    const runtime = await agentRuntime.getRuntime();
    const service = runtime.getService<QuoteService>("QuoteService");
    if (!service) throw new Error("QuoteService not registered");
    return await service.setQuoteBeneficiary(quoteId, beneficiary);
  }

  static async getUserQuoteHistory(entityId: string, limit: number): Promise<Quote[]> {
    // FAIL-FAST: Validate inputs
    if (!entityId || entityId.trim() === "") {
      throw new Error("getUserQuoteHistory: entityId is required");
    }
    if (typeof limit !== "number" || limit < 1 || !Number.isInteger(limit)) {
      throw new Error("getUserQuoteHistory: limit must be a positive integer");
    }

    const runtime = await agentRuntime.getRuntime();
    const service = runtime.getService<QuoteService>("QuoteService");
    if (!service) throw new Error("QuoteService not registered");
    return await service.getUserQuoteHistory(entityId, limit);
  }

  static async verifyQuoteSignature(quote: Quote): Promise<boolean> {
    // FAIL-FAST: Validate quote has required fields for signature verification
    if (!quote || !quote.quoteId) {
      throw new Error("verifyQuoteSignature: quote with quoteId is required");
    }

    const runtime = await agentRuntime.getRuntime();
    const service = runtime.getService<QuoteService>("QuoteService");
    if (!service) throw new Error("QuoteService not registered");
    return service.verifyQuoteSignature(quote);
  }
}
export class DealCompletionService {
  static async generateShareData(quoteId: string) {
    const quote = await QuoteDB.getQuoteByQuoteId(quoteId);
    return {
      quote,
    };
  }
}

/**
 * Normalizes a tokenId to ensure consistent lookups.
 * EVM addresses are case-insensitive, so they are lowercased.
 * Solana addresses (Base58) are case-sensitive, so they are preserved.
 * Format: token-{chain}-{address}
 */
function normalizeTokenId(tokenId: string): string {
  const match = tokenId.match(/^token-([a-z]+)-(.+)$/);
  if (!match) return tokenId;
  const [, chain, address] = match;
  // Solana addresses are case-sensitive (Base58), preserve them
  if (chain === "solana") return tokenId;
  // EVM addresses are case-insensitive, lowercase for consistency
  return `token-${chain}-${address.toLowerCase()}`;
}

// Token creation input schema (validates data before DB operation)
const TokenCreateInputSchema = z.object({
  symbol: z.string().min(1, "symbol is required"),
  name: z.string(),
  contractAddress: AddressSchema,
  chain: ChainSchema,
  decimals: z.number().int().min(0).max(255),
  logoUrl: z.string(),
  description: z.string(),
  website: z.string().url().optional(),
  twitter: z.string().optional(),
  isActive: z.boolean(),
  poolAddress: AddressSchema.optional(),
  solVault: z.string().optional(),
  tokenVault: z.string().optional(),
});

export class TokenDB {
  static async createToken(data: Omit<Token, "id" | "createdAt" | "updatedAt">): Promise<Token> {
    // FAIL-FAST: Validate input with Zod schema
    parseOrThrow(TokenCreateInputSchema, data);

    const runtime = await agentRuntime.getRuntime();
    // EVM addresses are case-insensitive, so lowercase for consistent ID
    // Solana addresses are Base58 encoded and case-sensitive, preserve case
    const normalizedAddress =
      data.chain === "solana" ? data.contractAddress : data.contractAddress.toLowerCase();
    const tokenId = `token-${data.chain}-${normalizedAddress}`;

    const existing = await runtime.getCache<Token>(`token:${tokenId}`);
    if (existing) {
      // Update if the new data has better info (e.g., real symbol instead of "UNKNOWN")
      const newSymbolIsBetter =
        data.symbol &&
        data.symbol !== "UNKNOWN" &&
        data.symbol !== "SPL" &&
        (existing.symbol === "UNKNOWN" || existing.symbol === "SPL");

      if (newSymbolIsBetter || (data.decimals !== undefined && existing.decimals === undefined)) {
        if (data.decimals === undefined && existing.decimals === undefined) {
          throw new Error(`Token ${tokenId} missing decimals - cannot update without decimals`);
        }
        // name fallback: use data.name if available, otherwise data.symbol, otherwise existing.name
        const updatedName = newSymbolIsBetter
          ? typeof data.name === "string" && data.name.trim() !== ""
            ? data.name
            : typeof data.symbol === "string" && data.symbol.trim() !== ""
              ? data.symbol
              : existing.name
          : existing.name;
        // logoUrl: prefer new data if provided, otherwise keep existing
        const updatedLogoUrl = typeof data.logoUrl === "string" ? data.logoUrl : existing.logoUrl;
        const updated: Token = {
          ...existing,
          symbol: newSymbolIsBetter ? data.symbol : existing.symbol,
          name: updatedName,
          decimals: data.decimals !== undefined ? data.decimals : existing.decimals,
          logoUrl: updatedLogoUrl,
          updatedAt: Date.now(),
        };
        await runtime.setCache(`token:${tokenId}`, updated);
        console.log(
          `[TokenDB] Updated token ${tokenId}: symbol=${updated.symbol}, decimals=${updated.decimals}`,
        );
        return updated;
      }
      return existing;
    }

    const token: Token = {
      ...data,
      id: tokenId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await runtime.setCache(`token:${tokenId}`, token);
    const allTokens = (await runtime.getCache<string[]>("all_tokens")) || [];
    if (!allTokens.includes(tokenId)) {
      allTokens.push(tokenId);
      await runtime.setCache("all_tokens", allTokens);
    }
    return token;
  }

  static async getToken(tokenId: string): Promise<Token> {
    // FAIL-FAST: Validate tokenId format
    if (!tokenId || tokenId.trim() === "") {
      throw new Error("getToken: tokenId is required");
    }
    // Validate tokenId format (token-{chain}-{address})
    if (!/^token-[a-z]+-[a-zA-Z0-9]+$/.test(tokenId)) {
      throw new Error(`getToken: invalid tokenId format: ${tokenId}`);
    }

    const runtime = await agentRuntime.getRuntime();
    const normalizedId = normalizeTokenId(tokenId);
    const token = await runtime.getCache<Token>(`token:${normalizedId}`);
    if (!token) throw new Error(`Token ${tokenId} not found`);

    // Validate output matches expected schema
    parseOrThrow(TokenOutputSchema, token);
    return token;
  }

  static async getAllTokens(filters?: { chain?: Chain; isActive?: boolean }): Promise<Token[]> {
    // FAIL-FAST: Validate filters if provided
    if (filters?.chain) {
      parseOrThrow(ChainSchema, filters.chain);
    }

    const runtime = await agentRuntime.getRuntime();
    const allTokenIds = (await runtime.getCache<string[]>("all_tokens")) ?? [];
    const tokens = await Promise.all(
      allTokenIds.map((id) => runtime.getCache<Token>(`token:${id}`)),
    );
    let result = tokens.filter((t): t is Token => t != null);
    if (filters?.chain) result = result.filter((t) => t.chain === filters.chain);
    if (filters?.isActive !== undefined)
      result = result.filter((t) => t.isActive === filters.isActive);
    return result;
  }

  static async updateToken(tokenId: string, updates: Partial<Token>): Promise<Token> {
    const runtime = await agentRuntime.getRuntime();
    const normalizedId = normalizeTokenId(tokenId);
    const token = await runtime.getCache<Token>(`token:${normalizedId}`);
    if (!token) throw new Error(`Token ${tokenId} not found`);
    const updated = { ...token, ...updates, updatedAt: Date.now() };
    await runtime.setCache(`token:${normalizedId}`, updated);
    return updated;
  }

  /**
   * Find a token by its on-chain tokenId (EVM: `keccak256(abi.encodePacked(tokenAddress))`).
   *
   * This maps the smart contract's `bytes32 tokenId` to a TokenDB entry.
   */
  static async getTokenByOnChainId(onChainTokenId: string): Promise<Token | null> {
    const { encodePacked, getAddress, keccak256 } = await import("viem");
    const allTokens = await TokenDB.getAllTokens();
    const normalizedTarget = onChainTokenId.toLowerCase();

    for (const token of allTokens) {
      // Solana uses token mints directly; EVM uses bytes32 tokenId.
      if (token.chain === "solana") continue;
      if (!isEvmAddress(token.contractAddress)) continue;

      const tokenAddress = getAddress(token.contractAddress);
      const computedId = keccak256(encodePacked(["address"], [tokenAddress])).toLowerCase();

      if (computedId === normalizedTarget) {
        return token;
      }
    }
    return null;
  }

  /**
   * Find a token by its symbol (case-insensitive).
   */
  static async getTokenBySymbol(symbol: string): Promise<Token | null> {
    const allTokens = await TokenDB.getAllTokens();
    return allTokens.find((t) => t.symbol.toLowerCase() === symbol.toLowerCase()) ?? null;
  }
}

// Helper to convert NaN/undefined/null to a default number
const toValidNumber = (val: unknown, defaultVal: number): number => {
  if (val === undefined || val === null) return defaultVal;
  if (typeof val === "number" && !Number.isNaN(val)) return val;
  return defaultVal;
};

// Market data input schema - handles NaN and undefined from external APIs
const MarketDataInputSchema = z.object({
  tokenId: z.string().min(1),
  priceUsd: z.preprocess((v) => toValidNumber(v, 0), z.number().nonnegative()),
  marketCap: z.preprocess((v) => toValidNumber(v, 0), z.number().nonnegative()),
  volume24h: z.preprocess((v) => toValidNumber(v, 0), z.number().nonnegative()),
  priceChange24h: z.preprocess((v) => toValidNumber(v, 0), z.number()),
  liquidity: z.preprocess((v) => toValidNumber(v, 0), z.number().nonnegative()),
  lastUpdated: z.preprocess((v) => toValidNumber(v, Date.now()), z.number().int().positive()),
});

export class MarketDataDB {
  static async setMarketData(data: TokenMarketData): Promise<void> {
    // FAIL-FAST: Validate input
    parseOrThrow(MarketDataInputSchema, data);

    const runtime = await agentRuntime.getRuntime();
    const normalizedId = normalizeTokenId(data.tokenId);
    await runtime.setCache(`market_data:${normalizedId}`, {
      ...data,
      tokenId: normalizedId,
    });
  }

  static async getMarketData(tokenId: string): Promise<TokenMarketData | null> {
    // FAIL-FAST: Validate tokenId
    if (!tokenId || tokenId.trim() === "") {
      throw new Error("getMarketData: tokenId is required");
    }

    const runtime = await agentRuntime.getRuntime();
    const normalizedId = normalizeTokenId(tokenId);
    const data = await runtime.getCache<TokenMarketData>(`market_data:${normalizedId}`);

    if (!data) return null;
    // Validate output
    parseOrThrow(MarketDataOutputSchema, data);
    return data;
  }
}

// Consignment creation input schema
const ConsignmentCreateInputSchema = z
  .object({
    tokenId: z.string().min(1, "tokenId is required"),
    consignerAddress: AddressSchema,
    consignerEntityId: z.string().min(1),
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
    allowedBuyers: z.array(AddressSchema).optional(),
    maxPriceVolatilityBps: z.number().int().min(0).max(10000),
    maxTimeToExecuteSeconds: z.number().int().min(0),
    status: z.enum(["active", "paused", "depleted", "withdrawn"]),
    contractConsignmentId: z.string().optional(),
    chain: ChainSchema,
  })
  .refine(
    (data) => {
      // Solana consignments MUST have on-chain ID
      if (data.chain === "solana") {
        return !!data.contractConsignmentId;
      }
      return true;
    },
    {
      message: "Solana consignments require contractConsignmentId",
    },
  );

export class ConsignmentDB {
  static async createConsignment(
    data: Omit<OTCConsignment, "id" | "createdAt" | "updatedAt">,
  ): Promise<OTCConsignment> {
    // FAIL-FAST: Validate input with Zod schema
    parseOrThrow(ConsignmentCreateInputSchema, data);

    const runtime = await agentRuntime.getRuntime();
    const { v4: uuidv4 } = await import("uuid");
    const consignmentId = uuidv4();
    const normalizedTokenId = normalizeTokenId(data.tokenId);

    console.log(`[ConsignmentDB] Creating consignment:`, {
      id: consignmentId,
      tokenId: normalizedTokenId,
      chain: data.chain,
      contractConsignmentId: data.contractConsignmentId,
    });

    const consignment: OTCConsignment = {
      ...data,
      tokenId: normalizedTokenId,
      id: consignmentId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await runtime.setCache(`consignment:${consignmentId}`, consignment);
    const allConsignments = (await runtime.getCache<string[]>("all_consignments")) || [];
    allConsignments.push(consignmentId);
    await runtime.setCache("all_consignments", allConsignments);
    const tokenConsignments =
      (await runtime.getCache<string[]>(`token_consignments:${normalizedTokenId}`)) || [];
    tokenConsignments.push(consignmentId);
    await runtime.setCache(`token_consignments:${normalizedTokenId}`, tokenConsignments);
    const consignerConsignments =
      (await runtime.getCache<string[]>(`consigner_consignments:${data.consignerAddress}`)) || [];
    consignerConsignments.push(consignmentId);
    await runtime.setCache(
      `consigner_consignments:${data.consignerAddress}`,
      consignerConsignments,
    );
    return consignment;
  }

  static async getConsignment(consignmentId: string): Promise<OTCConsignment> {
    // FAIL-FAST: Validate consignmentId
    if (!consignmentId || consignmentId.trim() === "") {
      throw new Error("getConsignment: consignmentId is required");
    }

    const runtime = await agentRuntime.getRuntime();
    const consignment = await runtime.getCache<OTCConsignment>(`consignment:${consignmentId}`);
    if (!consignment) throw new Error(`Consignment ${consignmentId} not found`);

    // Validate output
    parseOrThrow(ConsignmentOutputSchema, consignment);
    return consignment;
  }

  static async updateConsignment(
    consignmentId: string,
    updates: Partial<OTCConsignment>,
  ): Promise<OTCConsignment> {
    const runtime = await agentRuntime.getRuntime();
    const consignment = await runtime.getCache<OTCConsignment>(`consignment:${consignmentId}`);
    if (!consignment) throw new Error(`Consignment ${consignmentId} not found`);
    const updated = { ...consignment, ...updates, updatedAt: Date.now() };
    await runtime.setCache(`consignment:${consignmentId}`, updated);
    return updated;
  }

  static async getConsignmentsByToken(tokenId: string): Promise<OTCConsignment[]> {
    const runtime = await agentRuntime.getRuntime();
    const normalizedId = normalizeTokenId(tokenId);
    const consignmentIds =
      (await runtime.getCache<string[]>(`token_consignments:${normalizedId}`)) || [];
    const consignments = await Promise.all(
      consignmentIds.map((id) => runtime.getCache<OTCConsignment>(`consignment:${id}`)),
    );
    return consignments.filter((c): c is OTCConsignment => c != null && c.status === "active");
  }

  static async getConsignmentsByConsigner(
    consignerAddress: string,
    includeWithdrawn = false,
  ): Promise<OTCConsignment[]> {
    const runtime = await agentRuntime.getRuntime();
    const consignmentIds =
      (await runtime.getCache<string[]>(`consigner_consignments:${consignerAddress}`)) || [];
    const consignments = await Promise.all(
      consignmentIds.map((id) => runtime.getCache<OTCConsignment>(`consignment:${id}`)),
    );
    return consignments.filter(
      (c): c is OTCConsignment => c != null && (includeWithdrawn || c.status !== "withdrawn"),
    );
  }

  static async getAllConsignments(filters?: {
    chain?: Chain;
    tokenId?: string;
    isNegotiable?: boolean;
  }): Promise<OTCConsignment[]> {
    const runtime = await agentRuntime.getRuntime();
    const allConsignmentIds = (await runtime.getCache<string[]>("all_consignments")) || [];
    const consignments = await Promise.all(
      allConsignmentIds.map((id) => runtime.getCache<OTCConsignment>(`consignment:${id}`)),
    );
    let result = consignments.filter(
      (c): c is OTCConsignment => c != null && c.status === "active",
    );
    if (filters?.chain) result = result.filter((c) => c.chain === filters.chain);
    if (filters?.tokenId) {
      // Normalize the filter tokenId for consistent matching
      const normalizedFilterTokenId = normalizeTokenId(filters.tokenId);
      result = result.filter((c) => c.tokenId === normalizedFilterTokenId);
    }
    if (filters?.isNegotiable !== undefined)
      result = result.filter((c) => c.isNegotiable === filters.isNegotiable);
    return result;
  }
}

// Consignment deal creation input schema
const ConsignmentDealCreateInputSchema = z.object({
  consignmentId: z.string().min(1),
  quoteId: z.string().min(1),
  tokenId: z.string().min(1),
  buyerAddress: AddressSchema,
  amount: BigIntStringSchema,
  discountBps: z.number().int().min(0).max(10000),
  lockupDays: z.number().int().min(0),
  executedAt: z.number().int().positive(),
  offerId: z.string().optional(),
  status: z.enum(["pending", "executed", "failed"]),
});

export class ConsignmentDealDB {
  static async createDeal(data: Omit<ConsignmentDeal, "id">): Promise<ConsignmentDeal> {
    // FAIL-FAST: Validate input
    parseOrThrow(ConsignmentDealCreateInputSchema, data);

    const runtime = await agentRuntime.getRuntime();
    const { v4: uuidv4 } = await import("uuid");
    const dealId = uuidv4();
    const deal: ConsignmentDeal = {
      ...data,
      id: dealId,
    };
    await runtime.setCache(`consignment_deal:${dealId}`, deal);
    const consignmentDeals =
      (await runtime.getCache<string[]>(`consignment_deals:${data.consignmentId}`)) || [];
    consignmentDeals.push(dealId);
    await runtime.setCache(`consignment_deals:${data.consignmentId}`, consignmentDeals);

    // Validate output
    parseOrThrow(ConsignmentDealOutputSchema, deal);
    return deal;
  }

  static async getDealsByConsignment(consignmentId: string): Promise<ConsignmentDeal[]> {
    // FAIL-FAST: Validate consignmentId
    if (!consignmentId || consignmentId.trim() === "") {
      throw new Error("getDealsByConsignment: consignmentId is required");
    }

    const runtime = await agentRuntime.getRuntime();
    const dealIds = (await runtime.getCache<string[]>(`consignment_deals:${consignmentId}`)) || [];
    const deals = await Promise.all(
      dealIds.map((id) => runtime.getCache<ConsignmentDeal>(`consignment_deal:${id}`)),
    );
    return deals.filter((d): d is ConsignmentDeal => d != null);
  }
}
