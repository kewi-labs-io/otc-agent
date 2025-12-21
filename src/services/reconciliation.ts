/**
 * State Reconciliation Service
 *
 * Ensures database state matches blockchain contract state.
 * Critical for maintaining data integrity across the system.
 * Uses Zod validation at all boundaries.
 */

import { type Abi, type Address, createPublicClient, http } from "viem";
import otcArtifact from "@/contracts/artifacts/contracts/OTC.sol/OTC.json";
import { getChain, getRpcUrl } from "@/lib/getChain";
import { getOtcAddress } from "@/config/contracts";
import { parseOrThrow } from "@/lib/validation/helpers";
import type { MinimalPublicClient } from "@/lib/viem-utils";
import {
  HealthCheckOutputSchema,
  ReconciliationResultSchema,
  ReconciliationSummarySchema,
} from "@/types/validation/service-schemas";
import { QuoteDB } from "./database";

// OnChainOffer matches the struct returned by the OTC contract
interface OnChainOffer {
  beneficiary: Address;
  tokenAmount: bigint;
  discountBps: bigint;
  createdAt: bigint;
  unlockTime: bigint;
  priceUsdPerToken: bigint;
  ethUsdPrice: bigint;
  currency: number;
  approved: boolean;
  paid: boolean;
  fulfilled: boolean;
  cancelled: boolean;
  payer: Address;
  amountPaid: bigint;
}

export class ReconciliationService {
  private client: MinimalPublicClient;
  private otcAddress: Address | undefined;
  private abi: Abi;

  constructor() {
    // Get chain and RPC URL using centralized logic
    const chain = getChain();
    const rpcUrl = getRpcUrl();

    // Create public client (cast to minimal interface to avoid deep type issues)
    // viem's PublicClient has deep generic types causing TS performance issues
    // MinimalPublicClient is a simplified interface that preserves needed functionality
    this.client = createPublicClient({
      chain,
      transport: http(rpcUrl),
    }) as MinimalPublicClient;

    // Use chain-specific contract address based on NETWORK env var
    // FAIL-FAST: Contract address must be configured
    this.otcAddress = getOtcAddress() as Address;
    console.log(
      `[ReconciliationService] Using contract address: ${this.otcAddress} for network: ${process.env.NETWORK || "localnet"}`,
    );
    this.abi = otcArtifact.abi as Abi;
  }

  async readContractOffer(offerId: string | number): Promise<OnChainOffer> {
    if (!this.otcAddress) throw new Error("OTC address not configured");

    // Type cast needed - viem's readContract return type is too complex for TypeScript to infer
    const [
      beneficiary,
      tokenAmount,
      discountBps,
      createdAt,
      unlockTime,
      priceUsdPerToken,
      ethUsdPrice,
      currency,
      approved,
      paid,
      fulfilled,
      cancelled,
      payer,
      amountPaid,
    ] = (await this.client.readContract({
      address: this.otcAddress,
      abi: this.abi,
      functionName: "offers",
      args: [BigInt(offerId)],
    })) as [
      Address,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      number,
      boolean,
      boolean,
      boolean,
      boolean,
      Address,
      bigint,
    ];

    return {
      beneficiary,
      tokenAmount,
      discountBps,
      createdAt,
      unlockTime,
      priceUsdPerToken,
      ethUsdPrice,
      currency,
      approved,
      paid,
      fulfilled,
      cancelled,
      payer,
      amountPaid,
    };
  }

  async reconcileQuote(quoteId: string): Promise<{
    updated: boolean;
    oldStatus: string;
    newStatus: string;
  }> {
    // FAIL-FAST: Validate quoteId
    if (!quoteId || quoteId.trim() === "") {
      throw new Error("reconcileQuote: quoteId is required");
    }

    const dbQuote = await QuoteDB.getQuoteByQuoteId(quoteId);
    if (!dbQuote.offerId) {
      const result = {
        updated: false,
        oldStatus: dbQuote.status,
        newStatus: dbQuote.status,
      };
      // Validate output
      return parseOrThrow(ReconciliationResultSchema, result);
    }

    const contractOffer = await this.readContractOffer(dbQuote.offerId);

    const contractStatus = contractOffer.fulfilled
      ? "executed"
      : contractOffer.cancelled
        ? "rejected"
        : contractOffer.paid || contractOffer.approved
          ? "approved"
          : "active";

    if (dbQuote.status === contractStatus) {
      const result = {
        updated: false,
        oldStatus: dbQuote.status,
        newStatus: contractStatus,
      };
      return parseOrThrow(ReconciliationResultSchema, result);
    }

    console.log(
      `[Reconciliation] ${quoteId}: ${dbQuote.status} → ${contractStatus}`,
    );
    // FAIL-FAST: offerId should exist if quote has been executed/approved
    // Empty string is acceptable for quotes that haven't been executed yet
    const offerId = dbQuote.offerId || "";
    await QuoteDB.updateQuoteStatus(quoteId, contractStatus, {
      offerId,
      transactionHash: "",
      blockNumber: 0,
      rejectionReason: "",
      approvalNote: "",
    });

    const result = {
      updated: true,
      oldStatus: dbQuote.status,
      newStatus: contractStatus,
    };
    return parseOrThrow(ReconciliationResultSchema, result);
  }

  async reconcileAllActive(): Promise<{
    total: number;
    updated: number;
  }> {
    console.log("[Reconciliation] Starting reconciliation...");
    const activeQuotes = await QuoteDB.getActiveQuotes();
    console.log(`[Reconciliation] Found ${activeQuotes.length} active quotes`);

    const results = await Promise.all(
      activeQuotes.map((quote) => this.reconcileQuote(quote.quoteId)),
    );

    const updated = results.filter((r) => r.updated).length;
    console.log(
      `[Reconciliation] Complete: ${updated}/${results.length} updated`,
    );

    const result = { total: results.length, updated };
    return parseOrThrow(ReconciliationSummarySchema, result);
  }

  async verifyQuoteState(quoteId: string): Promise<{ syncNeeded: boolean }> {
    // FAIL-FAST: Validate quoteId
    if (!quoteId || quoteId.trim() === "") {
      throw new Error("verifyQuoteState: quoteId is required");
    }

    const result = await this.reconcileQuote(quoteId);
    return { syncNeeded: result.updated };
  }

  async healthCheck(): Promise<{
    blockNumber: number;
    contractAddress: string;
  }> {
    if (!this.otcAddress) throw new Error("OTC address not configured");
    const getBlockNumber = this.client.getBlockNumber;
    if (!getBlockNumber) {
      throw new Error("getBlockNumber not available on client");
    }

    const blockNumber = await getBlockNumber();
    await this.client.readContract({
      address: this.otcAddress,
      abi: this.abi,
      functionName: "nextOfferId",
      args: [],
    });
    const result = {
      blockNumber: Number(blockNumber),
      contractAddress: this.otcAddress,
    };
    return parseOrThrow(HealthCheckOutputSchema, result);
  }
}

// Lazy singleton instance - only created when needed (at runtime, not build time)
let reconciliationServiceInstance: ReconciliationService | null = null;

function getReconciliationService(): ReconciliationService {
  if (!reconciliationServiceInstance) {
    reconciliationServiceInstance = new ReconciliationService();
  }
  return reconciliationServiceInstance;
}

export async function runReconciliationTask(): Promise<void> {
  console.log("\n🔄 [Reconciliation Task] Starting...\n");

  const service = getReconciliationService();
  const health = await service.healthCheck();
  console.log(
    `[Reconciliation] Block: ${health.blockNumber}, Contract: ${health.contractAddress}\n`,
  );

  const result = await service.reconcileAllActive();
  console.log(
    `\n✅ [Reconciliation] Complete: ${result.updated}/${result.total} updated\n`,
  );
}
