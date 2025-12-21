/**
 * Consignment Mutations - React Query mutation hooks
 *
 * Handles:
 * - Creating new consignments (POST /api/consignments)
 * - Withdrawing consignments (DELETE /api/consignments/:id)
 * - Updating consignments (PUT /api/consignments/:id)
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { OTCConsignment } from "@/types";
import { throwApiError } from "../lib/api-helpers";
import { consignmentKeys, walletTokenKeys } from "../queryKeys";

/**
 * Input for creating a consignment
 * Matches API request schema at /api/consignments
 */
interface CreateConsignmentInput {
  tokenId: string;
  consignerAddress: string;
  amount: string;
  isNegotiable: boolean;
  fixedDiscountBps?: number;
  fixedLockupDays?: number;
  minDiscountBps?: number;
  maxDiscountBps?: number;
  minLockupDays?: number;
  maxLockupDays?: number;
  minDealAmount?: string;
  maxDealAmount?: string;
  isFractionalized?: boolean;
  isPrivate?: boolean;
  allowedBuyers?: string[];
  maxPriceVolatilityBps?: number;
  maxTimeToExecuteSeconds?: number;
  chain: string;
  contractConsignmentId?: string | null;
  // Token metadata
  tokenSymbol?: string;
  tokenName?: string;
  tokenDecimals?: number;
  tokenAddress?: string;
  tokenLogoUrl?: string | null;
}

/**
 * Response from create consignment API
 */
interface CreateConsignmentResponse {
  success: boolean;
  consignment?: OTCConsignment;
  error?: string;
}

/**
 * Input for withdrawing a consignment
 */
interface WithdrawConsignmentInput {
  consignmentId: string;
  callerAddress: string;
}

/**
 * Input for Solana withdrawal
 */
interface SolanaWithdrawInput {
  consignmentAddress: string;
  consignerAddress: string;
  signedTransaction: string;
}

/**
 * Input for updating a consignment
 */
interface UpdateConsignmentInput {
  consignmentId: string;
  callerAddress: string;
  updates: {
    status?: "active" | "paused" | "withdrawn";
    remainingAmount?: string;
    contractConsignmentId?: string;
  };
}

/**
 * Create a new consignment via API
 */
async function createConsignment(
  input: CreateConsignmentInput,
): Promise<OTCConsignment> {
  const response = await fetch("/api/consignments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    await throwApiError(
      response,
      `Failed to create consignment: ${response.status}`,
    );
  }

  const data = (await response.json()) as CreateConsignmentResponse;

  if (!data.success || !data.consignment) {
    throw new Error(data.error ?? "Failed to create consignment");
  }

  return data.consignment;
}

/**
 * Withdraw a consignment (mark as withdrawn in DB)
 */
async function withdrawConsignment(
  input: WithdrawConsignmentInput,
): Promise<void> {
  const response = await fetch(
    `/api/consignments/${encodeURIComponent(input.consignmentId)}?callerAddress=${encodeURIComponent(input.callerAddress)}`,
    { method: "DELETE" },
  );

  if (!response.ok) {
    await throwApiError(response, "Failed to update database after withdrawal");
  }
}

/**
 * Withdraw Solana consignment via backend (adds desk signature)
 */
async function withdrawSolanaConsignment(
  input: SolanaWithdrawInput,
): Promise<{ signature: string }> {
  const response = await fetch("/api/solana/withdraw-consignment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    await throwApiError(response, "Solana withdrawal failed");
  }

  return response.json();
}

/**
 * Update a consignment
 */
async function updateConsignment(
  input: UpdateConsignmentInput,
): Promise<OTCConsignment> {
  const response = await fetch(
    `/api/consignments/${encodeURIComponent(input.consignmentId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callerAddress: input.callerAddress,
        ...input.updates,
      }),
    },
  );

  if (!response.ok) {
    await throwApiError(response, "Failed to update consignment");
  }

  const data = await response.json();

  if (!data.success || !data.consignment) {
    throw new Error(data.error ?? "Failed to update consignment");
  }

  return data.consignment;
}

/**
 * Hook to create a new consignment
 *
 * Features:
 * - Invalidates consignments list on success
 * - Invalidates wallet tokens to refresh balance
 */
export function useCreateConsignment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createConsignment,
    onSuccess: () => {
      // Invalidate consignments list
      queryClient.invalidateQueries({ queryKey: consignmentKeys.all });

      // Invalidate wallet tokens for the consigner
      queryClient.invalidateQueries({
        queryKey: walletTokenKeys.all,
      });
    },
  });
}

/**
 * Hook to withdraw a consignment
 *
 * Features:
 * - Invalidates consignments on success
 * - Invalidates wallet tokens to show returned balance
 */
export function useWithdrawConsignment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: withdrawConsignment,
    onSuccess: (_data, variables) => {
      // Invalidate specific consignment
      queryClient.invalidateQueries({
        queryKey: consignmentKeys.single(variables.consignmentId),
      });
      // Invalidate consignments list
      queryClient.invalidateQueries({ queryKey: consignmentKeys.all });
      // Invalidate wallet tokens to show returned balance
      queryClient.invalidateQueries({ queryKey: walletTokenKeys.all });
    },
  });
}

/**
 * Hook to withdraw Solana consignment
 *
 * Features:
 * - Calls backend to add desk signature and submit
 * - Returns transaction signature
 */
export function useSolanaWithdrawConsignment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: withdrawSolanaConsignment,
    onSuccess: () => {
      // Invalidate consignments and wallet tokens
      queryClient.invalidateQueries({ queryKey: consignmentKeys.all });
      queryClient.invalidateQueries({ queryKey: walletTokenKeys.all });
    },
  });
}

/**
 * Hook to update a consignment
 */
export function useUpdateConsignment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateConsignment,
    onSuccess: (data, variables) => {
      // Update cache with new data
      queryClient.setQueryData(
        consignmentKeys.single(variables.consignmentId),
        data,
      );
      // Invalidate list queries
      queryClient.invalidateQueries({ queryKey: consignmentKeys.lists() });
    },
  });
}
