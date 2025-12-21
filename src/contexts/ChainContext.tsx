"use client";

/**
 * ChainContext - Chain Selection State
 *
 * Handles chain family selection (EVM vs Solana) and EVM chain selection (Base, BSC, etc.)
 * Split from MultiWallet to reduce re-renders - components only using wallet actions
 * don't need to re-render when chain changes.
 */

import { createContext, useContext } from "react";
import type { ChainFamily } from "@/config/chains";
import type { EVMChain } from "@/types";

/**
 * Chain selection state
 */
export interface ChainContextValue {
  /** Active chain family - derived from connection state + user preference. null when no wallet connected */
  activeFamily: ChainFamily | null;
  /** Set the active chain family (evm or solana) */
  setActiveFamily: (family: ChainFamily) => void;
  /** Currently selected EVM chain (Base, BSC, etc.) */
  selectedEVMChain: EVMChain;
  /** Set the selected EVM chain - may trigger wallet chain switch */
  setSelectedEVMChain: (chain: EVMChain) => void;
}

/**
 * Default values for SSR/prerendering
 */
const defaultChainContextValue: ChainContextValue = {
  activeFamily: null,
  setActiveFamily: () => {},
  selectedEVMChain: "base",
  setSelectedEVMChain: () => {},
};

export const ChainContext = createContext<ChainContextValue>(
  defaultChainContextValue,
);

/**
 * Hook to access chain selection state
 *
 * Use this when you need to:
 * - Know which chain family is active (evm/solana)
 * - Switch between chain families
 * - Switch between EVM chains
 *
 * @example
 * ```tsx
 * function ChainSwitcher() {
 *   const { activeFamily, setActiveFamily } = useChain();
 *
 *   return (
 *     <button onClick={() => setActiveFamily("solana")}>
 *       Switch to Solana
 *     </button>
 *   );
 * }
 * ```
 */
export function useChain(): ChainContextValue {
  return useContext(ChainContext);
}
