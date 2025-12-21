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
  walletTokensKeys,
} from "./useWalletTokens";

// Consignments
// Note: consignmentKeys (canonical) is exported from ./queryKeys via "export * from"
// consignmentsKeys is a deprecated alias for backward compatibility
export {
  useConsignments,
  useTradingDeskConsignments,
  useMyConsignments,
  useInvalidateConsignments,
  consignmentsKeys, // @deprecated - use consignmentKeys from queryKeys instead
} from "./useConsignments";

export {
  useConsignment,
  useInvalidateConsignment,
  usePrefetchConsignment,
  useSetConsignmentData,
} from "./useConsignment";

// Deals
export { useDeals, useInvalidateDeals, dealsKeys } from "./useDeals";

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
