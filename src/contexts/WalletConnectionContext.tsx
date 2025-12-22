"use client";

/**
 * WalletConnectionContext - Read-Only Wallet State
 *
 * Holds connection status, addresses, and wallet capabilities.
 * Split from MultiWallet to reduce re-renders - components only needing
 * actions don't need to re-render when connection state changes.
 */

import type { User as PrivyUser } from "@privy-io/react-auth";
import { createContext, useContext } from "react";
import type { SolanaWalletAdapter } from "@/types";

/**
 * Read-only wallet connection state
 */
export interface WalletConnectionContextValue {
  // Connection status
  /** True if user is connected (wallet or social auth) */
  isConnected: boolean;
  /** True if any blockchain wallet is connected (not just social auth) */
  hasWallet: boolean;
  /** Entity ID for the current user (wallet address or Privy user ID) */
  entityId: string | null;
  /** Human-readable label for the current network */
  networkLabel: string;

  // EVM wallet state
  /** True if EVM wallet is connected */
  evmConnected: boolean;
  /** EVM wallet address (if connected) */
  evmAddress: string | undefined;

  // Solana wallet state
  /** True if Solana wallet is connected */
  solanaConnected: boolean;
  /** Solana public key as base58 string (if connected) */
  solanaPublicKey: string | undefined;
  /** Solana wallet adapter with signing capabilities (if available) */
  solanaWallet: SolanaWalletAdapter | null;
  /** True if Solana wallet can sign transactions */
  solanaCanSign: boolean;

  // Privy auth state
  /** True if user is authenticated via Privy */
  privyAuthenticated: boolean;
  /** True if Privy has finished loading */
  privyReady: boolean;
  /** Privy user object (if authenticated) */
  privyUser: PrivyUser | null;
  /** True if running in Farcaster miniapp context */
  isFarcasterContext: boolean;

  // Helpers
  /** Payment pair label based on active chain (e.g., "USDC/ETH" or "USDC/SOL") */
  paymentPairLabel: string;
  /** True if Phantom wallet extension is installed */
  isPhantomInstalled: boolean;
  /** Current EVM chain ID (if connected) */
  currentChainId: number | null;
}

/**
 * Default values for SSR/prerendering
 */
const defaultWalletConnectionContextValue: WalletConnectionContextValue = {
  isConnected: false,
  hasWallet: false,
  entityId: null,
  networkLabel: "",
  evmConnected: false,
  evmAddress: undefined,
  solanaConnected: false,
  solanaPublicKey: undefined,
  solanaWallet: null,
  solanaCanSign: false,
  privyAuthenticated: false,
  privyReady: false,
  privyUser: null,
  isFarcasterContext: false,
  paymentPairLabel: "",
  isPhantomInstalled: false,
  currentChainId: null,
};

export const WalletConnectionContext = createContext<WalletConnectionContextValue>(
  defaultWalletConnectionContextValue,
);

/**
 * Hook to access wallet connection state
 *
 * Use this when you need to:
 * - Check if user is connected
 * - Get wallet addresses
 * - Check Privy auth state
 * - Access Solana signing capabilities
 *
 * @example
 * ```tsx
 * function WalletInfo() {
 *   const { hasWallet, evmAddress, solanaPublicKey } = useWalletConnection();
 *
 *   if (!hasWallet) {
 *     return <p>Please connect a wallet</p>;
 *   }
 *
 *   return (
 *     <p>
 *       {evmAddress && `EVM: ${evmAddress}`}
 *       {solanaPublicKey && `Solana: ${solanaPublicKey}`}
 *     </p>
 *   );
 * }
 * ```
 */
export function useWalletConnection(): WalletConnectionContextValue {
  return useContext(WalletConnectionContext);
}
