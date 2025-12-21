import otcArtifact from "@/contracts/artifacts/contracts/OTC.sol/OTC.json";
import { agentRuntime } from "@/lib/agent-runtime";
import { walletToEntityId } from "@/lib/entityId";
import QuoteService from "@/lib/plugin-otc-desk/services/quoteService";
import type { QuoteMemory } from "@/lib/plugin-otc-desk/types";
import {
  DealCompletionService,
  type PaymentCurrency,
} from "@/services/database";
import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, type Address, type Abi } from "viem";
import { Connection } from "@solana/web3.js";
import { getChain, getRpcUrl } from "@/lib/getChain";
import { getContractAddress } from "@/lib/getContractAddress";
import { getHeliusRpcUrl, getNetwork } from "@/config/env";
import {
  parseOrThrow,
  validationErrorResponse,
} from "@/lib/validation/helpers";
import {
  DealCompletionRequestSchema,
  DealCompletionResponseSchema,
} from "@/types/validation/api-schemas";
import { z } from "zod";
import { safeReadContract } from "@/lib/viem-utils";

export async function POST(request: NextRequest) {
  await agentRuntime.getRuntime();

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate request body - return 400 on invalid params
  const parseResult = DealCompletionRequestSchema.safeParse(body);
  if (!parseResult.success) {
    return validationErrorResponse(parseResult.error, 400);
  }
  const data = parseResult.data;

  const { quoteId, action, tokenId, consignmentId } = data;

  if (action === "complete") {
    if (consignmentId && tokenId) {
      const { PriceProtectionService } = await import(
        "@/services/priceProtection"
      );
      const { TokenDB } = await import("@/services/database");
      const { ConsignmentService } = await import(
        "@/services/consignmentService"
      );

      const priceProtection = new PriceProtectionService();
      const consignmentService = new ConsignmentService();
      const token = await TokenDB.getToken(tokenId);

      if (typeof body.priceAtQuote !== "number") {
        throw new Error(
          `priceAtQuote is required, got: ${typeof body.priceAtQuote}`,
        );
      }
      const priceAtQuote = body.priceAtQuote;
      if (typeof body.maxPriceDeviationBps !== "number") {
        throw new Error(
          `maxPriceDeviationBps is required, got: ${typeof body.maxPriceDeviationBps}`,
        );
      }
      const validationResult = await priceProtection.validateQuotePrice(
        tokenId,
        token.contractAddress,
        token.chain,
        priceAtQuote,
        body.maxPriceDeviationBps,
      );

      if (!validationResult.isValid) {
        return NextResponse.json(
          {
            error: "Price volatility exceeded maximum allowed",
            details: validationResult,
          },
          { status: 400 },
        );
      }

      await consignmentService.reserveAmount(consignmentId, body.tokenAmount);
      if (!body.beneficiary || typeof body.beneficiary !== "string") {
        throw new Error("beneficiary is required and must be a string");
      }
      if (typeof body.discountBps !== "number") {
        throw new Error("discountBps is required and must be a number");
      }
      if (typeof body.lockupDays !== "number") {
        throw new Error("lockupDays is required and must be a number");
      }
      await consignmentService.recordDeal({
        consignmentId,
        quoteId,
        tokenId,
        buyerAddress: body.beneficiary,
        amount: body.tokenAmount,
        discountBps: body.discountBps,
        lockupDays: body.lockupDays,
        offerId: body.offerId,
      });
    }

    const tokenAmountStr = String(body.tokenAmount);
    console.log("[DealCompletion] Received request:", {
      tokenAmount: body.tokenAmount,
      tokenAmountStr,
      paymentCurrency: body.paymentCurrency,
      chain: body.chain,
      offerId: body.offerId,
    });

    // Map SOL/BNB to ETH internally since database schema uses ETH/USDC
    const paymentCurrency: PaymentCurrency =
      body.paymentCurrency === "ETH" ||
      body.paymentCurrency === "SOL" ||
      body.paymentCurrency === "BNB"
        ? "ETH"
        : "USDC";
    // Optional fields - validate when required for specific paths
    const offerId = body.offerId ? String(body.offerId) : undefined;
    const transactionHash = body.transactionHash
      ? String(body.transactionHash)
      : undefined;
    const blockNumber =
      body.blockNumber !== undefined ? Number(body.blockNumber) : undefined;
    // FAIL-FAST: chain must be specified for deal completion
    if (!body.chain) {
      throw new Error("chain field is required for deal completion");
    }
    const chainType = body.chain;
    const offerAddress = body.offerAddress;
    const beneficiaryOverride = body.beneficiary; // Solana wallet address

    const runtime = agentRuntime.runtime;
    if (!runtime) {
      return NextResponse.json(
        { error: "Runtime not initialized" },
        { status: 500 },
      );
    }

    const quoteService = runtime.getService<QuoteService>("QuoteService");
    if (!quoteService) {
      return NextResponse.json(
        { error: "QuoteService not available" },
        { status: 500 },
      );
    }

    const quote = await quoteService.getQuoteByQuoteId(quoteId);

    // Update beneficiary AND entityId if provided (for Solana wallets)
    if (beneficiaryOverride) {
      const normalizedBeneficiary = beneficiaryOverride.toLowerCase();
      if (quote.beneficiary !== normalizedBeneficiary) {
        console.log("[DealCompletion] Updating beneficiary and entityId:", {
          oldBeneficiary: quote.beneficiary,
          newBeneficiary: normalizedBeneficiary,
          oldEntityId: quote.entityId,
        });

        // Update both beneficiary and entityId to match
        await quoteService.setQuoteBeneficiary(quoteId, normalizedBeneficiary);

        // Re-fetch to get updated quote
        const updatedQuote = await quoteService.getQuoteByQuoteId(quoteId);
        Object.assign(quote, updatedQuote);

        console.log(
          "[DealCompletion] Updated to new entityId:",
          quote.entityId,
        );
      }
    }

    let totalUsd = 0;
    let discountUsd = 0;
    let discountedUsd = 0;
    let actualPaymentAmount = "0";

    // Handle Solana deals (calculate from quote data, not contract)
    if (chainType === "solana") {
      console.log("[DealCompletion] Processing Solana deal:", {
        quoteId,
        offerId,
        offerAddress,
        tokenAmount: tokenAmountStr,
        transactionHash,
      });

      // Verify transaction on-chain
      if (!transactionHash) {
        throw new Error("Transaction hash required for Solana verification");
      }

      const network = getNetwork();
      const rpcUrl =
        network === "local" ? "http://127.0.0.1:8899" : getHeliusRpcUrl();
      console.log(`[Deal Completion] Using Helius RPC for Solana`);
      const connection = new Connection(rpcUrl, "confirmed");

      console.log(
        `[DealCompletion] Verifying Solana tx: ${transactionHash} on ${rpcUrl}`,
      );

      // Fetch transaction
      const tx = await connection.getTransaction(transactionHash, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });

      if (!tx) {
        throw new Error("Transaction not found or not confirmed");
      }

      // FAIL-FAST: Transaction must have succeeded
      if (!tx.meta) {
        throw new Error("Transaction missing metadata - cannot verify success");
      }
      if (tx.meta.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(tx.meta.err)}`);
      }

      console.log("[DealCompletion] ✅ Solana transaction verified on-chain");

      const tokenAmount = BigInt(tokenAmountStr);
      if (quote.discountBps === undefined) {
        throw new Error("quote.discountBps is required");
      }
      const discountBps = quote.discountBps;

      // Fetch real prices from market data and price feeds
      let tokenPrice = 0;
      let solPrice = 0;

      // Try to get actual token price from market data
      if (quote.tokenId) {
        const { MarketDataDB } = await import("@/services/database");
        const marketData = await MarketDataDB.getMarketData(quote.tokenId);
        // MarketData is optional - may not exist yet
        if (marketData) {
          // FAIL-FAST: If marketData exists, priceUsd should be valid
          if (
            typeof marketData.priceUsd !== "number" ||
            marketData.priceUsd <= 0
          ) {
            throw new Error(
              `MarketData exists for ${quote.tokenId} but has invalid priceUsd: ${marketData.priceUsd}`,
            );
          }
          tokenPrice = marketData.priceUsd;
          console.log(
            "[DealCompletion] Using market data token price:",
            tokenPrice,
          );
        }
      }

      // Fallback to quote's stored price if market data unavailable
      if (
        tokenPrice === 0 &&
        quote.priceUsdPerToken &&
        quote.priceUsdPerToken > 0
      ) {
        tokenPrice = quote.priceUsdPerToken;
        console.log(
          "[DealCompletion] Using quote stored token price:",
          tokenPrice,
        );
      }

      // Get SOL price from price feed API
      const { getSolPriceUsd } = await import(
        "@/lib/plugin-otc-desk/services/priceFeed"
      );
      solPrice = await getSolPriceUsd();
      console.log("[DealCompletion] Using SOL price from API:", solPrice);

      // Validate we have real prices
      if (tokenPrice === 0) {
        console.error(
          "[DealCompletion] CRITICAL: Token price is $0 - deal value cannot be calculated",
        );
        return NextResponse.json(
          {
            error:
              "Token price unavailable - please ensure token has market data",
          },
          { status: 400 },
        );
      }
      if (body.paymentCurrency === "SOL" && solPrice === 0) {
        console.error(
          "[DealCompletion] CRITICAL: SOL price is $0 - cannot calculate SOL payment",
        );
        return NextResponse.json(
          { error: "SOL price unavailable - please try again later" },
          { status: 400 },
        );
      }

      // Calculate values
      totalUsd = Number(tokenAmount) * tokenPrice;
      discountUsd = totalUsd * (discountBps / 10000);
      discountedUsd = totalUsd - discountUsd;

      // Payment amount based on currency
      if (body.paymentCurrency === "SOL") {
        actualPaymentAmount = (discountedUsd / solPrice).toFixed(6);
      } else {
        actualPaymentAmount = discountedUsd.toFixed(2);
      }

      console.log("[DealCompletion] Calculated Solana deal values:", {
        tokenPrice,
        solPrice,
        totalUsd,
        discountUsd,
        discountedUsd,
        actualPaymentAmount,
      });
    } else if (offerId && offerId !== "0") {
      // Fetch on-chain data for EVM deals
      // Use chain-specific contract address based on NETWORK env var
      const OTC_ADDRESS = getContractAddress();

      const chain = getChain();
      const RPC_URL = getRpcUrl();

      console.log("[DealCompletion] Fetching on-chain data:", {
        offerId,
        OTC_ADDRESS,
        RPC_URL,
        // NETWORK env var is optional - default to "localnet" if not set
        network: process.env.NETWORK ?? "localnet",
      });

      const publicClient = createPublicClient({
        chain,
        transport: http(RPC_URL),
      });
      const abi = otcArtifact.abi as Abi;

      type OfferData = [
        bigint, // consignmentId
        string, // tokenId (bytes32)
        Address, // beneficiary
        bigint, // tokenAmount
        bigint, // discountBps
        bigint, // createdAt
        bigint, // unlockTime
        bigint, // priceUsdPerToken
        bigint, // maxPriceDeviation
        bigint, // ethUsdPrice
        number, // currency
        boolean, // approved
        boolean, // paid
        boolean, // fulfilled
        boolean, // cancelled
        Address, // payer
        bigint, // amountPaid
      ];
      const offerData = await safeReadContract<OfferData>(publicClient, {
        address: OTC_ADDRESS,
        abi,
        functionName: "offers",
        args: [BigInt(offerId)],
      });

      // Contract returns array matching struct order
      // FAIL-FAST: Validate array has expected length
      if (offerData.length < 17) {
        throw new Error(
          `Invalid offer data structure: expected 17 fields, got ${offerData.length}`,
        );
      }
      const [
        ,
        ,
        ,
        // consignmentId
        // tokenId
        // beneficiary
        tokenAmount,
        discountBps, // createdAt
        ,
        ,
        // unlockTime
        priceUsdPerToken, // maxPriceDeviation
        ,
        ,
        // ethUsdPrice
        currency, // approved
        ,
        paid, // fulfilled
        ,
        ,
        ,
        // cancelled
        // payer
        amountPaid,
      ] = offerData;

      // FAIL-FAST: Required fields must exist
      if (tokenAmount == null) {
        throw new Error("Offer data missing tokenAmount");
      }
      if (priceUsdPerToken == null) {
        throw new Error("Offer data missing priceUsdPerToken");
      }
      if (discountBps == null) {
        throw new Error("Offer data missing discountBps");
      }
      if (amountPaid == null) {
        throw new Error("Offer data missing amountPaid");
      }

      console.log("[DealCompletion] Offer data from contract:", {
        tokenAmount: tokenAmount.toString(),
        priceUsdPerToken: priceUsdPerToken.toString(),
        discountBps: discountBps.toString(),
        amountPaid: amountPaid.toString(),
        currency,
        paid,
      });

      // Calculate real USD values from on-chain data
      // tokenAmount is 18 decimals, priceUsdPerToken is 8 decimals
      const tokenAmountWei = BigInt(tokenAmount);
      const priceUsd8 = BigInt(priceUsdPerToken);
      const discountBpsNum = Number(discountBps);
      const amountPaidBig = BigInt(amountPaid);

      // totalUsd = (tokenAmount * priceUsdPerToken) / 1e18 (result in 8 decimals)
      const totalUsd8 = (tokenAmountWei * priceUsd8) / BigInt(1e18);
      totalUsd = Number(totalUsd8) / 1e8;

      // discountUsd = totalUsd * discountBps / 10000
      const discountUsd8 = (totalUsd8 * BigInt(discountBpsNum)) / 10000n;
      discountUsd = Number(discountUsd8) / 1e8;

      // discountedUsd = totalUsd - discountUsd
      const discountedUsd8 = totalUsd8 - discountUsd8;
      discountedUsd = Number(discountedUsd8) / 1e8;

      // Format payment amount based on currency
      if (currency === 0) {
        // ETH (18 decimals)
        actualPaymentAmount = (Number(amountPaidBig) / 1e18).toFixed(6);
      } else {
        // USDC (6 decimals)
        actualPaymentAmount = (Number(amountPaidBig) / 1e6).toFixed(2);
      }

      console.log("[DealCompletion] Calculated from on-chain data:", {
        totalUsd,
        discountUsd,
        discountedUsd,
        actualPaymentAmount,
      });
    } else {
      // No offerId, use quote values
      if (typeof quote.discountBps !== "number") {
        throw new Error("Quote missing discountBps");
      }
      const discountBps = quote.discountBps;
      if (typeof quote.totalUsd !== "number") {
        throw new Error(
          "Quote missing totalUsd - cannot complete deal without offerId",
        );
      }
      totalUsd = quote.totalUsd;
      if (typeof quote.discountUsd === "number") {
        discountUsd = quote.discountUsd;
      } else {
        discountUsd = totalUsd * (discountBps / 10000);
      }
      if (typeof quote.discountedUsd === "number") {
        discountedUsd = quote.discountedUsd;
      } else {
        discountedUsd = totalUsd - discountUsd;
      }
      if (!quote.paymentAmount || typeof quote.paymentAmount !== "string") {
        throw new Error(
          "Quote missing paymentAmount - cannot complete deal without offerId",
        );
      }
      actualPaymentAmount = quote.paymentAmount;
    }

    // VALIDATE before saving
    if (!tokenAmountStr || tokenAmountStr === "0") {
      console.warn(
        `[DealCompletion] tokenAmount is ${tokenAmountStr} - quote: ${quoteId}`,
      );
      // For old quotes, skip validation and just return current state
      if (quote.status === "executed") {
        console.log(
          "[DealCompletion] Quote already executed, returning current state",
        );
        const alreadyExecutedResponse = {
          success: true,
          quoteId: quote.quoteId,
        };
        const validatedAlreadyExecuted = DealCompletionResponseSchema.parse(
          alreadyExecutedResponse,
        );
        return NextResponse.json(validatedAlreadyExecuted);
      }
      throw new Error(
        `CRITICAL: tokenAmount is ${tokenAmountStr} - must be > 0`,
      );
    }
    if (totalUsd === 0 && chainType === "solana") {
      console.warn(
        `[DealCompletion] Solana deal has $0 value - quote: ${quoteId}`,
      );
      if (quote.status === "executed") {
        console.log(
          "[DealCompletion] Quote already executed, returning current state",
        );
        const alreadyExecutedResponse = {
          success: true,
          quoteId: quote.quoteId,
        };
        const validatedAlreadyExecuted = DealCompletionResponseSchema.parse(
          alreadyExecutedResponse,
        );
        return NextResponse.json(validatedAlreadyExecuted);
      }
      throw new Error("CRITICAL: Solana deal has $0 value");
    }

    // Calculate priceUsdPerToken from totalUsd / tokenAmount
    const tokenAmountNum = parseFloat(tokenAmountStr);
    const priceUsdPerToken = tokenAmountNum > 0 ? totalUsd / tokenAmountNum : 0;

    console.log("[DealCompletion] Calling updateQuoteExecution with:", {
      quoteId,
      tokenAmount: tokenAmountStr,
      totalUsd,
      discountUsd,
      discountedUsd,
      paymentCurrency,
      paymentAmount: actualPaymentAmount,
      offerId,
      priceUsdPerToken,
      lockupDays: body.lockupDays,
    });

    // FAIL-FAST: Required fields for updateQuoteExecution
    if (!offerId) {
      throw new Error("offerId is required for updateQuoteExecution");
    }
    if (!transactionHash) {
      throw new Error("transactionHash is required for updateQuoteExecution");
    }
    if (blockNumber == null) {
      throw new Error("blockNumber is required for updateQuoteExecution");
    }

    const updated = await quoteService.updateQuoteExecution(quoteId, {
      tokenAmount: tokenAmountStr,
      totalUsd,
      discountUsd,
      discountedUsd,
      paymentCurrency,
      paymentAmount: actualPaymentAmount,
      offerId,
      transactionHash,
      blockNumber,
      priceUsdPerToken,
      lockupDays: body.lockupDays,
    });

    // VERIFY status changed
    if (updated.status !== "executed") {
      throw new Error(
        `CRITICAL: Status is ${updated.status}, expected executed`,
      );
    }

    // Store chain type for proper currency display
    const updatedWithChain = {
      ...updated,
      chain: chainType === "solana" ? "solana" : "evm",
    };
    await runtime.setCache(`quote:${quoteId}`, updatedWithChain);

    // VERIFY quote is in entity's list, and fix index if missing
    const entityQuotesCache = await runtime.getCache<string[]>(
      `entity_quotes:${updated.entityId}`,
    );
    // entityQuotes is optional - default to empty array if not present
    const entityQuotes = Array.isArray(entityQuotesCache)
      ? entityQuotesCache
      : [];
    if (!entityQuotes.includes(quoteId)) {
      console.warn(
        `[Deal Completion] Quote ${quoteId} not in entity ${updated.entityId} list - fixing index`,
      );
      entityQuotes.push(quoteId);
      await runtime.setCache(`entity_quotes:${updated.entityId}`, entityQuotes);

      // Also ensure it's in the all_quotes index
      const allQuotesCache = await runtime.getCache<string[]>("all_quotes");
      const allQuotes = Array.isArray(allQuotesCache) ? allQuotesCache : [];
      if (!allQuotes.includes(quoteId)) {
        allQuotes.push(quoteId);
        await runtime.setCache("all_quotes", allQuotes);
      }
      console.log(`[Deal Completion] ✅ Fixed indexes for quote ${quoteId}`);
    }

    console.log("[Deal Completion] ✅ VERIFIED and completed:", {
      entityId: quote.entityId,
      quoteId,
      tokenAmount: updated.tokenAmount,
      status: updated.status,
      inEntityList: true,
      discountBps: quote.discountBps,
      finalPrice: discountedUsd,
    });

    const completeResponse = { success: true, quoteId: updated.quoteId };
    const validatedComplete =
      DealCompletionResponseSchema.parse(completeResponse);
    return NextResponse.json(validatedComplete);
  }

  if (action === "share") {
    const shareRuntime = agentRuntime.runtime;
    if (!shareRuntime) {
      return NextResponse.json(
        { error: "Runtime not initialized" },
        { status: 500 },
      );
    }
    const shareQuoteService =
      shareRuntime.getService<QuoteService>("QuoteService");
    if (!shareQuoteService) {
      return NextResponse.json(
        { error: "QuoteService not available" },
        { status: 500 },
      );
    }
    const quote = await shareQuoteService.getQuoteByQuoteId(quoteId);
    if (!quote) {
      return NextResponse.json({ error: "Quote not found" }, { status: 404 });
    }
    const shareData = await DealCompletionService.generateShareData(quoteId);

    // platform is optional - default to "general" if not provided
    const platform = body.platform?.trim() || "general";
    console.log("[Deal Completion] Deal shared", {
      quoteId,
      platform,
    });

    const shareResponse = { success: true, quoteId, shareData };
    const validatedShare = DealCompletionResponseSchema.parse(shareResponse);
    return NextResponse.json(validatedShare);
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

export async function GET(request: NextRequest) {
  await agentRuntime.getRuntime();

  const { searchParams } = new URL(request.url);
  const wallet = searchParams.get("wallet");

  if (!wallet) {
    return NextResponse.json({ error: "wallet required" }, { status: 400 });
  }

  const entityId = walletToEntityId(wallet);
  const normalizedWallet = wallet.toLowerCase();
  console.log("[Deal Completion GET] Querying deals:", {
    wallet,
    normalizedWallet,
    entityId,
  });

  const getRuntime = agentRuntime.runtime;
  if (!getRuntime) {
    console.warn("[Deal Completion GET] Runtime not ready");
    return NextResponse.json({
      success: true,
      deals: [],
    });
  }

  const quoteService = getRuntime.getService<QuoteService>("QuoteService");
  if (!quoteService) {
    console.warn("[Deal Completion GET] QuoteService not ready");
    return NextResponse.json({
      success: true,
      deals: [],
    });
  }

  // Get quotes by entityId
  const quotes = await quoteService.getUserQuoteHistory(entityId, 100);
  console.log("[Deal Completion GET] Got quotes by entityId:", quotes.length);

  // ALSO search by beneficiary address (for quotes indexed under wrong entityId)
  // Use beneficiary index if available, otherwise do a limited parallel search
  const beneficiaryQuoteIds = await getRuntime.getCache<string[]>(
    `beneficiary_quotes:${normalizedWallet}`,
  );
  const quotesSet = new Set(quotes.map((q) => q.quoteId));

  if (beneficiaryQuoteIds) {
    // Fast path: use beneficiary index
    const additionalQuotes = await Promise.all(
      beneficiaryQuoteIds
        .filter((id) => !quotesSet.has(id))
        .map((id) => getRuntime.getCache<QuoteMemory>(`quote:${id}`)),
    );
    for (const quote of additionalQuotes) {
      if (quote) quotes.push(quote);
    }
  } else {
    // Slow path fallback: parallel search (limited to 50 for performance)
    const allQuoteIds = await getRuntime.getCache<string[]>("all_quotes");
    // allQuoteIds is optional - default to empty array if not present
    const idsToCheck = (Array.isArray(allQuoteIds) ? allQuoteIds : [])
      .filter((id) => !quotesSet.has(id))
      .slice(0, 50);

    if (idsToCheck.length > 0) {
      const additionalQuotes = await Promise.all(
        idsToCheck.map((id) => getRuntime.getCache<QuoteMemory>(`quote:${id}`)),
      );
      for (const quote of additionalQuotes) {
        if (quote && quote.beneficiary === normalizedWallet) {
          quotes.push(quote);
        }
      }
    }
  }

  console.log("[Deal Completion GET] Total quotes found:", quotes.length);

  // Show active, approved, and executed deals
  // active = quote created, approved = offer created/approved on-chain, executed = paid/fulfilled
  const deals = quotes.filter(
    (quote) =>
      quote.status === "executed" ||
      quote.status === "active" ||
      quote.status === "approved",
  );
  console.log(
    "[Deal Completion GET] Filtered deals (active + approved + executed):",
    deals.length,
  );

  // Enrich deals with token metadata - batch fetch to avoid N+1 queries
  const { TokenDB, ConsignmentDB } = await import("@/services/database");

  // Collect unique IDs that need fetching
  const consignmentIdsToFetch = new Set<string>();
  const tokenIdsToFetch = new Set<string>();

  for (const deal of deals) {
    const quoteData = deal as QuoteMemory;
    if (!quoteData.tokenId && quoteData.consignmentId) {
      consignmentIdsToFetch.add(quoteData.consignmentId);
    }
    // FAIL-FAST: If tokenId exists, both symbol and name should exist
    if (quoteData.tokenId) {
      const hasSymbol =
        typeof quoteData.tokenSymbol === "string" &&
        quoteData.tokenSymbol.trim() !== "";
      const hasName =
        typeof quoteData.tokenName === "string" &&
        quoteData.tokenName.trim() !== "";
      if (!hasSymbol || !hasName) {
        tokenIdsToFetch.add(quoteData.tokenId);
      }
    }
  }

  // Batch fetch consignments and tokens in parallel
  const [consignmentResults, tokenResults] = await Promise.all([
    Promise.all(
      [...consignmentIdsToFetch].map(async (id) => {
        const consignment = await ConsignmentDB.getConsignment(id);
        return { id, data: consignment };
      }),
    ),
    Promise.all(
      [...tokenIdsToFetch].map(async (id) => {
        const token = await TokenDB.getToken(id);
        return { id, data: token };
      }),
    ),
  ]);

  // Build lookup maps
  const consignmentMap = new Map(consignmentResults.map((r) => [r.id, r.data]));
  const tokenMap = new Map(tokenResults.map((r) => [r.id, r.data]));

  // Also add tokens found via consignments
  for (const result of consignmentResults) {
    if (
      result.data &&
      result.data.tokenId &&
      !tokenMap.has(result.data.tokenId)
    ) {
      tokenIdsToFetch.add(result.data.tokenId);
    }
  }

  // Fetch any additional tokens found via consignments
  if (tokenIdsToFetch.size > tokenMap.size) {
    const additionalTokenIds = [...tokenIdsToFetch].filter(
      (id) => !tokenMap.has(id),
    );
    const additionalTokens = await Promise.all(
      additionalTokenIds.map(async (id) => {
        const token = await TokenDB.getToken(id);
        return { id, data: token };
      }),
    );
    for (const { id, data } of additionalTokens) {
      tokenMap.set(id, data);
    }
  }

  // Enrich deals using pre-fetched data
  const enrichedDeals = deals.map((deal) => {
    const quoteData = deal as QuoteMemory;
    let tokenSymbol = quoteData.tokenSymbol;
    let tokenName = quoteData.tokenName;
    let tokenLogoUrl = quoteData.tokenLogoUrl;
    let tokenId = quoteData.tokenId;
    let chain: string | undefined = deal.chain;
    const consignmentId = quoteData.consignmentId;

    // If quote doesn't have token metadata, try consignment lookup
    if (!tokenId && consignmentId) {
      const consignment = consignmentMap.get(consignmentId);
      if (consignment) {
        tokenId = consignment.tokenId;
        chain = consignment.chain;
      }
    }

    // Look up token by tokenId if we still need metadata
    if (tokenId) {
      const hasSymbol =
        typeof tokenSymbol === "string" && tokenSymbol.trim() !== "";
      const hasName = typeof tokenName === "string" && tokenName.trim() !== "";
      if (!hasSymbol || !hasName) {
        const token = tokenMap.get(tokenId);
        if (token) {
          // FAIL-FAST: Token metadata must exist if token is found
          if (!token.symbol) {
            throw new Error(`Token ${tokenId} missing symbol in database`);
          }
          if (!token.name) {
            throw new Error(`Token ${tokenId} missing name in database`);
          }
          // Use token data as fallback if not already set
          // token.symbol and token.name are guaranteed to exist (validated above)
          tokenSymbol = tokenSymbol?.trim() || token.symbol;
          tokenName = tokenName?.trim() || token.name;
          // logoUrl is optional - use existing or token's logoUrl (can be empty string)
          tokenLogoUrl = tokenLogoUrl?.trim() || token.logoUrl || "";
        }
      }
    }

    // FAIL-FAST: tokenSymbol and tokenName are required for display
    // QuoteMemory schema requires these fields, and deal-completion enriches them
    const dealId = deal.quoteId ?? deal.id ?? "unknown";
    if (!tokenSymbol) {
      throw new Error(`Deal ${dealId} missing tokenSymbol - cannot display`);
    }
    if (!tokenName) {
      throw new Error(`Deal ${dealId} missing tokenName - cannot display`);
    }

    return {
      ...deal,
      tokenSymbol,
      tokenName,
      tokenLogoUrl,
      tokenId,
      chain,
      consignmentId,
    };
  });

  // Cache for 30 seconds - deals change infrequently but should be reasonably fresh
  return NextResponse.json(
    { success: true, deals: enrichedDeals },
    {
      headers: {
        "Cache-Control": "private, s-maxage=30, stale-while-revalidate=60",
      },
    },
  );
}
