/**
 * Utility to parse XML from agent messages
 */

import type { Chain, OTCQuote, QuoteAccepted } from "@/types";

// Re-export types for consumers
export type { OTCQuote, QuoteAccepted } from "@/types";

/**
 * Extract XML from message text
 */
export function extractXMLFromMessage(messageText: string): string | null {
  // Try to find XML between comment markers first
  const commentMatch = messageText.match(/<!-- XML_START -->([\s\S]*?)<!-- XML_END -->/);
  if (commentMatch?.[1]) {
    return commentMatch[1].trim();
  }

  // Try to find quote XML (supports lower and PascalCase)
  const quoteMatch = messageText.match(/<(quote|Quote)>([\s\S]*?)<\/(quote|Quote)>/);
  if (quoteMatch?.[0]) {
    return quoteMatch[0];
  }

  // Try to find quoteAccepted XML (supports lower and PascalCase)
  const acceptedMatch = messageText.match(
    /<(quoteAccepted|QuoteAccepted)>([\s\S]*?)<\/(quoteAccepted|QuoteAccepted)>/,
  );
  if (acceptedMatch?.[0]) {
    return acceptedMatch[0];
  }

  return null;
}

/**
 * Parse quote from XML
 */
export function parseOTCQuoteXML(xmlString: string): OTCQuote | null {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlString, "text/xml");

  // Check for parsing errors
  const parseError = xmlDoc.querySelector("parsererror");
  if (parseError) {
    console.error("XML parsing error:", parseError.textContent);
    return null;
  }

  const getElementText = (tagName: string): string => {
    const elem = xmlDoc.getElementsByTagName(tagName)[0];
    return elem ? elem.textContent || "" : "";
  };

  const getElementNumber = (tagName: string): number => {
    const text = getElementText(tagName);
    return text ? parseFloat(text) : 0;
  };

  // Support both lowercase and PascalCase root tags
  const rootTag = xmlDoc.querySelector("Quote") || xmlDoc.querySelector("quote");
  if (!rootTag) {
    console.error("No quote root element found");
    return null;
  }

  const tokenChainRaw = getElementText("tokenChain") || getElementText("chain");
  // Default to "base" if no chain specified - quotes require a chain
  const tokenChain: Chain = (
    tokenChainRaw && ["ethereum", "base", "bsc", "solana"].includes(tokenChainRaw)
      ? tokenChainRaw
      : "base"
  ) as Chain;

  // FAIL-FAST: Required fields must be present
  const quoteId = getElementText("quoteId");
  const tokenAmount = getElementText("tokenAmount");
  const tokenSymbol = getElementText("tokenSymbol");

  if (!quoteId) {
    throw new Error("Quote XML missing required quoteId field");
  }
  if (!tokenAmount) {
    throw new Error("Quote XML missing required tokenAmount field");
  }
  if (!tokenSymbol) {
    throw new Error("Quote XML missing required tokenSymbol field");
  }

  return {
    quoteId,
    tokenAmount,
    tokenAmountFormatted: getElementText("tokenAmountFormatted"),
    tokenSymbol,
    tokenChain,
    // Optional field - return undefined if empty string
    tokenAddress: (() => {
      const addr = getElementText("tokenAddress");
      return addr !== "" ? addr : undefined;
    })(),
    apr: getElementNumber("apr"),
    lockupMonths: getElementNumber("lockupMonths"),
    lockupDays: getElementNumber("lockupDays"),
    // pricePerToken can come from either field name (LLM may use either)
    pricePerToken: (() => {
      const pricePerToken = getElementNumber("pricePerToken");
      const priceUsdPerToken = getElementNumber("priceUsdPerToken");
      // Return first available value, or undefined if neither exists (optional field)
      return pricePerToken !== 0
        ? pricePerToken
        : priceUsdPerToken !== 0
          ? priceUsdPerToken
          : undefined;
    })(),
    totalValueUsd: getElementNumber("totalValueUsd"),
    // FAIL-FAST: discountBps is required
    discountBps: (() => {
      const text = getElementText("discountBps");
      if (text === "") {
        throw new Error("Quote XML missing required discountBps field");
      }
      const value = parseFloat(text);
      if (Number.isNaN(value)) {
        throw new Error(`Quote XML has invalid discountBps value: ${text}`);
      }
      return value;
    })(),
    discountPercent: getElementNumber("discountPercent"),
    discountUsd: getElementNumber("discountUsd"),
    finalPriceUsd: (() => {
      const finalPriceUsd = getElementNumber("finalPriceUsd");
      const discountedUsd = getElementNumber("discountedUsd");
      // Return first available value, or undefined if neither exists (optional field)
      return finalPriceUsd !== 0 ? finalPriceUsd : discountedUsd !== 0 ? discountedUsd : undefined;
    })(),
    // FAIL-FAST: paymentCurrency is required
    paymentCurrency: (() => {
      const currency = getElementText("paymentCurrency");
      if (!currency) {
        throw new Error("Quote XML missing required paymentCurrency field");
      }
      return currency;
    })(),
    paymentAmount: getElementText("paymentAmount"), // Optional
    paymentSymbol: getElementText("paymentSymbol"), // Optional
    // Optional fields - return undefined if 0 (not set)
    ethPrice: (() => {
      const price = getElementNumber("ethPrice");
      return price !== 0 ? price : undefined;
    })(),
    bnbPrice: (() => {
      const price = getElementNumber("bnbPrice");
      return price !== 0 ? price : undefined;
    })(),
    // nativePrice can come from multiple field names (LLM may use any)
    // Return first available non-zero value, or undefined if none exist (optional field)
    nativePrice: (() => {
      const nativePrice = getElementNumber("nativePrice");
      const ethPrice = getElementNumber("ethPrice");
      const bnbPrice = getElementNumber("bnbPrice");
      // Return first non-zero value (0 means field was missing)
      if (nativePrice !== 0) return nativePrice;
      if (ethPrice !== 0) return ethPrice;
      if (bnbPrice !== 0) return bnbPrice;
      return undefined;
    })(),
    createdAt: getElementText("createdAt"),
    // Optional fields - return undefined if empty/0
    status: (() => {
      const s = getElementText("status");
      return s !== "" ? s : undefined;
    })(),
    message: getElementText("message"),
    consignmentId: (() => {
      const id = getElementText("consignmentId");
      return id !== "" ? id : undefined;
    })(),
    agentCommissionBps: (() => {
      const bps = getElementNumber("agentCommissionBps");
      return bps !== 0 ? bps : undefined;
    })(),
  };
}

/**
 * Parse quote accepted XML
 */
export function parseQuoteAcceptedXML(xmlString: string): QuoteAccepted | null {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlString, "text/xml");

  // Check for parsing errors
  const parseError = xmlDoc.querySelector("parsererror");
  if (parseError) {
    console.error("XML parsing error:", parseError.textContent);
    return null;
  }

  const getElementText = (tagName: string): string => {
    const elem = xmlDoc.getElementsByTagName(tagName)[0];
    return elem ? elem.textContent || "" : "";
  };

  const getElementNumber = (tagName: string): number => {
    const text = getElementText(tagName);
    return text ? parseFloat(text) : 0;
  };

  return {
    quoteId: getElementText("quoteId"),
    offerId: getElementText("offerId"),
    transactionHash: getElementText("transactionHash"),
    tokenAmount: getElementText("tokenAmount"),
    tokenAmountFormatted: getElementText("tokenAmountFormatted"),
    tokenSymbol: getElementText("tokenSymbol"),
    tokenName: getElementText("tokenName"),
    paidAmount: getElementText("paidAmount"),
    paymentCurrency: getElementText("paymentCurrency"),
    discountBps: getElementNumber("discountBps"),
    discountPercent: getElementNumber("discountPercent"),
    totalSaved: getElementText("totalSaved"),
    finalPrice: getElementText("finalPrice"),
    status: getElementText("status"),
    timestamp: getElementText("timestamp"),
    message: getElementText("message"),
  };
}

/**
 * Check if message contains a quote
 */
export function messageContainsQuote(messageText: string): boolean {
  return !!(
    messageText.includes("<quote>") ||
    messageText.includes("<quote>") ||
    messageText.includes("<quoteAccepted>") ||
    messageText.includes("<!-- XML_START -->")
  );
}

/**
 * Parse any XML type from message
 */
export function parseMessageXML(messageText: string): {
  type: "otc_quote" | "quote_accepted" | null;
  data: OTCQuote | QuoteAccepted | null;
} {
  const xmlString = extractXMLFromMessage(messageText);

  if (!xmlString) {
    return { type: null, data: null };
  }

  // Try parsing as quote
  if (xmlString.match(/<(quote|Quote)>/)) {
    const quote = parseOTCQuoteXML(xmlString);
    if (quote) {
      return { type: "otc_quote", data: quote };
    }
  }

  // Try parsing as quote accepted
  if (xmlString.match(/<(quoteAccepted|QuoteAccepted)>/)) {
    const accepted = parseQuoteAcceptedXML(xmlString);
    if (accepted) {
      return { type: "quote_accepted", data: accepted };
    }
  }

  return { type: null, data: null };
}
