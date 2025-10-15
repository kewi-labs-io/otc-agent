"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useChainId } from "wagmi";
import { base, hardhat, mainnet } from "wagmi/chains";
import { usePrivy, useWallets, useSolanaWallets } from "@privy-io/react-auth";

type ChainFamily = "evm" | "solana" | "social" | "none";

type MultiWalletContextValue = {
  activeFamily: ChainFamily;
  setActiveFamily: (family: Exclude<ChainFamily, "none">) => void;

  // Connection status
  isConnected: boolean;
  entityId: string | null;
  networkLabel: string; // e.g. "EVM Base" or "Solana Devnet"

  // EVM (via Privy)
  evmConnected: boolean;
  evmAddress?: string;

  // Solana (via Privy)
  solanaConnected: boolean;
  solanaPublicKey?: string;

  // Privy auth
  privyAuthenticated: boolean;
  privyReady: boolean;
  privyUser: any;
  isFarcasterContext: boolean;

  // Helpers
  paymentPairLabel: string; // e.g. "USDC/ETH" or "USDC/SOL"
  
  // Privy methods
  login: () => void;
  logout: () => Promise<void>;
  connectWallet: () => void;
};

const MultiWalletContext = createContext<MultiWalletContextValue | undefined>(
  undefined,
);

export function MultiWalletProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const {
    ready: privyReady,
    authenticated: privyAuthenticated,
    user: privyUser,
    login,
    logout,
    connectWallet,
  } = usePrivy();

  // Get all connected wallets from Privy
  const { wallets } = useWallets(); // EVM wallets
  const { wallets: solanaWallets } = useSolanaWallets(); // Solana wallets
  
  const chainId = useChainId();

  const [activeFamily, setActiveFamilyState] = useState<ChainFamily>("none");
  const [isFarcasterContext, setIsFarcasterContext] = useState(false);

  // Detect Farcaster context
  useEffect(() => {
    if (typeof window === "undefined") return;

    import("@farcaster/miniapp-sdk")
      .then(({ default: miniappSdk }) => {
        miniappSdk.context
          .then((context) => {
            if (context) {
              setIsFarcasterContext(true);
              miniappSdk.actions.ready();
            }
          })
          .catch(() => {
            setIsFarcasterContext(false);
          });
      })
      .catch(() => {
        setIsFarcasterContext(false);
      });
  }, []);

  // Determine connection status from Privy wallets
  const evmConnected = wallets.length > 0;
  const solanaConnected = solanaWallets.length > 0;
  
  // Get primary wallet addresses
  const evmAddress = wallets[0]?.address;
  const solanaPublicKey = solanaWallets[0]?.address;

  // Auto-select active family based on connected wallets
  useEffect(() => {
    if (activeFamily === "none") {
      if (evmConnected) setActiveFamilyState("evm");
      else if (solanaConnected) setActiveFamilyState("solana");
      else if (privyAuthenticated) setActiveFamilyState("social");
    }
  }, [activeFamily, evmConnected, solanaConnected, privyAuthenticated]);

  // If user disconnects active family, flip to the other if available
  useEffect(() => {
    if (activeFamily === "evm" && !evmConnected && solanaConnected) {
      setActiveFamilyState("solana");
    } else if (activeFamily === "solana" && !solanaConnected && evmConnected) {
      setActiveFamilyState("evm");
    } else if (!evmConnected && !solanaConnected && privyAuthenticated) {
      setActiveFamilyState("social");
    } else if (!evmConnected && !solanaConnected && !privyAuthenticated) {
      setActiveFamilyState("none");
    }
  }, [activeFamily, evmConnected, solanaConnected, privyAuthenticated]);

  const setActiveFamily = useCallback(
    (family: Exclude<ChainFamily, "none">) => {
      setActiveFamilyState(family);
    },
    [],
  );

  const isConnected = evmConnected || solanaConnected || privyAuthenticated;

  const evmNetworkName = useMemo(() => {
    if (!chainId) return "Unknown";
    if (chainId === hardhat.id) return "Hardhat";
    if (chainId === mainnet.id) return "Mainnet";
    if (chainId === base.id) return "Base";
    return `Chain ${chainId}`;
  }, [chainId]);

  const solanaCluster =
    process.env.NODE_ENV === "development" ? "devnet" : "mainnet-beta";
  const solanaNetworkName = useMemo(() => {
    if (solanaCluster === "devnet") return "Devnet";
    if (solanaCluster === "mainnet-beta") return "Mainnet";
    return "Unknown";
  }, [solanaCluster]);

  const networkLabel = useMemo(() => {
    if (activeFamily === "evm" && evmConnected) {
      return `EVM ${evmNetworkName}`;
    }
    if (activeFamily === "solana" && solanaConnected) {
      return `Solana ${solanaNetworkName}`;
    }
    if (activeFamily === "social" && privyAuthenticated) {
      return isFarcasterContext ? "Farcaster" : "Social Login";
    }
    if (evmConnected) return `EVM ${evmNetworkName}`;
    if (solanaConnected) return `Solana ${solanaNetworkName}`;
    if (privyAuthenticated) return "Social Login";
    return "Not connected";
  }, [
    activeFamily,
    evmConnected,
    solanaConnected,
    evmNetworkName,
    solanaNetworkName,
    privyAuthenticated,
    isFarcasterContext,
  ]);

  const entityId = useMemo(() => {
    // Return wallet address directly (not UUID) for entity ID
    // Backend APIs will convert to UUID when needed for cache keys
    if (activeFamily === "evm" && evmConnected && evmAddress) {
      return evmAddress.toLowerCase();
    }
    if (activeFamily === "solana" && solanaConnected && solanaPublicKey) {
      return solanaPublicKey.toLowerCase();
    }
    // Fallback if active family not set but one is connected
    if (evmConnected && evmAddress) return evmAddress.toLowerCase();
    if (solanaConnected && solanaPublicKey) return solanaPublicKey.toLowerCase();
    // For social login, use Privy user ID
    if (privyAuthenticated && privyUser?.id) return privyUser.id;
    return null;
  }, [
    activeFamily,
    evmConnected,
    evmAddress,
    solanaConnected,
    solanaPublicKey,
    privyAuthenticated,
    privyUser,
  ]);

  const paymentPairLabel = activeFamily === "solana" ? "USDC/SOL" : "USDC/ETH";

  const value: MultiWalletContextValue = {
    activeFamily,
    setActiveFamily,
    isConnected,
    entityId,
    networkLabel,
    evmConnected,
    evmAddress,
    solanaConnected,
    solanaPublicKey,
    privyAuthenticated,
    privyReady,
    privyUser,
    isFarcasterContext,
    paymentPairLabel,
    login,
    logout,
    connectWallet,
  };

  return (
    <MultiWalletContext.Provider value={value}>
      {children}
    </MultiWalletContext.Provider>
  );
}

export function useMultiWallet(): MultiWalletContextValue {
  const ctx = useContext(MultiWalletContext);
  if (!ctx) {
    throw new Error("useMultiWallet must be used within MultiWalletProvider");
  }
  return ctx;
}
