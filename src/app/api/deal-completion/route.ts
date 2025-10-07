import { agentRuntime } from "@/lib/agent-runtime";
import { walletToEntityId } from "@/lib/entityId";
import QuoteService from "@/lib/plugin-otc-desk/services/quoteService";
import {
  DealCompletionService,
  type PaymentCurrency,
} from "@/services/database";
import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, type Address } from "viem";
import { hardhat, baseSepolia } from "viem/chains";
import otcArtifact from "@/contracts/artifacts/contracts/OTC.sol/OTC.json";

function getChain() {
  const network = process.env.NEXT_PUBLIC_NETWORK || "hardhat";
  if (network === "base-sepolia") return baseSepolia;
  return hardhat;
}

export async function POST(request: NextRequest) {
  await agentRuntime.getRuntime();

  const body = await request.json();
  const { quoteId, action } = body;

  if (!quoteId) {
    return NextResponse.json(
      { error: "Quote ID is required" },
      { status: 400 },
    );
  }

  if (action === "complete") {
    const tokenAmountStr = String(body.tokenAmount);
    const paymentCurrency: PaymentCurrency =
      body.paymentCurrency === "ETH" ? "ETH" : "USDC";
    const offerId = String(body.offerId || "");
    const transactionHash = String(body.transactionHash || "");
    const blockNumber = Number(body.blockNumber || 0);

    const quoteService =
      agentRuntime.runtime.getService<QuoteService>("QuoteService");

    const quote = await quoteService.getQuoteByQuoteId(quoteId);

    let totalUsd = 0;
    let discountUsd = 0;
    let discountedUsd = 0;
    let actualPaymentAmount = "0";

    // Fetch on-chain data if offerId is provided
    if (offerId && offerId !== "0") {
      try {
        const OTC_ADDRESS = process.env.NEXT_PUBLIC_OTC_ADDRESS as Address;
        if (OTC_ADDRESS) {
          const chain = getChain();
          const publicClient = createPublicClient({ chain, transport: http() });
          const abi = otcArtifact.abi as any;

          const offer = (await publicClient.readContract({
            address: OTC_ADDRESS,
            abi,
            functionName: "offers",
            args: [BigInt(offerId)],
          } as any)) as any;

          // Calculate real USD values from on-chain data
          // tokenAmount is 18 decimals, priceUsdPerToken is 8 decimals
          const tokenAmountWei = BigInt(offer.tokenAmount);
          const priceUsd8 = BigInt(offer.priceUsdPerToken);
          const discountBps = Number(offer.discountBps);
          const amountPaid = BigInt(offer.amountPaid);

          // totalUsd = (tokenAmount * priceUsdPerToken) / 1e18 (result in 8 decimals)
          const totalUsd8 = (tokenAmountWei * priceUsd8) / BigInt(1e18);
          totalUsd = Number(totalUsd8) / 1e8;

          // discountUsd = totalUsd * discountBps / 10000
          const discountUsd8 = (totalUsd8 * BigInt(discountBps)) / 10000n;
          discountUsd = Number(discountUsd8) / 1e8;

          // discountedUsd = totalUsd - discountUsd
          const discountedUsd8 = totalUsd8 - discountUsd8;
          discountedUsd = Number(discountedUsd8) / 1e8;

          // Format payment amount based on currency
          if (offer.currency === 0) {
            // ETH (18 decimals)
            actualPaymentAmount = (Number(amountPaid) / 1e18).toFixed(6);
          } else {
            // USDC (6 decimals)
            actualPaymentAmount = (Number(amountPaid) / 1e6).toFixed(2);
          }

          console.log("[DealCompletion] Calculated from on-chain data:", {
            totalUsd,
            discountUsd,
            discountedUsd,
            actualPaymentAmount,
          });
        }
      } catch (error) {
        console.error(
          "[DealCompletion] Failed to fetch on-chain data:",
          error,
        );
        // Fall back to quote values
        totalUsd = quote.totalUsd || 0;
        discountUsd = quote.discountUsd || 0;
        discountedUsd = quote.discountedUsd || 0;
      }
    } else {
      // No offerId, use quote values (fallback)
      const discountBps = quote.discountBps;
      totalUsd = quote.totalUsd || 0;
      discountUsd = quote.discountUsd || totalUsd * (discountBps / 10000);
      discountedUsd = quote.discountedUsd || totalUsd - discountUsd;
      actualPaymentAmount = quote.paymentAmount || "0";
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
    });

    console.log("[Deal Completion] Deal completed", {
      entityId: quote.entityId,
      quoteId,
      tokenAmount: tokenAmountStr,
      discountBps: quote.discountBps,
      finalPrice: discountedUsd,
      transactionHash,
    });

    return NextResponse.json({ success: true, quote: updated });
  }

  if (action === "share") {
    const quoteService =
      agentRuntime.runtime.getService<QuoteService>("QuoteService");
    const quote = await quoteService.getQuoteByQuoteId(quoteId);
    if (!quote) {
      return NextResponse.json({ error: "Quote not found" }, { status: 404 });
    }
    const shareData = await DealCompletionService.generateShareData(quoteId);

    console.log("[Deal Completion] Deal shared", {
      quoteId,
      platform: body.platform || "general",
    });

    return NextResponse.json({ success: true, shareData });
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
  const quoteService =
    agentRuntime.runtime.getService<QuoteService>("QuoteService");
  const quotes = await quoteService.getUserQuoteHistory(entityId, 100);
  const completedDeals = quotes.filter((quote) => quote.status === "executed");

  return NextResponse.json({
    success: true,
    deals: completedDeals,
  });
}
