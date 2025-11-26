"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useChainId, useDisconnect } from "wagmi";
import { base, baseSepolia, bsc, bscTestnet, localhost } from "wagmi/chains";
import {
  usePrivy,
  useWallets,
  type User as PrivyUser,
} from "@privy-io/react-auth";
import { SUPPORTED_CHAINS } from "@/config/chains";
import type { EVMChain } from "@/types";

type ChainFamily = "evm" | "solana" | "social" | "none";

// Interface compatible with @solana/wallet-adapter-react for downstream components
// Using generic Transaction type since Solana SDK Transaction is imported elsewhere
interface SolanaTransaction {
  serialize(): Uint8Array;
  signatures: Array<{
    publicKey: { toBase58(): string };
    signature: Uint8Array | null;
  }>;
}

type SolanaWalletAdapter = {
  publicKey: { toBase58: () => string } | null;
  signTransaction: <T extends SolanaTransaction>(tx: T) => Promise<T>;
  signAllTransactions: <T extends SolanaTransaction>(txs: T[]) => Promise<T[]>;
};

type MultiWalletContextValue = {
  activeFamily: ChainFamily;
  setActiveFamily: (family: Exclude<ChainFamily, "none">) => void;
  selectedEVMChain: EVMChain;
  setSelectedEVMChain: (chain: EVMChain) => void;

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
  solanaWallet: SolanaWalletAdapter | null;

  // Privy auth
  privyAuthenticated: boolean;
  privyReady: boolean;
  privyUser: PrivyUser | null;
  isFarcasterContext: boolean;

  // Helpers
  paymentPairLabel: string; // e.g. "USDC/ETH" or "USDC/SOL"
  isPhantomInstalled: boolean;
  currentChainId: number | null;

  // Privy methods
  login: () => void;
  logout: () => Promise<void>;
  connectWallet: () => void;

  // Solana wallet-adapter methods (mapped to Privy)
  connectSolanaWallet: () => void;
  switchSolanaWallet: () => void;

  // Unified disconnect
  disconnect: () => Promise<void>;
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
  const { wallets } = useWallets();
  const { disconnect: disconnectWagmi } = useDisconnect();

  // Identify EVM and Solana wallets
  // Type assertion needed as Privy types don't fully expose chainType
  const evmWallet = wallets.find(
    (w) => (w as { chainType?: string }).chainType === "ethereum",
  );
  const solanaWallet = wallets.find(
    (w) => (w as { chainType?: string }).chainType === "solana",
  );

  const evmConnected = !!evmWallet;
  const solanaConnected = !!solanaWallet;
  const evmAddress = evmWallet?.address;
  const solanaPublicKey = solanaWallet?.address;

  // Adapter state
  const [solanaWalletAdapter, setSolanaWalletAdapter] =
    useState<SolanaWalletAdapter | null>(null);

  // Solana provider interface (Privy doesn't export these types)
  interface SolanaProvider {
    signTransaction: <T extends SolanaTransaction>(tx: T) => Promise<T>;
    signAllTransactions: <T extends SolanaTransaction>(
      txs: T[],
    ) => Promise<T[]>;
  }

  // Extended wallet type for accessing Privy's Solana provider
  interface PrivySolanaWallet {
    address: string;
    chainType?: string;
    getProvider?: () => Promise<SolanaProvider>;
  }

  // Create adapter when Solana wallet is connected
  useEffect(() => {
    let mounted = true;

    async function createAdapter() {
      if (!solanaWallet) {
        if (mounted) setSolanaWalletAdapter(null);
        return;
      }

      try {
        const typedWallet = solanaWallet as PrivySolanaWallet;
        const provider = await typedWallet.getProvider?.();
        if (mounted && provider) {
          setSolanaWalletAdapter({
            publicKey: { toBase58: () => typedWallet.address },
            signTransaction: <T extends SolanaTransaction>(tx: T) =>
              provider.signTransaction(tx),
            signAllTransactions: <T extends SolanaTransaction>(txs: T[]) =>
              provider.signAllTransactions(txs),
          });
        }
      } catch (error) {
        console.error("Failed to create Solana adapter from Privy:", error);
      }
    }

    createAdapter();

    return () => {
      mounted = false;
    };
  }, [solanaWallet]);

  const chainId = useChainId();

  const [activeFamily, setActiveFamilyState] = useState<ChainFamily>("none");
  const [selectedEVMChain, setSelectedEVMChainState] =
    useState<EVMChain>("base");
  const [isFarcasterContext, setIsFarcasterContext] = useState(false);
  const [isPhantomInstalled, setIsPhantomInstalled] = useState(false);

  // Window type extension for Phantom wallet detection
  type PhantomWindow = Window & {
    phantom?: {
      solana?: {
        isPhantom?: boolean;
      };
    };
  };

  // Detect if Phantom wallet is installed
  useEffect(() => {
    if (typeof window === "undefined") return;

    const checkPhantom = () => {
      const phantomWindow = window as PhantomWindow;
      const isInstalled = !!phantomWindow.phantom?.solana?.isPhantom;
      setIsPhantomInstalled(isInstalled);
    };

    checkPhantom();
    const timer = setTimeout(checkPhantom, 1000);
    return () => clearTimeout(timer);
  }, []);

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

  // Connect Solana wallet - maps to Privy connectWallet
  const connectSolanaWallet = useCallback(() => {
    console.log("[MultiWallet] Connect Solana requested - opening Privy modal");
    connectWallet();
  }, [connectWallet]);

  // Switch Solana wallet - maps to Privy connectWallet
  const switchSolanaWallet = useCallback(() => {
    console.log("[MultiWallet] Switch Solana requested - opening Privy modal");
    connectWallet();
  }, [connectWallet]);

  // Unified disconnect
  const disconnect = useCallback(async () => {
    console.log("[MultiWallet] Disconnecting all wallets...");

    if (evmConnected) {
      disconnectWagmi();
    }

    // Privy logout handles disconnecting all wallets managed by Privy
    await logout();

    // Clear local storage
    if (typeof window !== "undefined") {
      localStorage.removeItem("wagmi.store");
      localStorage.removeItem("wagmi.cache");
      localStorage.removeItem("wagmi.recentConnectorId");
      localStorage.removeItem("privy:token");
      localStorage.removeItem("privy:refresh_token");
    }

    setActiveFamilyState("none");
    console.log("[MultiWallet] Disconnect complete");
  }, [evmConnected, disconnectWagmi, logout]);

  // Auto-select active family and correct mismatches
  useEffect(() => {
    // Initial auto-select when nothing is set
    if (activeFamily === "none") {
      if (evmConnected) {
        console.log("[MultiWallet] Initial auto-select: EVM");
        setActiveFamilyState("evm");
      } else if (solanaConnected) {
        console.log("[MultiWallet] Initial auto-select: Solana");
        setActiveFamilyState("solana");
      } else if (privyAuthenticated) {
        console.log("[MultiWallet] Initial auto-select: social");
        setActiveFamilyState("social");
      }
      return;
    }

    // Correct mismatch: User wanted Solana but only connected EVM (e.g. Phantom EVM)
    if (activeFamily === "solana" && !solanaConnected && evmConnected) {
      console.warn(
        "[MultiWallet] Mismatch detected: Active=Solana but only EVM connected. Switching to EVM.",
      );
      setActiveFamilyState("evm");
    }

    // Correct mismatch: User wanted EVM but only connected Solana
    if (activeFamily === "evm" && !evmConnected && solanaConnected) {
      console.warn(
        "[MultiWallet] Mismatch detected: Active=EVM but only Solana connected. Switching to Solana.",
      );
      setActiveFamilyState("solana");
    }
  }, [activeFamily, evmConnected, solanaConnected, privyAuthenticated]);

  // Reset if disconnected
  useEffect(() => {
    if (
      !evmConnected &&
      !solanaConnected &&
      !privyAuthenticated &&
      activeFamily !== "none"
    ) {
      console.log("[MultiWallet] All disconnected, resetting to none");
      setActiveFamilyState("none");
    }
  }, [evmConnected, solanaConnected, privyAuthenticated, activeFamily]);

  const setActiveFamily = useCallback(
    (family: Exclude<ChainFamily, "none">) => {
      setActiveFamilyState(family);
    },
    [],
  );

  const setSelectedEVMChain = useCallback(
    async (chain: EVMChain) => {
      setSelectedEVMChainState(chain);

      // If EVM wallet is connected, try to switch chain
      if (evmWallet && evmConnected) {
        const targetChainId = SUPPORTED_CHAINS[chain]?.chainId;
        if (targetChainId) {
          try {
            const currentChainId = parseInt(
              evmWallet.chainId.split(":")[1] || evmWallet.chainId,
            );
            if (currentChainId !== targetChainId) {
              console.log(
                `[MultiWallet] Switching EVM chain to ${targetChainId}...`,
              );
              await evmWallet.switchChain(targetChainId);
            }
          } catch (e) {
            console.error("[MultiWallet] Failed to switch EVM chain:", e);
          }
        }
      }
    },
    [evmWallet, evmConnected],
  );

  const isConnected = evmConnected || solanaConnected || privyAuthenticated;

  const evmNetworkName = useMemo(() => {
    if (!chainId) return "Unknown";
    if (chainId === localhost.id) return "Anvil";
    if (chainId === base.id) return "Base";
    if (chainId === baseSepolia.id) return "Base Sepolia";
    if (chainId === bsc.id) return "BSC";
    if (chainId === bscTestnet.id) return "BSC Testnet";
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
      const chainNames: Record<string, string> = {
        base: "Base",
        bsc: "BSC",
      };
      const selectedChainName = chainNames[selectedEVMChain] || evmNetworkName;
      return selectedChainName;
    }
    if (activeFamily === "solana" && solanaConnected) {
      return `Solana ${solanaNetworkName}`;
    }
    if (activeFamily === "social" && privyAuthenticated) {
      return isFarcasterContext ? "Farcaster" : "Social Login";
    }
    if (evmConnected) return `${evmNetworkName}`;
    if (solanaConnected) return `Solana ${solanaNetworkName}`;
    if (privyAuthenticated) return "Social Login";
    return "Not connected";
  }, [
    activeFamily,
    evmConnected,
    solanaConnected,
    selectedEVMChain,
    evmNetworkName,
    solanaNetworkName,
    privyAuthenticated,
    isFarcasterContext,
  ]);

  const entityId = useMemo(() => {
    if (activeFamily === "evm" && evmConnected && evmAddress) {
      return evmAddress.toLowerCase();
    }
    if (activeFamily === "solana" && solanaConnected && solanaPublicKey) {
      return solanaPublicKey.toLowerCase();
    }
    if (evmConnected && evmAddress) return evmAddress.toLowerCase();
    if (solanaConnected && solanaPublicKey)
      return solanaPublicKey.toLowerCase();
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
    selectedEVMChain,
    setSelectedEVMChain,
    isConnected,
    entityId,
    networkLabel,
    evmConnected,
    evmAddress,
    solanaConnected,
    solanaPublicKey,
    solanaWallet: solanaWalletAdapter,
    privyAuthenticated,
    privyReady,
    privyUser,
    isFarcasterContext,
    paymentPairLabel,
    isPhantomInstalled,
    currentChainId: chainId ?? null,
    login,
    logout,
    connectWallet,
    connectSolanaWallet,
    switchSolanaWallet,
    disconnect,
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
