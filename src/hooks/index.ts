/**
 * Hooks Index
 *
 * Re-exports all hooks for convenient imports.
 * Organized by: Query Keys → Query Hooks → Mutations → Utilities
 */

// ============================================================================
// Query Keys - Centralized cache key factories
// ============================================================================
export * from "./queryKeys";

// ============================================================================
// Query Hooks - Data fetching with React Query
// ============================================================================

// Token data
export {
  useToken,
  useTokenCache, // Backward compatibility alias
  useMarketData,
  useMarketDataRefresh,
  useInvalidateToken,
  usePrefetchToken,
} from "./useToken";

// Token lookup (by address)
export {
  useTokenLookup,
  useInvalidateTokenLookup,
  usePrefetchTokenLookup,
} from "./useTokenLookup";

// Token batch fetching
export { useTokenBatch } from "./useTokenBatch";

// Wallet tokens
export {
  useWalletTokens,
  useInvalidateWalletTokens,
  useRefetchWalletTokens,
} from "./useWalletTokens";

// Consignments
export {
  useConsignments,
  useTradingDeskConsignments,
  useMyConsignments,
  useInvalidateConsignments,
} from "./useConsignments";

export {
  useConsignment,
  useInvalidateConsignment,
  usePrefetchConsignment,
  useSetConsignmentData,
} from "./useConsignment";

// Deals
export { useDeals, useInvalidateDeals } from "./useDeals";

// Quotes
export {
  useExecutedQuote,
  useQuoteByOffer,
  useInvalidateQuote,
  usePrefetchQuote,
} from "./useQuote";

// Prices
export { useNativePrices, useNativePrice } from "./useNativePrices";

// Pool validation
export {
  usePoolCheck,
  useInvalidatePoolCheck,
  usePrefetchPoolCheck,
} from "./usePoolCheck";

// ============================================================================
// Mutation Hooks - Data mutations with React Query
// ============================================================================
export * from "./mutations";

// ============================================================================
// Utility Hooks - Non-React-Query hooks
// ============================================================================
export { useDeploymentValidation } from "./useDeploymentValidation";
export { useChainReset } from "./useChainReset";
export { useTransactionErrorHandler } from "./useTransactionErrorHandler";
