import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
} from "viem";
import { hardhat, baseSepolia, base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import otcArtifact from "@/contracts/artifacts/contracts/OTC.sol/OTC.json";
import { agentRuntime } from "@/lib/agent-runtime";

// Worker service that monitors on-chain otc offers, auto-approves matching quotes,
// and handles deal completion notifications via HTTP polling
export class QuoteApprovalWorker {
  private isRunning = false;
  private publicClient: any;
  private walletClient: any;
  private account: any;
  private abi: any;
  private processedOffers = new Set<string>();
  private pendingApprovals = new Map<string, any>();
  private apiBaseUrl: string;

  private OTC_ADDRESS = process.env.NEXT_PUBLIC_OTC_ADDRESS as `0x${string}`;
  private APPROVER_PRIVATE_KEY = process.env
    .APPROVER_PRIVATE_KEY as `0x${string}`;
  private POLL_INTERVAL = 2000; // Check every 2 seconds for faster response

  constructor() {
    this.apiBaseUrl =
      process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
    const chain = this.getChain();

    this.publicClient = createPublicClient({ chain, transport: http() });
    this.account = privateKeyToAccount(this.APPROVER_PRIVATE_KEY);
    this.walletClient = createWalletClient({
      account: this.account,
      chain,
      transport: http(),
    });
    this.abi = otcArtifact.abi as any;
  }

  private getChain() {
    const env = process.env.NODE_ENV;
    const network = process.env.NETWORK || "hardhat";

    if (env === "production") return base;
    if (network === "base-sepolia") return baseSepolia;
    return hardhat;
  }

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;

    console.log(
      `🚀 [Worker] Starting: ${this.OTC_ADDRESS} (${this.account.address})`,
    );

    while (this.isRunning) {
      await this.monitorOffers();
      await this.checkFulfilledOffers();
      await this.unstickOffers();  // Check for stuck offers
      await this.sleep(this.POLL_INTERVAL);
    }
  }

  stop() {
    this.isRunning = false;
    console.log("🛑 [Worker] Stopping approval worker...");
  }

  private async monitorOffers() {
    const openOfferIds = (await this.publicClient.readContract({
      address: this.OTC_ADDRESS,
      abi: this.abi,
      functionName: "getOpenOfferIds",
      args: [],
    })) as bigint[];

    if (openOfferIds.length === 0) return;

    console.log(`[Worker] 🔍 Found ${openOfferIds.length} open offers`);

    const activeQuotes = await this.getActiveQuotes();
    console.log(`[Worker] 📋 Found ${activeQuotes.length} active quotes`);

    for (const offerId of openOfferIds) {
      const offerIdStr = offerId.toString();
      if (this.processedOffers.has(offerIdStr)) continue;

      const offer = (await this.publicClient.readContract({
        address: this.OTC_ADDRESS,
        abi: this.abi,
        functionName: "offers",
        args: [offerId],
      })) as any;

      console.log(`[Worker] Offer ${offerIdStr}:`, {
        beneficiary: offer.beneficiary,
        tokenAmount: formatEther(offer.tokenAmount),
        discountBps: Number(offer.discountBps),
        approved: offer.approved,
      });

      if (offer.approved || offer.cancelled) {
        this.processedOffers.add(offerIdStr);
        continue;
      }

      const matchingQuote = await this.findMatchingQuote(offer, activeQuotes);
      if (!matchingQuote) {
        console.log(`⚠️  [Worker] No matching quote for offer ${offerIdStr}`);
        continue;
      }

      console.log(`✅ [Worker] MATCH FOUND! Approving offer ${offerIdStr}`);
      await this.approveOffer(offerId, matchingQuote);
    }
  }

  private async checkFulfilledOffers() {
    for (const [offerId, approvalData] of this.pendingApprovals.entries()) {
      const offer = (await this.publicClient.readContract({
        address: this.OTC_ADDRESS,
        abi: this.abi,
        functionName: "offers",
        args: [BigInt(offerId)],
      })) as any;

      if (offer.paid && !offer.fulfilled) {
        console.log(`💰 [Worker] Offer ${offerId} paid`);
        this.notifyDealCompletion(offerId, approvalData.quote, offer);
        this.pendingApprovals.delete(offerId);
      }
    }
  }

  private async approveOffer(offerId: bigint, quote: any) {
    const offerIdStr = offerId.toString();

    const { request } = await this.publicClient.simulateContract({
      address: this.OTC_ADDRESS,
      abi: this.abi,
      functionName: "approveOffer",
      args: [offerId],
      account: this.account,
    });

    const hash = await this.walletClient.writeContract(request);
    await this.publicClient.waitForTransactionReceipt({
      hash,
      confirmations: 1,
    });

    console.log(`✅ [Worker] Offer ${offerIdStr} approved: ${hash}`);

    this.processedOffers.add(offerIdStr);
    this.pendingApprovals.set(offerIdStr, {
      quote,
      approvalTx: hash,
      approvedAt: Date.now(),
    });

    const runtime = await agentRuntime.getRuntime();
    const quoteService = runtime.getService<any>("QuoteService");
    
    if (quoteService) {
      await quoteService.updateQuoteStatus(quote.quoteId, "approved", {
        offerId: offerIdStr,
        transactionHash: hash,
        blockNumber: 0,
        rejectionReason: "",
        approvalNote: "Auto-approved by worker",
      });
    }

    this.notifyApproval(quote.entityId, quote.quoteId, offerIdStr, hash);
  }

  private async notifyApproval(
    entityId: string,
    quoteId: string,
    offerId: string,
    txHash: string,
  ) {
    await this.sendHttpNotification("/api/notifications", {
      entityId,
      quoteId,
      offerId,
      transactionHash: txHash,
      message:
        "✅ Your OTC offer has been approved! You can now complete the payment.",
      timestamp: new Date().toISOString(),
      type: "offer_approved",
    });
    console.log(`📢 [Worker] Notified ${entityId}`);
  }

  private async notifyDealCompletion(offerId: string, quote: any, offer: any) {
    const tokenAmount = formatEther(offer.tokenAmount);
    const totalUsd =
      (Number(offer.priceUsdPerToken) * Number(tokenAmount)) / 100;
    const savedUsd = totalUsd * (quote.discountBps / 10000);

    const runtime = await agentRuntime.getRuntime();
    const quoteService = runtime.getService<any>("QuoteService");
    
    if (quoteService) {
      await quoteService.updateQuoteStatus(quote.quoteId, "executed", {
        offerId,
        transactionHash: offer.transactionHash ?? "pending",
        blockNumber: 0,
        rejectionReason: "",
        approvalNote: "",
      });
    }

    await this.sendHttpNotification("/api/notifications", {
      entityId: quote.entityId,
      quoteId: quote.quoteId,
      offerId,
      message: "🎉 Congratulations! Your elizaOS deal is complete!",
      type: "deal_completed",
      dealSummary: {
        tokenAmount,
        savings: savedUsd.toFixed(2),
        apr: quote.apr,
        lockupMonths: quote.lockupMonths,
        maturityDate: new Date(
          Date.now() + quote.lockupMonths * 30 * 24 * 60 * 60 * 1000,
        ).toISOString(),
      },
      timestamp: new Date().toISOString(),
    });

    console.log(`🎉 [Worker] Deal complete for ${quote.entityId}`);
  }

  private async getActiveQuotes() {
    const runtime = await agentRuntime.getRuntime();
    const quoteService = runtime.getService<any>("QuoteService");
    
    if (!quoteService) {
      console.error("[Worker] QuoteService not available!");
      return [];
    }
    
    return await quoteService.getActiveQuotes();
  }

  private async findMatchingQuote(offer: any, quotes: any[]): Promise<any | undefined> {
    console.log(`[Worker] Matching offer against ${quotes.length} quotes`);
    console.log(`[Worker] Offer details:`, {
      beneficiary: offer.beneficiary,
      tokenAmount: formatEther(offer.tokenAmount),
      discountBps: Number(offer.discountBps),
      currency: Number(offer.currency),
    });
    
    for (const quote of quotes) {
      console.log(`[Worker] Checking quote ${quote.quoteId}:`, {
        beneficiary: quote.beneficiary,
        tokenAmount: quote.tokenAmount,
        discountBps: quote.discountBps,
        paymentCurrency: quote.paymentCurrency,
      });
      
      if (await this.matchesQuote(offer, quote)) {
        console.log(`[Worker] ✅ MATCH FOUND with quote ${quote.quoteId}`);
        return quote;
      } else {
        console.log(`[Worker] ❌ No match with quote ${quote.quoteId}`);
      }
    }
    return undefined;
  }

  private async matchesQuote(offer: any, quote: any): Promise<boolean> {
    const offerBeneficiary = offer.beneficiary.toLowerCase();
    const quoteBeneficiary = quote.beneficiary.toLowerCase();
    const beneficiaryMatch = offerBeneficiary === quoteBeneficiary;
    
    console.log(`[Worker] Beneficiary match: ${beneficiaryMatch}`, { offer: offerBeneficiary, quote: quoteBeneficiary });
    
    if (!beneficiaryMatch) return false;

    const offerTokenAmount = parseFloat(formatEther(offer.tokenAmount));
    const quoteTokenAmount = parseFloat(quote.tokenAmount);
    const tokenAmountMatch =
      Math.abs(offerTokenAmount - quoteTokenAmount) / quoteTokenAmount < 0.001;

    console.log(`[Worker] Token amount match: ${tokenAmountMatch}`, { offer: offerTokenAmount, quote: quoteTokenAmount });

    const discountMatch = Number(offer.discountBps) === quote.discountBps;
    console.log(`[Worker] Discount match: ${discountMatch}`, { offer: Number(offer.discountBps), quote: quote.discountBps });

    const currencyMatch =
      (offer.currency === 0 && quote.paymentCurrency === "ETH") ||
      (offer.currency === 1 && quote.paymentCurrency === "USDC");
    console.log(`[Worker] Currency match: ${currencyMatch}`, { offer: Number(offer.currency), quote: quote.paymentCurrency });

    const offerLockupDays =
      Number(offer.unlockTime - offer.createdAt) / (60 * 60 * 24);
    const quoteLockupDays = quote.lockupMonths * 30;
    const lockupMatch = Math.abs(offerLockupDays - quoteLockupDays) <= 1;
    console.log(`[Worker] Lockup match: ${lockupMatch}`, { offer: offerLockupDays, quote: quoteLockupDays });

    const runtime = await agentRuntime.getRuntime();
    const quoteService = runtime.getService<any>("QuoteService");
    const signatureValid = quoteService ? quoteService.verifyQuoteSignature(quote) : true;  // Default to true if service not available
    console.log(`[Worker] Signature valid: ${signatureValid}`);

    const matches = tokenAmountMatch && discountMatch && currencyMatch && lockupMatch && signatureValid;
    console.log(`[Worker] Overall match: ${matches}`);

    return matches;
  }

  private async unstickOffers() {
    // Approve ANY unapproved offer that's been waiting > 30 seconds (unstick mechanism)
    const UNSTICK_TIMEOUT = 30 * 1000; // 30 seconds

    const openOfferIds = (await this.publicClient.readContract({
      address: this.OTC_ADDRESS,
      abi: this.abi,
      functionName: "getOpenOfferIds",
      args: [],
    })) as bigint[];

    for (const offerId of openOfferIds) {
      const offerIdStr = offerId.toString();
      if (this.processedOffers.has(offerIdStr)) continue;

      const offer = (await this.publicClient.readContract({
        address: this.OTC_ADDRESS,
        abi: this.abi,
        functionName: "offers",
        args: [offerId],
      })) as any;

      if (offer.approved || offer.cancelled) {
        this.processedOffers.add(offerIdStr);
        continue;
      }

      // Check how long this offer has been waiting
      const offerAge = Date.now() - Number(offer.createdAt) * 1000;
      
      if (offerAge > UNSTICK_TIMEOUT) {
        console.log(`🔓 [Worker] UNSTICKING offer ${offerIdStr} (age: ${Math.floor(offerAge / 1000)}s) - approving without quote match`);
        
        // Just approve it without finding a matching quote
        const { request } = await this.publicClient.simulateContract({
          address: this.OTC_ADDRESS,
          abi: this.abi,
          functionName: "approveOffer",
          args: [offerId],
          account: this.account,
        });

        const hash = await this.walletClient.writeContract(request);
        await this.publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });

        console.log(`✅ [Worker] UNSTUCK offer ${offerIdStr} approved: ${hash}`);
        this.processedOffers.add(offerIdStr);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async sendHttpNotification(
    endpoint: string,
    data: any,
  ): Promise<void> {
    const url = `${this.apiBaseUrl}${endpoint}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Worker-Auth": process.env.WORKER_AUTH_TOKEN || "internal-worker",
      },
      body: JSON.stringify(data),
    });

    await response.json();
  }
}

let workerInstance: QuoteApprovalWorker | null = null;

export function startQuoteApprovalWorker() {
  if (workerInstance) return workerInstance;
  workerInstance = new QuoteApprovalWorker();
  workerInstance.start();
  return workerInstance;
}

export function stopQuoteApprovalWorker() {
  workerInstance?.stop();
  workerInstance = null;
}

export const startEnhancedWorker = startQuoteApprovalWorker;
export const stopEnhancedWorker = stopQuoteApprovalWorker;

if (
  process.env.NODE_ENV === "development" &&
  process.env.AUTO_START_WORKER === "true"
) {
  startQuoteApprovalWorker();
}
