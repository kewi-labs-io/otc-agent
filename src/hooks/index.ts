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

// ============================================================================
// Mutation Hooks - Data mutations with React Query
// ============================================================================
export * from "./mutations";
export { useChainReset } from "./useChainReset";
export type { ChatMessage } from "./useChat";
// Chat/Room
export {
  useCreateRoom,
  useInvalidateChat,
  useRoomMessages,
  useSendMessage,
} from "./useChat";
export {
  useConsignment,
  useInvalidateConsignment,
  usePrefetchConsignment,
  useSetConsignmentData,
} from "./useConsignment";
// Consignments
export {
  useConsignments,
  useInvalidateConsignments,
  useMyConsignments,
  useTradingDeskConsignments,
} from "./useConsignments";

// Deals
export { useDeals, useInvalidateDeals } from "./useDeals";
// ============================================================================
// Utility Hooks - Non-React-Query hooks
// ============================================================================
export { useDeploymentValidation } from "./useDeploymentValidation";

// Prices
export { useNativePrice, useNativePrices } from "./useNativePrices";
// Notifications
export { useSendNotification, useWelcomeNotification } from "./useNotification";
// Pool validation
export {
  useInvalidatePoolCheck,
  usePoolCheck,
  usePrefetchPoolCheck,
} from "./usePoolCheck";
// Quotes
export {
  useExecutedQuote,
  useInvalidateQuote,
  usePrefetchQuote,
  useQuoteByOffer,
} from "./useQuote";

// Solana balances
export {
  useSolanaPaymentBalance,
  useSolanaUsdcBalance,
  useSolBalance,
  useSplTokenBalance,
} from "./useSolanaBalance";
// Token data
export {
  useInvalidateToken,
  useMarketData,
  useMarketDataRefresh,
  usePrefetchToken,
  useToken,
  useTokenCache, // Backward compatibility alias
} from "./useToken";
// Token batch fetching
export { useTokenBatch } from "./useTokenBatch";
// Token lookup (by address)
export {
  useInvalidateTokenLookup,
  usePrefetchTokenLookup,
  useTokenLookup,
} from "./useTokenLookup";
export { useTransactionErrorHandler } from "./useTransactionErrorHandler";
// Wallet tokens
export {
  useInvalidateWalletTokens,
  useRefetchWalletTokens,
  useWalletTokens,
} from "./useWalletTokens";
