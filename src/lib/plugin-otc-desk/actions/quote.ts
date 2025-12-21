// quote action - generate a new OTC quote and return an XML object to the frontend

import {
  Action,
  ActionResult,
  Content,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  State,
} from "@elizaos/core";
import {
  deleteUserQuote,
  getUserQuote,
  setUserQuote,
} from "../providers/quote";
import { getEthPriceUsd, getBnbPriceUsd } from "../services/priceFeed";
import { ConsignmentService } from "@/services/consignmentService";
import {
  TokenDB,
  MarketDataDB,
  type OTCConsignment,
} from "@/services/database";
import type { QuoteMemory, PaymentCurrency } from "../types";
import { calculateAgentCommission } from "../types";
import { getSolPriceUsd } from "../services/priceFeed";

interface QuoteRequestParams {
  tokenAmount?: string;
  discountBps?: number;
  paymentCurrency?: PaymentCurrency;
}

function parseQuoteRequest(text: string): QuoteRequestParams {
  const result: QuoteRequestParams = {};

  // Parse token amount (various formats)
  const amountMatch = text.match(
    /(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:tokens?|eliza)?/i,
  );
  if (amountMatch) {
    result.tokenAmount = amountMatch[1].replace(/,/g, "");
  }

  // Parse discount (percentage or bps)
  const discountMatch = text.match(
    /(\d+(?:\.\d+)?)\s*(?:%|percent|bps|basis)/i,
  );
  if (discountMatch) {
    const value = parseFloat(discountMatch[1]);
    // If it's a percentage (has % or "percent"), convert to bps
    if (
      discountMatch[0].includes("%") ||
      discountMatch[0].includes("percent")
    ) {
      result.discountBps = Math.round(value * 100);
    } else {
      result.discountBps = Math.round(value);
    }
  }

  // Parse payment currency
  if (/(\b(eth|ethereum)\b)/i.test(text)) {
    result.paymentCurrency = "ETH";
  } else if (/(\b(bnb|binance|bsc)\b)/i.test(text)) {
    result.paymentCurrency = "BNB";
  } else if (/(\b(usdc|usd|dollar)\b)/i.test(text)) {
    result.paymentCurrency = "USDC";
  }

  return result;
}

const MAX_DISCOUNT_BPS = 2500;

interface NegotiationRequestParams {
  tokenAmount?: string;
  requestedDiscountBps?: number;
  lockupMonths?: number;
  paymentCurrency?: PaymentCurrency;
}

function parseNegotiationRequest(text: string): NegotiationRequestParams {
  const result: NegotiationRequestParams = {};

  // Token amount (reuse existing regex)
  const amountMatch = text.match(
    /(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:tokens?|eliza)?/i,
  );
  if (amountMatch) {
    result.tokenAmount = amountMatch[1].replace(/,/g, "");
  }

  // Discount request
  const discountMatch = text.match(
    /(\d+(?:\.\d+)?)\s*(?:%|percent|bps|basis|discount)/i,
  );
  if (discountMatch) {
    const value = parseFloat(discountMatch[1]);
    if (
      discountMatch[0].includes("bps") ||
      discountMatch[0].includes("basis")
    ) {
      result.requestedDiscountBps = Math.round(value);
    } else {
      result.requestedDiscountBps = Math.round(value * 100);
    }
  }

  // Lockup period
  const lockupMatch = text.match(
    /(\d+)\s*(?:month|months|mo|week|weeks|wk|day|days|d)/i,
  );
  if (lockupMatch) {
    const value = parseInt(lockupMatch[1]);
    const unit = lockupMatch[0].toLowerCase();
    if (unit.includes("month") || unit.includes("mo")) {
      result.lockupMonths = value;
    } else if (unit.includes("week") || unit.includes("wk")) {
      result.lockupMonths = value / 4; // approx weeks->months
    } else if (unit.includes("day") || unit.includes("d")) {
      result.lockupMonths = value / 30; // approx days->months
    }
  }

  // Payment currency
  if (/(\b(eth|ethereum)\b)/i.test(text)) {
    result.paymentCurrency = "ETH";
  } else if (/(\b(bnb|binance|bsc)\b)/i.test(text)) {
    result.paymentCurrency = "BNB";
  } else if (/(\b(usdc|usd|dollar)\b)/i.test(text)) {
    result.paymentCurrency = "USDC";
  }

  return result;
}

async function extractTokenContext(text: string): Promise<string | null> {
  const allTokens = await TokenDB.getAllTokens();
  if (allTokens.length === 0) return null;

  // FIRST: Try to find contract address in text (most reliable)
  // Solana addresses are base58, 32-44 chars
  // EVM addresses are 0x + 40 hex chars
  const solanaAddressMatch = text.match(/\b([1-9A-HJ-NP-Za-km-z]{32,44})\b/);
  const evmAddressMatch = text.match(/\b(0x[a-fA-F0-9]{40})\b/);

  if (solanaAddressMatch) {
    const address = solanaAddressMatch[1];
    const token = allTokens.find((t) => t.contractAddress === address);
    if (token) {
      console.log(
        `[extractTokenContext] Found token by Solana address: ${token.id}`,
      );
      return token.id;
    }
  }

  if (evmAddressMatch) {
    const address = evmAddressMatch[1].toLowerCase();
    const token = allTokens.find(
      (t) => t.contractAddress.toLowerCase() === address,
    );
    if (token) {
      console.log(
        `[extractTokenContext] Found token by EVM address: ${token.id}`,
      );
      return token.id;
    }
  }

  // SECOND: Match by symbol (fallback, less reliable)
  const normalizedText = text.toLowerCase();
  const sortedTokens = [...allTokens].sort(
    (a, b) => b.symbol.length - a.symbol.length,
  );

  for (const token of sortedTokens) {
    // Skip tokens with generic symbols
    if (token.symbol === "UNKNOWN" || token.symbol === "SPL") continue;

    const symbolRegex = new RegExp(
      `\\b${token.symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
      "i",
    );
    if (symbolRegex.test(text)) {
      console.log(`[extractTokenContext] Found token by symbol: ${token.id}`);
      return token.id;
    }

    const dollarRegex = new RegExp(
      `\\$${token.symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
      "i",
    );
    if (dollarRegex.test(text)) {
      console.log(`[extractTokenContext] Found token by $symbol: ${token.id}`);
      return token.id;
    }
  }

  // Fallback: if only one token is registered, use it
  if (allTokens.length === 1) {
    console.log(
      `[extractTokenContext] Using only registered token: ${allTokens[0].id}`,
    );
    return allTokens[0].id;
  }

  return null;
}

async function findSuitableConsignment(
  tokenId: string,
  tokenAmount: string,
  discountBps: number,
  lockupDays: number,
): Promise<OTCConsignment | null> {
  const consignmentService = new ConsignmentService();

  // First get ALL consignments to debug
  const allConsignments = await consignmentService.getAllConsignments({});
  console.log(
    `[findSuitableConsignment] Total consignments in DB: ${allConsignments.length}`,
  );

  // Now filter by tokenId
  const consignments = await consignmentService.getAllConsignments({ tokenId });
  console.log(
    `[findSuitableConsignment] Consignments matching tokenId '${tokenId}': ${consignments.length}`,
  );

  // Debug: show what tokenIds exist
  if (consignments.length === 0 && allConsignments.length > 0) {
    const uniqueTokenIds = [...new Set(allConsignments.map((c) => c.tokenId))];
    console.log(
      `[findSuitableConsignment] Available tokenIds in DB:`,
      uniqueTokenIds,
    );
  }

  // First try strict matching
  const strictMatch = consignmentService.findSuitableConsignment(
    consignments,
    tokenAmount,
    discountBps,
    lockupDays,
  );

  if (strictMatch) {
    console.log(
      `[findSuitableConsignment] Found strict match: ${strictMatch.id}`,
    );
    return strictMatch;
  }

  // Fallback: return ANY active consignment with remaining tokens
  // This ensures we always link a quote to a consignment if one exists
  const anyActive = consignments.find(
    (c) => c.status === "active" && BigInt(c.remainingAmount) > 0n,
  );

  if (anyActive) {
    console.log(
      `[findSuitableConsignment] No strict match, using fallback: ${anyActive.id}`,
    );
    return anyActive;
  }

  console.log(`[findSuitableConsignment] No consignment found for ${tokenId}`);
  return null;
}

// Worst possible deal defaults (lowest discount, longest lockup)
const DEFAULT_MIN_DISCOUNT_BPS = 100; // 1% - lowest discount
const DEFAULT_MAX_LOCKUP_MONTHS = 12; // 12 months - longest lockup
const DEFAULT_MAX_LOCKUP_DAYS = 365;

async function negotiateTerms(
  _runtime: IAgentRuntime,
  request: NegotiationRequestParams,
  existingQuote: QuoteMemory | null,
  consignment?: OTCConsignment,
  tokenChain?: "solana" | "base" | "bsc" | "ethereum",
): Promise<{
  lockupMonths: number;
  discountBps: number;
  paymentCurrency: PaymentCurrency;
  reasoning: string;
  consignmentId?: string;
}> {
  let lockupMonths = DEFAULT_MAX_LOCKUP_MONTHS; // Start with worst lockup
  let minDiscountBps = DEFAULT_MIN_DISCOUNT_BPS;
  let maxDiscountBps = MAX_DISCOUNT_BPS;
  let minLockupDays = 7;
  let maxLockupDays = DEFAULT_MAX_LOCKUP_DAYS;

  if (consignment) {
    if (consignment.isNegotiable) {
      minDiscountBps = consignment.minDiscountBps;
      maxDiscountBps = consignment.maxDiscountBps;
      minLockupDays = consignment.minLockupDays;
      maxLockupDays = consignment.maxLockupDays;
    } else {
      if (consignment.fixedDiscountBps === undefined) {
        throw new Error("Fixed consignment missing fixedDiscountBps");
      }
      if (consignment.fixedLockupDays === undefined) {
        throw new Error("Fixed consignment missing fixedLockupDays");
      }
      const discountBps = consignment.fixedDiscountBps;
      const lockupDays = consignment.fixedLockupDays;
      const lockupMonths = Math.round(lockupDays / 30);
      return {
        lockupMonths,
        discountBps,
        paymentCurrency: request.paymentCurrency || "USDC",
        reasoning: `This is a fixed-price deal: ${discountBps / 100}% discount with ${lockupDays} days lockup.`,
        consignmentId: consignment.id,
      };
    }
  }

  if (request.lockupMonths) {
    lockupMonths = Math.max(
      minLockupDays / 30,
      Math.min(maxLockupDays / 30, request.lockupMonths),
    );
  }

  // Determine discount with explicit precedence:
  // 1. Existing quote's discount (if exists)
  // 2. Requested discount
  // 3. Default minimum
  let discountBps: number;
  if (existingQuote && existingQuote.discountBps !== undefined) {
    discountBps = existingQuote.discountBps;
  } else if (request.requestedDiscountBps !== undefined) {
    discountBps = request.requestedDiscountBps;
  } else {
    discountBps = DEFAULT_MIN_DISCOUNT_BPS;
  }
  discountBps = Math.max(minDiscountBps, Math.min(maxDiscountBps, discountBps));

  if (discountBps >= 2000 && lockupMonths < 6) lockupMonths = 6;
  if (discountBps >= 2500 && lockupMonths < 9) lockupMonths = 9;

  const reasoning = `I can offer a ${(discountBps / 100).toFixed(2)}% discount with a ${lockupMonths}-month lockup.`;

  // Determine payment currency with explicit precedence:
  // 1. Explicit request
  // 2. Existing quote's currency
  // 3. Chain-based default (BNB for BSC, USDC otherwise)
  let paymentCurrency: PaymentCurrency;
  if (request.paymentCurrency !== undefined) {
    paymentCurrency = request.paymentCurrency;
  } else if (existingQuote && existingQuote.paymentCurrency !== undefined) {
    paymentCurrency = existingQuote.paymentCurrency;
  } else {
    paymentCurrency = tokenChain === "bsc" ? "BNB" : "USDC";
  }

  return {
    lockupMonths,
    discountBps,
    paymentCurrency,
    reasoning,
    consignmentId: consignment ? consignment.id : undefined,
  };
}

export const quoteAction: Action = {
  name: "CREATE_OTC_QUOTE",
  similes: [
    "CREATE_OTC_QUOTE",
    "generate quote",
    "create quote",
    "new quote",
    "update quote",
    "modify quote",
  ],
  description: "Generate or update a quote with negotiated terms",

  validate: async () => true,

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State | undefined,
    _options?: { [key: string]: unknown },
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    console.log("[CREATE_OTC_QUOTE] Action handler called");
    console.log(
      "[CREATE_OTC_QUOTE] Message object:",
      JSON.stringify(message, null, 2),
    );
    // FAIL-FAST: entityId is required for quote creation
    if (!message.entityId) {
      throw new Error("CREATE_OTC_QUOTE requires message.entityId");
    }
    const entityId = message.entityId;
    // FAIL-FAST: message content text is required
    if (!message.content || typeof message.content.text !== "string") {
      throw new Error("CREATE_OTC_QUOTE requires message.content.text");
    }
    const text = message.content.text;
    console.log(
      "[CREATE_OTC_QUOTE] EntityId:",
      entityId,
      "Text:",
      text.substring(0, 50),
    );

    // Check for quote cancellation
    if (
      text.toLowerCase().includes("cancel") ||
      text.toLowerCase().includes("delete")
    ) {
      const existingQuote = await getUserQuote(entityId);
      if (existingQuote) {
        await deleteUserQuote(entityId);
      }

      if (callback) {
        await callback({
          text: "Your quote has been cancelled.",
          action: "QUOTE_CANCELLED",
        });
      }
      return { success: true };
    }

    // Parse the request(s)
    const request = parseQuoteRequest(text);
    const negotiationRequest = parseNegotiationRequest(text);

    const tokenId = await extractTokenContext(text);
    const existingQuote = await getUserQuote(entityId); // Can be null if no quote exists

    // Fetch token info for dynamic symbol/name
    let tokenSymbol = "TOKEN";
    let tokenName = "Token";
    let tokenChain: "solana" | "base" | "bsc" | "ethereum" | undefined =
      undefined;
    let tokenLogoUrl: string | undefined = undefined;
    let tokenAddress: string | undefined = undefined;
    let tokenPriceUsd = 0;
    if (tokenId) {
      const token = await TokenDB.getToken(tokenId);
      // FAIL-FAST: Token must have valid data
      if (!token.contractAddress) {
        throw new Error(`Token ${tokenId} missing contractAddress`);
      }
      tokenSymbol = token.symbol;
      tokenName = token.name;
      tokenAddress = token.contractAddress;
      if (
        token.chain === "solana" ||
        token.chain === "base" ||
        token.chain === "bsc" ||
        token.chain === "ethereum"
      ) {
        tokenChain = token.chain;
      } else if (token.chain === "evm") {
        tokenChain = "base";
      }
      tokenLogoUrl = token.logoUrl;

      // Fetch token price from market data
      const marketData = await MarketDataDB.getMarketData(tokenId);
      if (marketData && marketData.priceUsd > 0) {
        tokenPriceUsd = marketData.priceUsd;
        console.log(
          `[CREATE_OTC_QUOTE] Token price from DB: $${tokenPriceUsd}`,
        );
      }
    }

    // ALWAYS try to find a consignment if we have a tokenId
    // Even without a specific tokenAmount, we need the consignment for the quote
    let consignment: OTCConsignment | null = null;
    if (tokenId) {
      console.log(
        `[CREATE_OTC_QUOTE] Looking for consignment with tokenId: ${tokenId}`,
      );
      const lockupDays =
        (negotiationRequest.lockupMonths || DEFAULT_MAX_LOCKUP_MONTHS) * 30;
      // Use "1" as minimum amount if not specified - we just need to find ANY consignment
      const tokenAmount = negotiationRequest.tokenAmount || "1";
      consignment = await findSuitableConsignment(
        tokenId,
        tokenAmount,
        negotiationRequest.requestedDiscountBps || DEFAULT_MIN_DISCOUNT_BPS,
        lockupDays,
      );
      if (consignment) {
        console.log(
          `[CREATE_OTC_QUOTE] Found consignment: ${consignment.id}, contractId: ${consignment.contractConsignmentId}`,
        );
      } else {
        console.log(
          `[CREATE_OTC_QUOTE] No suitable consignment found for token ${tokenId}`,
        );
        // Debug: list all consignments to see what's available
        const consignmentService = new ConsignmentService();
        const allConsignments = await consignmentService.getAllConsignments({});
        console.log(
          `[CREATE_OTC_QUOTE] Total consignments in DB: ${allConsignments.length}`,
        );
        for (const c of allConsignments.slice(0, 5)) {
          console.log(
            `[CREATE_OTC_QUOTE]   - ${c.id}: tokenId=${c.tokenId}, status=${c.status}, remaining=${c.remainingAmount}`,
          );
        }
      }
    } else {
      console.log(
        `[CREATE_OTC_QUOTE] No tokenId found, skipping consignment search`,
      );
    }

    const isNegotiation =
      /negotiate|discount|lockup|month/i.test(text) ||
      negotiationRequest.requestedDiscountBps !== undefined ||
      negotiationRequest.lockupMonths !== undefined;

    if (isNegotiation) {
      const negotiated = await negotiateTerms(
        runtime,
        negotiationRequest,
        existingQuote, // Already null if no quote exists
        consignment || undefined,
        tokenChain,
      );

      const nativePriceUsd =
        negotiated.paymentCurrency === "ETH"
          ? await getEthPriceUsd()
          : negotiated.paymentCurrency === "BNB"
            ? await getBnbPriceUsd()
            : negotiated.paymentCurrency === "SOL"
              ? await getSolPriceUsd()
              : 0;

      // Generate terms-only quote
      const now = Date.now();
      const lockupDays = Math.round(negotiated.lockupMonths * 30);

      // Calculate agent commission based on negotiated terms
      const negotiatedLockupDays = Math.round(negotiated.lockupMonths * 30);
      const negotiatedAgentCommissionBps = calculateAgentCommission(
        negotiated.discountBps,
        negotiatedLockupDays,
      );

      // FAIL-FAST: tokenId is required for quote creation
      if (!tokenId) {
        throw new Error("Cannot create quote without tokenId");
      }
      if (!tokenChain) {
        throw new Error("Cannot create quote without tokenChain");
      }

      // TypeScript now knows these are defined after the checks above
      const requiredTokenId: string = tokenId;
      const requiredTokenChain: "evm" | "solana" | "base" | "bsc" | "ethereum" =
        tokenChain;

      const quote = {
        tokenAmount: "0",
        discountBps: negotiated.discountBps,
        paymentCurrency: negotiated.paymentCurrency,
        priceUsdPerToken: tokenPriceUsd, // From market data for display
        totalUsd: 0,
        discountedUsd: 0,
        createdAt: now,
        quoteId: "", // Will be generated by service
        apr: 0,
        lockupMonths: negotiated.lockupMonths,
        paymentAmount: "0",
        // Token metadata - required fields
        tokenId: requiredTokenId,
        tokenSymbol: tokenSymbol,
        tokenName: tokenName,
        tokenLogoUrl: tokenLogoUrl || "",
        chain: requiredTokenChain,
        consignmentId: negotiated.consignmentId || "",
        agentCommissionBps: negotiatedAgentCommissionBps,
      };

      console.log("[CREATE_OTC_QUOTE] Creating quote with negotiated terms");
      const storedQuote = await setUserQuote(entityId, quote);
      const quoteId = storedQuote.quoteId;
      console.log("[CREATE_OTC_QUOTE] Quote created with ID:", quoteId);

      const xmlResponse = `
<quote>
  <quoteId>${quoteId}</quoteId>
  <tokenSymbol>${tokenSymbol}</tokenSymbol>
  ${tokenChain ? `<tokenChain>${tokenChain}</tokenChain>` : ""}
  ${tokenAddress ? `<tokenAddress>${tokenAddress}</tokenAddress>` : ""}
  ${negotiated.consignmentId ? `<consignmentId>${negotiated.consignmentId}</consignmentId>` : ""}
  <lockupMonths>${negotiated.lockupMonths}</lockupMonths>
  <lockupDays>${lockupDays}</lockupDays>
  <pricePerToken>${tokenPriceUsd}</pricePerToken>
  <discountBps>${negotiated.discountBps}</discountBps>
  <discountPercent>${(negotiated.discountBps / 100).toFixed(2)}</discountPercent>
  <paymentCurrency>${negotiated.paymentCurrency}</paymentCurrency>
  ${negotiated.paymentCurrency === "ETH" ? `<ethPrice>${nativePriceUsd.toFixed(2)}</ethPrice>` : ""}
  ${negotiated.paymentCurrency === "BNB" ? `<bnbPrice>${nativePriceUsd.toFixed(2)}</bnbPrice>` : ""}
  ${negotiated.paymentCurrency === "SOL" ? `<solPrice>${nativePriceUsd.toFixed(2)}</solPrice>` : ""}
  <nativePrice>${nativePriceUsd.toFixed(2)}</nativePrice>
  <createdAt>${new Date(now).toISOString()}</createdAt>
  <status>negotiated</status>
  <message>Terms confirmed. Token price: $${tokenPriceUsd.toFixed(8)}</message>
</quote>`;

      const textResponse = `${negotiated.reasoning}

📊 **Quote Terms: Discount: ${(negotiated.discountBps / 100).toFixed(2)}% Lockup: ${negotiated.lockupMonths} months** (${lockupDays} days)`;

      if (callback) {
        await callback({
          text:
            textResponse +
            "\n\n<!-- XML_START -->\n" +
            xmlResponse +
            "\n<!-- XML_END -->",
          action: "QUOTE_NEGOTIATED",
          content: { xml: xmlResponse, quote, type: "otc_quote" } as Content,
        });
      }

      return { success: true };
    }

    // ------------- Simple discount-based quote -------------
    // Determine discount with explicit precedence
    let discountBps: number;
    if (existingQuote && existingQuote.discountBps !== undefined) {
      discountBps = existingQuote.discountBps;
    } else if (request.discountBps !== undefined) {
      discountBps = request.discountBps;
    } else {
      discountBps = DEFAULT_MIN_DISCOUNT_BPS;
    }
    // Determine payment currency with explicit precedence
    let paymentCurrency: PaymentCurrency;
    if (existingQuote && existingQuote.paymentCurrency !== undefined) {
      paymentCurrency = existingQuote.paymentCurrency;
    } else if (request.paymentCurrency !== undefined) {
      paymentCurrency = request.paymentCurrency;
    } else {
      paymentCurrency = tokenChain === "bsc" ? "BNB" : "USDC";
    }

    if (discountBps < 0 || discountBps > MAX_DISCOUNT_BPS) {
      if (callback) {
        await callback({
          text: "❌ Invalid discount. Please specify a discount between 0% and 25%.",
          action: "QUOTE_ERROR",
        });
      }
      return { success: false };
    }

    const nativePriceUsd =
      paymentCurrency === "ETH"
        ? await getEthPriceUsd()
        : paymentCurrency === "BNB"
          ? await getBnbPriceUsd()
          : paymentCurrency === "SOL"
            ? await getSolPriceUsd()
            : 0;

    const now = Date.now();

    // Calculate agent commission based on discount and lockup
    const lockupDays = DEFAULT_MAX_LOCKUP_MONTHS * 30;
    const agentCommissionBps = calculateAgentCommission(
      discountBps,
      lockupDays,
    );

    // FAIL-FAST: tokenId and chain are required for quote creation
    if (!tokenId) {
      throw new Error("Cannot create quote without tokenId");
    }
    if (!tokenChain) {
      throw new Error("Cannot create quote without tokenChain");
    }

    // TypeScript now knows these are defined after the checks above
    const requiredTokenId: string = tokenId;
    const requiredTokenChain: "evm" | "solana" | "base" | "bsc" | "ethereum" =
      tokenChain;

    const quote = {
      tokenAmount: "0",
      discountBps,
      paymentCurrency,
      priceUsdPerToken: tokenPriceUsd, // From market data for display
      totalUsd: 0,
      discountedUsd: 0,
      createdAt: now,
      quoteId: "", // Will be generated by service
      apr: 0,
      lockupMonths: DEFAULT_MAX_LOCKUP_MONTHS, // Worst deal (12 months)
      paymentAmount: "0",
      // Token metadata - required fields
      tokenId: requiredTokenId,
      tokenSymbol: tokenSymbol,
      tokenName: tokenName,
      tokenLogoUrl: tokenLogoUrl || "",
      chain: requiredTokenChain,
      // Consignment ID (database UUID) - CRITICAL for accept flow
      consignmentId: consignment ? consignment.id : "",
      // Agent commission
      agentCommissionBps,
    };

    console.log("[CREATE_OTC_QUOTE] Creating quote with simple terms");
    const storedQuote = await setUserQuote(entityId, quote);
    const quoteId = storedQuote.quoteId;
    console.log("[CREATE_OTC_QUOTE] Quote created with ID:", quoteId);

    const xmlResponse = `
<quote>
  <quoteId>${quoteId}</quoteId>
  <tokenSymbol>${tokenSymbol}</tokenSymbol>
  <tokenName>${tokenName}</tokenName>
  ${tokenChain ? `<tokenChain>${tokenChain}</tokenChain>` : ""}
  ${tokenAddress ? `<tokenAddress>${tokenAddress}</tokenAddress>` : ""}
  ${consignment && consignment.id ? `<consignmentId>${consignment.id}</consignmentId>` : ""}
  <lockupMonths>${DEFAULT_MAX_LOCKUP_MONTHS}</lockupMonths>
  <lockupDays>${DEFAULT_MAX_LOCKUP_DAYS}</lockupDays>
  <pricePerToken>${tokenPriceUsd}</pricePerToken>
  <discountBps>${discountBps}</discountBps>
  <discountPercent>${(discountBps / 100).toFixed(2)}</discountPercent>
  <paymentCurrency>${paymentCurrency}</paymentCurrency>
  ${paymentCurrency === "ETH" ? `<ethPrice>${nativePriceUsd.toFixed(2)}</ethPrice>` : ""}
  ${paymentCurrency === "BNB" ? `<bnbPrice>${nativePriceUsd.toFixed(2)}</bnbPrice>` : ""}
  ${paymentCurrency === "SOL" ? `<solPrice>${nativePriceUsd.toFixed(2)}</solPrice>` : ""}
  <nativePrice>${nativePriceUsd.toFixed(2)}</nativePrice>
  <agentCommissionBps>${agentCommissionBps}</agentCommissionBps>
  <createdAt>${new Date(now).toISOString()}</createdAt>
  <status>created</status>
  <message>OTC quote terms generated. Token price: $${tokenPriceUsd.toFixed(8)}</message>
</quote>`;

    const textResponse = `I can offer a ${(discountBps / 100).toFixed(2)}% discount with a ${DEFAULT_MAX_LOCKUP_MONTHS}-month lockup.

📊 **Quote Terms: Discount: ${(discountBps / 100).toFixed(2)}% Lockup: ${DEFAULT_MAX_LOCKUP_MONTHS} months** (${DEFAULT_MAX_LOCKUP_DAYS} days)`;

    if (callback) {
      await callback({
        text:
          textResponse +
          "\n\n<!-- XML_START -->\n" +
          xmlResponse +
          "\n<!-- XML_END -->",
        action: "QUOTE_GENERATED",
        content: { xml: xmlResponse, quote, type: "otc_quote" } as Content,
      });
    }

    return { success: true };
  },

  examples: [],
};
