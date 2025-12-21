"use client";

/**
 * WalletActionsContext - Stable Action Refs
 *
 * Holds wallet action methods that should remain stable across renders.
 * Split from MultiWallet to reduce re-renders - the action functions
 * use useCallback and should not trigger re-renders.
 */

import { createContext, useContext } from "react";

/**
 * Wallet action methods
 * These should be stable refs (created with useCallback) to prevent re-renders
 */
export interface WalletActionsContextValue {
  /** Trigger Privy login flow */
  login: () => void;
  /** Logout from Privy and disconnect wallets */
  logout: () => Promise<void>;
  /** Connect a wallet via Privy */
  connectWallet: () => void;
  /** Connect Solana wallet specifically */
  connectSolanaWallet: () => void;
  /** Switch to a different Solana wallet */
  switchSolanaWallet: () => void;
  /** Disconnect all wallets and logout */
  disconnect: () => Promise<void>;
}

/**
 * Default no-op implementations for SSR/prerendering
 */
const defaultWalletActionsContextValue: WalletActionsContextValue = {
  login: () => {},
  logout: async () => {},
  connectWallet: () => {},
  connectSolanaWallet: () => {},
  switchSolanaWallet: () => {},
  disconnect: async () => {},
};

export const WalletActionsContext = createContext<WalletActionsContextValue>(
  defaultWalletActionsContextValue,
);

/**
 * Hook to access wallet action methods
 *
 * Use this when you only need to trigger wallet actions without
 * reading connection state. This helps reduce re-renders since
 * the action functions are stable refs.
 *
 * @example
 * ```tsx
 * function LoginButton() {
 *   const { login } = useWalletActions();
 *
 *   return (
 *     <button onClick={login}>
 *       Connect Wallet
 *     </button>
 *   );
 * }
 * ```
 */
export function useWalletActions(): WalletActionsContextValue {
  return useContext(WalletActionsContext);
}
