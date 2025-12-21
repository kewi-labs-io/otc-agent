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
export {
  ChainContext,
  useChain,
  type ChainContextValue,
} from "./ChainContext";

// Wallet connection state (read-only)
export {
  WalletConnectionContext,
  useWalletConnection,
  type WalletConnectionContextValue,
} from "./WalletConnectionContext";

// Wallet actions (stable refs)
export {
  WalletActionsContext,
  useWalletActions,
  type WalletActionsContextValue,
} from "./WalletActionsContext";
