/**
 * Deal Mutations - React Query mutation hooks
 *
 * Handles:
 * - Completing deals (POST /api/deal-completion)
 * - Approving offers (POST /api/otc/approve)
 * - Claiming tokens (POST /api/solana/claim)
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Currency } from "@/types";
import { throwApiError } from "../lib/api-helpers";
import {
  consignmentKeys,
  dealKeys,
  quoteKeys,
  walletTokenKeys,
} from "../queryKeys";

/**
 * Input for completing a deal
 */
interface CompleteDealInput {
  action: "complete";
  quoteId: string;
  tokenAmount: string;
  paymentCurrency: Currency | string;
  offerId: string;
  transactionHash?: string;
  chain: "evm" | "solana";
  offerAddress?: string; // For Solana
  beneficiary?: string;
}

/**
 * Response from deal completion API
 */
interface DealCompletionResponse {
  success: boolean;
  quote?: {
    quoteId: string;
    status: string;
    offerId?: string;
  };
  error?: string;
}

/**
 * Input for approving an offer
 */
interface ApproveOfferInput {
  offerId: string;
  chain: string;
  txHash?: string;
  offerAddress?: string; // For Solana
  consignmentAddress?: string; // For Solana
}

/**
 * Response from approve API
 */
interface ApproveOfferResponse {
  success: boolean;
  approvalTx?: string;
  txHash?: string;
  fulfillTx?: string;
  autoFulfilled?: boolean;
  error?: string;
}

/**
 * Input for claiming Solana tokens
 */
interface ClaimTokensInput {
  offerAddress: string;
  beneficiary: string;
}

/**
 * Response from claim API
 */
interface ClaimTokensResponse {
  success: boolean;
  scheduled?: boolean;
  secondsRemaining?: number;
  signature?: string;
  error?: string;
}

/**
 * Complete a deal via API
 */
async function completeDeal(
  input: CompleteDealInput,
): Promise<DealCompletionResponse> {
  const response = await fetch("/api/deal-completion", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    await throwApiError(
      response,
      `Failed to complete deal: ${response.status}`,
    );
  }

  const data = (await response.json()) as DealCompletionResponse;

  if (!data.success) {
    throw new Error(data.error ?? "Deal completion failed");
  }

  return data;
}

/**
 * Approve an offer via backend
 */
async function approveOffer(
  input: ApproveOfferInput,
): Promise<ApproveOfferResponse> {
  const response = await fetch("/api/otc/approve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Approval failed: ${errorText}`);
  }

  return response.json();
}

/**
 * Claim tokens (Solana)
 */
async function claimTokens(
  input: ClaimTokensInput,
): Promise<ClaimTokensResponse> {
  const response = await fetch("/api/solana/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    await throwApiError(response, "Claim failed");
  }

  return response.json();
}

/**
 * Hook to complete a deal
 *
 * Features:
 * - Invalidates deals, quotes, and consignments on success
 * - Supports both EVM and Solana chains
 */
export function useCompleteDeal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: completeDeal,
    onSuccess: (data, variables) => {
      // Invalidate quote cache
      queryClient.invalidateQueries({
        queryKey: quoteKeys.executed(variables.quoteId),
      });

      // Invalidate deals list
      queryClient.invalidateQueries({ queryKey: dealKeys.all });

      // Invalidate consignments (remaining amount changed)
      queryClient.invalidateQueries({ queryKey: consignmentKeys.all });
    },
  });
}

/**
 * Hook to approve an offer
 *
 * Features:
 * - Retry with exponential backoff
 * - Handles auto-fulfill response
 */
export function useApproveOffer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: approveOffer,
    retry: 5,
    retryDelay: (attempt) => Math.min(2 ** attempt * 1000, 30000),
    onSuccess: () => {
      // Invalidate deals and consignments
      queryClient.invalidateQueries({ queryKey: dealKeys.all });
      queryClient.invalidateQueries({ queryKey: consignmentKeys.all });
    },
  });
}

/**
 * Hook to claim tokens (Solana)
 *
 * Features:
 * - Returns scheduled status for lockup period
 * - Invalidates wallet tokens on success
 */
export function useClaimTokens() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: claimTokens,
    onSuccess: () => {
      // Invalidate wallet tokens to show new balance
      queryClient.invalidateQueries({ queryKey: walletTokenKeys.all });

      // Invalidate deals to update status
      queryClient.invalidateQueries({ queryKey: dealKeys.all });
    },
  });
}

/**
 * Hook to update quote (for pre-transaction updates)
 */
export function useUpdateQuote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      quoteId: string;
      beneficiary?: string;
      tokenAmount?: string;
      paymentCurrency?: string;
      totalUsd?: number;
      discountUsd?: number;
      discountedUsd?: number;
      paymentAmount?: string;
    }) => {
      const response = await fetch("/api/quote/latest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        // Non-critical update - log but don't throw
        console.warn("[useUpdateQuote] Quote update failed:", response.status);
        return null;
      }

      return response.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: quoteKeys.latest(variables.quoteId),
      });
    },
  });
}
