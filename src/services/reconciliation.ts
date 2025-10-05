/**
 * State Reconciliation Service
 * 
 * Ensures database state matches blockchain contract state.
 * Critical for maintaining data integrity across the system.
 */

import { createPublicClient, http, type Address, type Abi } from 'viem';
import { hardhat, base, baseSepolia } from 'viem/chains';
import otcArtifact from '@/contracts/artifacts/contracts/OTC.sol/OTC.json';
import { QuoteService } from './database';

interface ContractOffer {
  beneficiary: Address;
  tokenAmount: bigint;
  discountBps: number;
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
  private client: ReturnType<typeof createPublicClient>;
  private otcAddress: Address | undefined;
  private abi: Abi;

  constructor() {
    // Determine chain
    const env = process.env.NODE_ENV;
    const network = process.env.NETWORK || 'hardhat';
    const chain = env === 'production' 
      ? base 
      : network === 'base-sepolia' 
      ? baseSepolia 
      : hardhat;

    // Create public client
    const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || 'http://127.0.0.1:8545';
    this.client = createPublicClient({
      chain,
      transport: http(rpcUrl),
    });

    this.otcAddress = process.env.NEXT_PUBLIC_OTC_ADDRESS as Address | undefined;
    this.abi = otcArtifact.abi as Abi;
  }

  /**
   * Read offer state from contract
   */
  async readContractOffer(offerId: string | number): Promise<ContractOffer | null> {
    if (!this.otcAddress) {
      console.warn('[Reconciliation] OTC address not configured');
      return null;
    }

    try {
      const offer = await this.client.readContract({
        address: this.otcAddress,
        abi: this.abi,
        functionName: 'offers',
        args: [BigInt(offerId)],
      }) as any;

      if (!offer || offer.beneficiary === '0x0000000000000000000000000000000000000000') {
        return null;
      }

      return {
        beneficiary: offer.beneficiary,
        tokenAmount: offer.tokenAmount,
        discountBps: Number(offer.discountBps),
        createdAt: offer.createdAt,
        unlockTime: offer.unlockTime,
        priceUsdPerToken: offer.priceUsdPerToken,
        ethUsdPrice: offer.ethUsdPrice || 0n,
        currency: Number(offer.currency),
        approved: Boolean(offer.approved),
        paid: Boolean(offer.paid),
        fulfilled: Boolean(offer.fulfilled),
        cancelled: Boolean(offer.cancelled),
        payer: offer.payer,
        amountPaid: offer.amountPaid,
      };
    } catch (error) {
      console.error(`[Reconciliation] Failed to read offer ${offerId}:`, error);
      return null;
    }
  }

  /**
   * Reconcile a single quote with its contract state
   */
  async reconcileQuote(quoteId: string): Promise<{
    success: boolean;
    updated: boolean;
    message: string;
  }> {
    try {
      // Get database quote
      const dbQuote = await QuoteService.getQuoteByQuoteId(quoteId);
      if (!dbQuote) {
        return {
          success: false,
          updated: false,
          message: `Quote ${quoteId} not found in database`,
        };
      }

      // If no offerId, nothing to reconcile
      if (!dbQuote.offerId) {
        return {
          success: true,
          updated: false,
          message: 'Quote has no offerId yet',
        };
      }

      // Read contract state
      const contractOffer = await this.readContractOffer(dbQuote.offerId);
      if (!contractOffer) {
        return {
          success: false,
          updated: false,
          message: `Offer ${dbQuote.offerId} not found on contract`,
        };
      }

      // Determine correct status from contract
      let contractStatus: 'created' | 'approved' | 'executed' | 'rejected' | 'expired';
      if (contractOffer.fulfilled) {
        contractStatus = 'executed';
      } else if (contractOffer.cancelled) {
        contractStatus = 'rejected';
      } else if (contractOffer.paid) {
        contractStatus = 'approved'; // Paid but not yet fulfilled
      } else if (contractOffer.approved) {
        contractStatus = 'approved';
      } else {
        contractStatus = 'created';
      }

      // Check if database needs update
      if (dbQuote.status !== contractStatus) {
        console.log(`[Reconciliation] Status mismatch for ${quoteId}:`);
        console.log(`  Database: ${dbQuote.status}`);
        console.log(`  Contract: ${contractStatus}`);

        // Update database to match contract
        await QuoteService.updateQuoteExecution(quoteId, {
          status: contractStatus,
          executedAt: contractOffer.fulfilled 
            ? new Date(Number(contractOffer.unlockTime) * 1000) 
            : undefined,
        });

        return {
          success: true,
          updated: true,
          message: `Updated status from ${dbQuote.status} to ${contractStatus}`,
        };
      }

      return {
        success: true,
        updated: false,
        message: 'States already in sync',
      };
    } catch (error) {
      console.error(`[Reconciliation] Error reconciling quote ${quoteId}:`, error);
      return {
        success: false,
        updated: false,
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Reconcile all active quotes
   */
  async reconcileAllActive(): Promise<{
    total: number;
    updated: number;
    failed: number;
    results: Array<{ quoteId: string; updated: boolean; message: string }>;
  }> {
    console.log('[Reconciliation] Starting reconciliation of all active quotes...');

    try {
      const activeQuotes = await QuoteService.getActiveQuotes();
      console.log(`[Reconciliation] Found ${activeQuotes.length} active quotes`);

      const results = await Promise.all(
        activeQuotes.map(async (quote) => {
          const result = await this.reconcileQuote(quote.quoteId);
          return {
            quoteId: quote.quoteId,
            updated: result.updated,
            message: result.message,
          };
        })
      );

      const updated = results.filter((r) => r.updated).length;
      const failed = results.filter((r) => r.message.includes('Error') || r.message.includes('not found')).length;

      console.log('[Reconciliation] Complete:');
      console.log(`  Total: ${results.length}`);
      console.log(`  Updated: ${updated}`);
      console.log(`  Failed: ${failed}`);

      return {
        total: results.length,
        updated,
        failed,
        results,
      };
    } catch (error) {
      console.error('[Reconciliation] Failed to reconcile all quotes:', error);
      throw error;
    }
  }

  /**
   * Verify a quote's contract state before showing to user
   */
  async verifyQuoteState(quoteId: string): Promise<{
    valid: boolean;
    syncNeeded: boolean;
    message: string;
  }> {
    const result = await this.reconcileQuote(quoteId);
    
    return {
      valid: result.success,
      syncNeeded: result.updated,
      message: result.message,
    };
  }

  /**
   * Check if contract is accessible
   */
  async healthCheck(): Promise<{
    healthy: boolean;
    blockNumber?: number;
    contractAddress?: string;
    error?: string;
  }> {
    try {
      if (!this.otcAddress) {
        return {
          healthy: false,
          error: 'OTC address not configured',
        };
      }

      // Try to read a simple value
      const blockNumber = await this.client.getBlockNumber();
      
      // Try to read from contract
      const nextOfferId = await this.client.readContract({
        address: this.otcAddress,
        abi: this.abi,
        functionName: 'nextOfferId',
        args: [],
      });

      return {
        healthy: true,
        blockNumber: Number(blockNumber),
        contractAddress: this.otcAddress,
      };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

// Singleton instance
export const reconciliationService = new ReconciliationService();

/**
 * Reconciliation task that can be run via cron
 */
export async function runReconciliationTask(): Promise<void> {
  console.log('\n🔄 [Reconciliation Task] Starting...\n');
  
  // Health check first
  const health = await reconciliationService.healthCheck();
  if (!health.healthy) {
    console.error('[Reconciliation Task] Health check failed:', health.error);
    return;
  }

  console.log('[Reconciliation Task] Health check passed');
  console.log(`  Block: ${health.blockNumber}`);
  console.log(`  Contract: ${health.contractAddress}\n`);

  // Reconcile all active quotes
  try {
    const result = await reconciliationService.reconcileAllActive();
    
    console.log('\n✅ [Reconciliation Task] Complete');
    console.log(`  Total quotes: ${result.total}`);
    console.log(`  Updated: ${result.updated}`);
    console.log(`  Failed: ${result.failed}\n`);

    if (result.failed > 0) {
      console.warn('⚠️  Some quotes failed to reconcile. Check logs for details.');
    }
  } catch (error) {
    console.error('[Reconciliation Task] Failed:', error);
    throw error;
  }
}


