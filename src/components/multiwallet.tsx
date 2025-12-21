"use client";

import {
  type User as PrivyUser,
  usePrivy,
  useWallets,
} from "@privy-io/react-auth";
import { useWallet as useSolanaWalletAdapter } from "@solana/wallet-adapter-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAccount, useChainId, useConnect, useDisconnect } from "wagmi";
import { base, baseSepolia, bsc, bscTestnet, localhost } from "wagmi/chains";
import { type ChainFamily, SUPPORTED_CHAINS } from "@/config/chains";
import type {
  EVMChain,
  PhantomSolanaProvider,
  PhantomWindow,
  PrivySolanaWallet,
  SolanaTransaction,
  SolanaWalletAdapter,
} from "@/types";
import { useRenderTracker } from "@/utils/render-tracker";
import { clearWalletCaches } from "@/utils/wallet-utils";

type MultiWalletContextValue = {
  // Active chain family - derived from connection state + user preference
  // null when no wallet is connected
  activeFamily: ChainFamily | null;
  setActiveFamily: (family: ChainFamily) => void;

  // EVM-specific chain selection (Base, BSC, etc.)
  selectedEVMChain: EVMChain;
  setSelectedEVMChain: (chain: EVMChain) => void;

  // Connection status
  isConnected: boolean;
  hasWallet: boolean; // True if any blockchain wallet connected (not just social auth)
  entityId: string | null;
  networkLabel: string;

  // EVM wallet state
  evmConnected: boolean;
  evmAddress: string | undefined;

  // Solana wallet state
  solanaConnected: boolean;
  solanaPublicKey: string | undefined;
  solanaWallet: SolanaWalletAdapter | null;
  solanaCanSign: boolean; // True only if we have an active wallet that can sign

  // Privy auth state
  privyAuthenticated: boolean;
  privyReady: boolean;
  privyUser: PrivyUser | null;
  isFarcasterContext: boolean;

  // Helpers
  paymentPairLabel: string;
  isPhantomInstalled: boolean;
  currentChainId: number | null;

  // Auth methods
  login: () => void;
  logout: () => Promise<void>;
  connectWallet: () => void;
  connectSolanaWallet: () => void;
  switchSolanaWallet: () => void;
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
  useRenderTracker("MultiWalletProvider");

  const {
    ready: privyReady,
    authenticated: privyAuthenticated,
    user: privyUser,
    login,
    logout,
    connectWallet,
  } = usePrivy();

  const { wallets } = useWallets();
  const { disconnect: disconnectWagmi } = useDisconnect();
  const { connect: connectWagmi, connectors } = useConnect();
  const { isConnected: isWagmiConnected, address: wagmiAddress } = useAccount();
  const chainId = useChainId();

  // Solana Wallet Adapter - detects Farcaster wallet via Wallet Standard (FarcasterSolanaProvider)
  const {
    publicKey: walletAdapterPublicKey,
    wallet: walletAdapterWallet,
    signTransaction: walletAdapterSignTransaction,
    signAllTransactions: walletAdapterSignAllTransactions,
    connected: walletAdapterConnected,
  } = useSolanaWalletAdapter();

  // Track previous state to avoid logging on every render
  const prevStateRef = useRef<string | null>(null);

  // === Derived wallet state ===
  // Check BOTH Privy wallets array AND wagmi direct connection AND Privy user linkedAccounts
  interface PrivyWallet {
    chainType?: string;
    address?: string;
  }

  const privyEvmWallet = useMemo(() => {
    const wallet = wallets.find((w) => {
      const typed = w as PrivyWallet;
      return typed.chainType === "ethereum";
    });
    // FAIL-FAST: If found, validate it has required fields
    if (wallet) {
      const typed = wallet as PrivyWallet;
      if (!typed.address) {
        throw new Error("Privy EVM wallet missing address");
      }
    }
    return wallet;
  }, [wallets]);
  const privySolanaWallet = useMemo(() => {
    const wallet = wallets.find((w) => {
      const typed = w as PrivyWallet;
      return typed.chainType === "solana";
    });
    // FAIL-FAST: If found, validate it has required fields
    if (wallet) {
      const typed = wallet as PrivyWallet;
      if (!typed.address) {
        throw new Error("Privy Solana wallet missing address");
      }
    }
    return wallet;
  }, [wallets]);

  // Also check Privy user's linkedAccounts for wallet addresses
  interface PrivyLinkedAccount {
    type: string;
    chainType?: string;
    address?: string;
  }

  const linkedEvmAddress = useMemo(() => {
    if (!privyUser || !privyUser.linkedAccounts) return undefined;
    const evmAccount = privyUser.linkedAccounts.find(
      (a) =>
        a.type === "wallet" &&
        (a as PrivyLinkedAccount).chainType === "ethereum",
    );
    if (evmAccount) {
      const typed = evmAccount as PrivyLinkedAccount;
      // FAIL-FAST: Validate address exists
      if (!typed.address) {
        throw new Error("Linked EVM account missing address");
      }
      return typed.address;
    }
    return undefined;
  }, [privyUser]);

  const linkedSolanaAddress = useMemo(() => {
    if (!privyUser || !privyUser.linkedAccounts) return undefined;
    const solanaAccount = privyUser.linkedAccounts.find(
      (a) =>
        a.type === "wallet" && (a as PrivyLinkedAccount).chainType === "solana",
    );
    if (solanaAccount) {
      const typed = solanaAccount as PrivyLinkedAccount;
      // FAIL-FAST: Validate address exists
      if (!typed.address) {
        throw new Error("Linked Solana account missing address");
      }
      return typed.address;
    }
    return undefined;
  }, [privyUser]);

  // Track if we have ACTIVE wallets (in the wallets array) vs just linked accounts
  const hasActiveEvmWallet = !!privyEvmWallet || isWagmiConnected;
  // Solana: Check BOTH Wallet Standard (Farcaster) AND Privy wallets
  const hasActiveSolanaWallet = walletAdapterConnected || !!privySolanaWallet;

  // EVM: connected if Privy has wallet OR wagmi is directly connected OR linked account
  const evmConnected = hasActiveEvmWallet || !!linkedEvmAddress;
  const evmAddress = (() => {
    if (privyEvmWallet) {
      const typed = privyEvmWallet as PrivyWallet;
      if (!typed.address) {
        throw new Error("Privy EVM wallet missing address");
      }
      return typed.address;
    }
    return wagmiAddress || linkedEvmAddress;
  })();

  // Solana: through Wallet Standard (Farcaster) OR Privy wallets array OR linked accounts
  // Wallet Standard wallet (from FarcasterSolanaProvider) takes priority
  const solanaConnected = hasActiveSolanaWallet || !!linkedSolanaAddress;
  const solanaPublicKey = (() => {
    if (walletAdapterPublicKey) {
      return walletAdapterPublicKey.toBase58();
    }
    if (privySolanaWallet) {
      const typed = privySolanaWallet as PrivyWallet;
      if (!typed.address) {
        throw new Error("Privy Solana wallet missing address");
      }
      return typed.address;
    }
    return linkedSolanaAddress;
  })();

  // For Solana adapter, prefer Wallet Standard (Farcaster) over Privy wallet
  const solanaWalletRaw = privySolanaWallet;
  const hasFarcasterSolanaWallet =
    walletAdapterConnected && walletAdapterPublicKey;

  // === User preference state ===
  // Persisted to localStorage to remember user's chain choice across sessions
  // Use ref to track if we've initialized to avoid re-running initialization logic
  const preferenceInitializedRef = useRef(false);

  const [preferredFamily, setPreferredFamily] = useState<ChainFamily | null>(
    () => {
      if (typeof window === "undefined") return null;
      const saved = localStorage.getItem("otc-preferred-chain");
      if (saved === "evm" || saved === "solana") return saved;
      return null;
    },
  );
  const [selectedEVMChain, setSelectedEVMChainState] =
    useState<EVMChain>("base");

  // Combined effect for localStorage persistence and listening
  // Consolidated to prevent cascading state updates
  // Track preferredFamily in a ref to avoid stale closures in event handlers
  const preferredFamilyRef = useRef(preferredFamily);
  preferredFamilyRef.current = preferredFamily;

  // Persist preference to localStorage - separate effect to avoid loop
  useEffect(() => {
    if (preferredFamily && typeof window !== "undefined") {
      localStorage.setItem("otc-preferred-chain", preferredFamily);
    }
  }, [preferredFamily]);

  // Set up event listeners - only once on mount
  useEffect(() => {
    if (typeof window === "undefined") return;

    // Only set up listeners - don't check localStorage here as initial state handles that
    const handleStorageChange = (e: StorageEvent) => {
      // Only respond to actual storage events from other tabs/windows
      if (e.key !== "otc-preferred-chain") return;
      const saved = e.newValue;
      if (saved === "evm" || saved === "solana") {
        setPreferredFamily(saved);
      }
    };

    const handleCustomEvent = () => {
      const saved = localStorage.getItem("otc-preferred-chain");
      // Use ref to compare to avoid triggering unnecessarily
      if (
        (saved === "evm" || saved === "solana") &&
        saved !== preferredFamilyRef.current
      ) {
        setPreferredFamily(saved);
      }
    };

    window.addEventListener("storage", handleStorageChange);
    window.addEventListener("otc-chain-preference-changed", handleCustomEvent);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener(
        "otc-chain-preference-changed",
        handleCustomEvent,
      );
    };
  }, []); // Empty deps - listeners set up once

  // Reset preference initialization when user logs out (handles all logout paths)
  useEffect(() => {
    if (!privyAuthenticated) {
      preferenceInitializedRef.current = false;
    }
  }, [privyAuthenticated]);

  // Auto-set preference when user connects a wallet for the first time after login
  // Using a ref to ensure this only runs once per session
  useEffect(() => {
    // Skip if preference already set or not authenticated
    if (preferredFamily || !privyAuthenticated) return;
    // Skip if we've already successfully initialized this session
    if (preferenceInitializedRef.current) return;

    // Determine preference based on connected wallets
    // Check Solana FIRST since it's explicit (user chose Solana wallet)
    if (privySolanaWallet) {
      preferenceInitializedRef.current = true;
      setPreferredFamily("solana");
    } else if (privyEvmWallet || isWagmiConnected) {
      preferenceInitializedRef.current = true;
      setPreferredFamily("evm");
    }
    // Don't set ref to true if no wallet detected yet - let effect re-run when wallet loads
  }, [
    privyAuthenticated,
    preferredFamily,
    isWagmiConnected,
    privyEvmWallet,
    privySolanaWallet,
  ]);

  // === Derived active family ===
  // Single source of truth: derived from connection state + preference
  const activeFamily = useMemo<ChainFamily | null>(() => {
    // If user has a preference AND that wallet is connected, honor it
    if (preferredFamily === "solana" && solanaConnected) return "solana";
    if (preferredFamily === "evm" && evmConnected) return "evm";

    // No explicit preference - prioritize ACTIVE wallets (in wallets array) over linked accounts
    // If user has an active wallet, use that chain
    if (hasActiveSolanaWallet) return "solana";
    if (hasActiveEvmWallet) return "evm";

    // No active wallets - only linked accounts exist
    // If only one chain is linked, use that
    if (solanaConnected && !evmConnected) return "solana";
    if (evmConnected && !solanaConnected) return "evm";

    // Both linked but no active wallet and no preference
    // Return "evm" as default but log that user should choose
    // The UI should show chain switcher buttons in this case
    if (evmConnected && solanaConnected) {
      console.log(
        "[MultiWallet] Both chains linked, no active wallet - defaulting to EVM. Use chain switcher to change.",
      );
      return "evm";
    }

    if (evmConnected) return "evm";
    if (solanaConnected) return "solana";

    // No wallet connected
    return null;
  }, [
    preferredFamily,
    evmConnected,
    solanaConnected,
    hasActiveEvmWallet,
    hasActiveSolanaWallet,
  ]);

  // === Environment detection ===
  // Use refs to ensure these only run once
  const envDetectionRef = useRef(false);
  const farcasterAutoConnectRef = useRef(false);

  const [isFarcasterContext, setIsFarcasterContext] = useState(false);
  const [isPhantomInstalled, setIsPhantomInstalled] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || envDetectionRef.current) return;
    envDetectionRef.current = true;

    // Detect Phantom - check immediately and once after delay
    const checkPhantom = () => {
      const phantomWindow = window as PhantomWindow;
      const hasPhantom = Boolean(
        phantomWindow.phantom &&
          phantomWindow.phantom.solana &&
          phantomWindow.phantom.solana.isPhantom === true,
      );
      setIsPhantomInstalled((prev) =>
        prev !== hasPhantom ? hasPhantom : prev,
      );
    };
    checkPhantom();
    const timer = setTimeout(checkPhantom, 1000);

    // Detect Farcaster (expected to fail in non-Farcaster environments)
    import("@farcaster/miniapp-sdk")
      .then(({ default: miniappSdk }) => {
        miniappSdk.context
          .then((context) => {
            if (context) {
              setIsFarcasterContext(true);
              miniappSdk.actions.ready();
            }
          })
          .catch((err) => {
            if (process.env.NODE_ENV === "development") {
              console.debug("[MultiWallet] Not in Farcaster context:", err);
            }
          });
      })
      .catch((err) => {
        if (process.env.NODE_ENV === "development") {
          console.debug("[MultiWallet] Farcaster SDK not available:", err);
        }
      });

    return () => clearTimeout(timer);
  }, []);

  // === Farcaster auto-connect ===
  useEffect(() => {
    // Guard against multiple executions
    if (farcasterAutoConnectRef.current) return;
    if (
      !isFarcasterContext ||
      isWagmiConnected ||
      !connectors ||
      connectors.length === 0
    )
      return;

    const farcasterConnector = connectors.find(
      (c) => c.id === "farcasterMiniApp" || c.id === "farcasterFrame",
    );
    if (farcasterConnector) {
      farcasterAutoConnectRef.current = true;
      connectWagmi({ connector: farcasterConnector });
    }
  }, [isFarcasterContext, isWagmiConnected, connectors, connectWagmi]);

  // === Solana wallet adapter ===
  // Priority: Wallet Standard (Farcaster) > Privy wallet > Phantom direct
  // Track current wallet address to avoid recreating adapter unnecessarily
  const solanaWalletAddressRef = useRef<string | null>(null);
  const [solanaWalletAdapter, setSolanaWalletAdapter] =
    useState<SolanaWalletAdapter | null>(null);

  // PhantomSolanaProvider imported from @/types

  useEffect(() => {
    let mounted = true;

    // Determine which wallet source to use - Farcaster wallet takes priority
    const useFarcasterWallet =
      hasFarcasterSolanaWallet && walletAdapterSignTransaction;
    const currentAddress = (() => {
      if (useFarcasterWallet && walletAdapterPublicKey) {
        return walletAdapterPublicKey.toBase58();
      }
      if (privySolanaWallet) {
        const typed = privySolanaWallet as PrivyWallet;
        if (!typed.address) {
          throw new Error("Privy Solana wallet missing address");
        }
        return typed.address;
      }
      return linkedSolanaAddress || null;
    })();

    // Skip if wallet address hasn't changed
    if (solanaWalletAddressRef.current === currentAddress) return;
    solanaWalletAddressRef.current = currentAddress;

    async function createAdapter() {
      // === FARCASTER WALLET (via Wallet Standard) ===
      // This wallet is registered by FarcasterSolanaProvider and detected via @solana/wallet-adapter-react
      if (
        useFarcasterWallet &&
        walletAdapterPublicKey &&
        walletAdapterSignTransaction &&
        walletAdapterSignAllTransactions
      ) {
        if (process.env.NODE_ENV === "development") {
          console.log(
            "[MultiWallet] Using Farcaster Solana wallet via Wallet Standard:",
            {
              publicKey: walletAdapterPublicKey.toBase58(),
              walletName:
                walletAdapterWallet && walletAdapterWallet.adapter
                  ? walletAdapterWallet.adapter.name
                  : undefined,
            },
          );
        }

        if (mounted) {
          // Type assertion needed because wallet adapter uses Transaction | VersionedTransaction
          // while our interface uses a more generic SolanaTransaction type
          setSolanaWalletAdapter({
            publicKey: walletAdapterPublicKey,
            signTransaction:
              walletAdapterSignTransaction as SolanaWalletAdapter["signTransaction"],
            signAllTransactions:
              walletAdapterSignAllTransactions as SolanaWalletAdapter["signAllTransactions"],
          });
        }
        return;
      }

      // === PRIVY WALLET (fallback for non-Farcaster context) ===
      if (solanaWalletRaw) {
        const typedWallet = solanaWalletRaw as PrivySolanaWallet;
        const provider = await typedWallet.getProvider?.();
        if (mounted && provider) {
          if (process.env.NODE_ENV === "development") {
            console.log(
              "[MultiWallet] Using Privy Solana wallet:",
              typedWallet.address,
            );
          }
          setSolanaWalletAdapter({
            publicKey: { toBase58: () => typedWallet.address },
            signTransaction: <T extends SolanaTransaction>(tx: T) =>
              provider.signTransaction(tx),
            signAllTransactions: <T extends SolanaTransaction>(txs: T[]) =>
              provider.signAllTransactions(txs),
          });
          return;
        }
      }

      // === PHANTOM DIRECT (fallback for linked accounts without active wallet) ===
      // Only use Phantom if it's ALREADY connected - don't auto-connect as it can fail/annoy users
      if (linkedSolanaAddress && typeof window !== "undefined") {
        const phantom = ((
          window as Window & { phantom?: { solana?: PhantomSolanaProvider } }
        ).phantom?.solana ||
          (window as Window & { solana?: PhantomSolanaProvider }).solana) as
          | PhantomSolanaProvider
          | undefined;

        if (
          phantom &&
          phantom.isPhantom &&
          phantom.isConnected &&
          phantom.publicKey
        ) {
          const phantomAddress = phantom.publicKey.toBase58();

          // Only use Phantom if addresses match
          if (phantomAddress === linkedSolanaAddress) {
            console.log("[MultiWallet] Using already-connected Phantom wallet");
            if (mounted) {
              setSolanaWalletAdapter({
                publicKey: { toBase58: () => linkedSolanaAddress },
                signTransaction: <T extends SolanaTransaction>(tx: T) =>
                  phantom.signTransaction(tx),
                signAllTransactions: <T extends SolanaTransaction>(txs: T[]) =>
                  phantom.signAllTransactions(txs),
              });
            }
            return;
          } else {
            console.log(
              "[MultiWallet] Phantom connected but address mismatch:",
              {
                phantomAddress,
                linkedSolanaAddress,
              },
            );
          }
        } else if (phantom && phantom.isPhantom) {
          // Phantom available but not connected - user needs to connect via Privy UI
          console.log(
            "[MultiWallet] Phantom available but not connected - use Connect Wallet button",
          );
        }
      }

      // No adapter could be created
      if (mounted) setSolanaWalletAdapter(null);
    }

    createAdapter();
    return () => {
      mounted = false;
    };
  }, [
    solanaWalletRaw,
    privySolanaWallet,
    linkedSolanaAddress,
    hasFarcasterSolanaWallet,
    walletAdapterPublicKey,
    walletAdapterWallet,
    walletAdapterSignTransaction,
    walletAdapterSignAllTransactions,
  ]);

  // === Action handlers ===
  const setActiveFamily = useCallback((family: ChainFamily) => {
    console.log("[MultiWallet] setActiveFamily called with:", family);
    setPreferredFamily(family);
    // Immediately persist to localStorage
    if (typeof window !== "undefined") {
      localStorage.setItem("otc-preferred-chain", family);
    }
  }, []);

  const setSelectedEVMChain = useCallback(
    async (chain: EVMChain) => {
      setSelectedEVMChainState(chain);

      // Only switch chain if we have a Privy-managed wallet (has switchChain method)
      if (privyEvmWallet && evmConnected) {
        // FAIL-FAST: chain must be valid Chain type, SUPPORTED_CHAINS guarantees ChainConfig exists
        if (!(chain in SUPPORTED_CHAINS)) {
          throw new Error(`Unsupported chain: ${chain}`);
        }
        const chainConfig = SUPPORTED_CHAINS[chain];
        // FAIL-FAST: EVM chains must have chainId (optional in interface but required for EVM)
        if (chainConfig.chainId === undefined || chainConfig.chainId === null) {
          throw new Error(`Chain config missing chainId for chain: ${chain}`);
        }
        const targetChainId = chainConfig.chainId;
        const typedWallet = privyEvmWallet as PrivyWallet & {
          chainId: string;
          switchChain: (id: number) => Promise<void>;
        };
        const currentChainId = parseInt(
          typedWallet.chainId.split(":")[1] || typedWallet.chainId,
        );
        if (currentChainId !== targetChainId) {
          await typedWallet.switchChain(targetChainId);
        }
      }
    },
    [privyEvmWallet, evmConnected],
  );

  const connectSolanaWallet = useCallback(
    () => connectWallet(),
    [connectWallet],
  );
  const switchSolanaWallet = useCallback(
    () => connectWallet(),
    [connectWallet],
  );

  const disconnect = useCallback(async () => {
    if (evmConnected) disconnectWagmi();
    await logout();

    // Clear all wallet caches
    clearWalletCaches();
    // Also clear chain preference on logout
    if (typeof window !== "undefined") {
      localStorage.removeItem("otc-preferred-chain");
    }

    setPreferredFamily(null);
    // Reset initialization ref so preference is re-detected on next login
    preferenceInitializedRef.current = false;
  }, [evmConnected, disconnectWagmi, logout]);

  // === Derived values ===
  // hasWallet: true if any blockchain wallet is available (active or linked)
  const hasWallet = evmConnected || solanaConnected;
  const isConnected = hasWallet || privyAuthenticated;

  // solanaCanSign: true only if we have an active wallet adapter with signing capability
  // This is different from solanaConnected which may be true with just a linked address
  const solanaCanSign =
    solanaWalletAdapter !== null &&
    solanaWalletAdapter.signTransaction !== undefined;

  // Debug logging in development - only log when state actually changes
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;

    const stateKey = JSON.stringify({
      evmConnected,
      solanaConnected,
      activeFamily,
      hasWallet,
      evmAddress,
      solanaPublicKey,
      preferredFamily,
    });

    // Only log if state actually changed
    if (prevStateRef.current === stateKey) return;
    prevStateRef.current = stateKey;

    console.log("[MultiWallet] State changed:", {
      privyAuthenticated,
      privyReady,
      walletsCount: wallets.length,
      hasActiveEvmWallet,
      hasActiveSolanaWallet,
      linkedEvmAddress,
      linkedSolanaAddress,
      isWagmiConnected,
      evmConnected,
      solanaConnected,
      evmAddress,
      solanaPublicKey,
      preferredFamily,
      activeFamily,
      hasWallet,
    });
  }, [
    evmConnected,
    solanaConnected,
    activeFamily,
    hasWallet,
    evmAddress,
    solanaPublicKey,
    preferredFamily,
    hasActiveEvmWallet,
    hasActiveSolanaWallet,
    privyAuthenticated,
    privyReady,
    wallets.length,
    linkedEvmAddress,
    linkedSolanaAddress,
    isWagmiConnected,
  ]);

  const evmNetworkName = useMemo(() => {
    if (!chainId) return "Unknown";
    const chainNames: Record<number, string> = {
      [localhost.id]: "Anvil",
      [base.id]: "Base",
      [baseSepolia.id]: "Base Sepolia",
      [bsc.id]: "BSC",
      [bscTestnet.id]: "BSC Testnet",
    };
    return chainNames[chainId] ?? `Chain ${chainId}`;
  }, [chainId]);

  const solanaNetworkName =
    process.env.NODE_ENV === "development" ? "Devnet" : "Mainnet";

  const networkLabel = useMemo(() => {
    if (activeFamily === "evm") {
      const chainNames: Record<string, string> = { base: "Base", bsc: "BSC" };
      return chainNames[selectedEVMChain] || evmNetworkName;
    }
    if (activeFamily === "solana") {
      return `Solana ${solanaNetworkName}`;
    }
    // No wallet connected - show auth status
    if (privyAuthenticated) {
      return isFarcasterContext ? "Farcaster" : "Signed In";
    }
    return "Not connected";
  }, [
    activeFamily,
    selectedEVMChain,
    evmNetworkName,
    solanaNetworkName,
    privyAuthenticated,
    isFarcasterContext,
  ]);

  const entityId = useMemo(() => {
    if (activeFamily === "evm" && evmAddress) return evmAddress.toLowerCase();
    if (activeFamily === "solana" && solanaPublicKey) return solanaPublicKey;
    // Fallback for social-only auth
    if (privyAuthenticated && privyUser && privyUser.id) return privyUser.id;
    return null;
  }, [
    activeFamily,
    evmAddress,
    solanaPublicKey,
    privyAuthenticated,
    privyUser,
  ]);

  const paymentPairLabel = activeFamily === "solana" ? "USDC/SOL" : "USDC/ETH";

  // === Context value - memoized to prevent unnecessary child re-renders ===
  const value = useMemo<MultiWalletContextValue>(
    () => ({
      activeFamily,
      setActiveFamily,
      selectedEVMChain,
      setSelectedEVMChain,
      isConnected,
      hasWallet,
      entityId,
      networkLabel,
      evmConnected,
      evmAddress,
      solanaConnected,
      solanaPublicKey,
      solanaWallet: solanaWalletAdapter,
      solanaCanSign,
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
    }),
    [
      activeFamily,
      setActiveFamily,
      selectedEVMChain,
      setSelectedEVMChain,
      isConnected,
      hasWallet,
      entityId,
      networkLabel,
      evmConnected,
      evmAddress,
      solanaConnected,
      solanaPublicKey,
      solanaWalletAdapter,
      solanaCanSign,
      privyAuthenticated,
      privyReady,
      privyUser,
      isFarcasterContext,
      paymentPairLabel,
      isPhantomInstalled,
      chainId,
      login,
      logout,
      connectWallet,
      connectSolanaWallet,
      switchSolanaWallet,
      disconnect,
    ],
  );

  return (
    <MultiWalletContext.Provider value={value}>
      {children}
    </MultiWalletContext.Provider>
  );
}

// Default values for SSR/prerendering
const defaultContextValue: MultiWalletContextValue = {
  activeFamily: null,
  setActiveFamily: () => {},
  selectedEVMChain: "base",
  setSelectedEVMChain: () => {},
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
  login: () => {},
  logout: async () => {},
  connectWallet: () => {},
  connectSolanaWallet: () => {},
  switchSolanaWallet: () => {},
  disconnect: async () => {},
};

export function useMultiWallet(): MultiWalletContextValue {
  const ctx = useContext(MultiWalletContext);
  return ctx ?? defaultContextValue;
}
