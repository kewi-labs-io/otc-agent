/**
 * Contexts Index
 *
 * Re-exports all context hooks and providers for convenient imports.
 *
 * The wallet-related contexts are split for performance:
 * - ChainContext: Chain selection (activeFamily, selectedEVMChain)
 * - WalletConnectionContext: Read-only wallet state (addresses, connection status)
 * - WalletActionsContext: Stable action refs (login, logout, connect)
 *
 * This split reduces re-renders - components only using actions don't re-render
 * when chain or connection state changes.
 */

// Chain selection
export { ChainContext, type ChainContextValue, useChain } from "./ChainContext";
// Wallet actions (stable refs)
export {
  useWalletActions,
  WalletActionsContext,
  type WalletActionsContextValue,
} from "./WalletActionsContext";
// Wallet connection state (read-only)
export {
  useWalletConnection,
  WalletConnectionContext,
  type WalletConnectionContextValue,
} from "./WalletConnectionContext";
