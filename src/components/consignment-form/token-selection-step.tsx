"use client";

import { usePrivy } from "@privy-io/react-auth";
import { ExternalLink, Loader2, RefreshCw, Search, X } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useChainId } from "wagmi";
import {
  base,
  baseSepolia,
  bsc,
  bscTestnet,
  mainnet,
  sepolia,
} from "wagmi/chains";
import { InlineLoading } from "@/components/ui/loading-spinner";
import type { Chain } from "@/config/chains";
import { usePrefetchPoolCheck } from "@/hooks/usePoolCheck";
import { useTokenLookup } from "@/hooks/useTokenLookup";
import {
  useRefetchWalletTokens,
  useWalletTokens,
  type WalletToken,
} from "@/hooks/useWalletTokens";
import {
  isContractAddress,
  isEvmAddress,
  isSolanaAddress,
} from "@/utils/address-utils";
import { formatRawTokenAmount, formatUsdCompact } from "@/utils/format";
import { Button } from "../button";
import { useMultiWallet } from "../multiwallet";

// Token avatar component with fallback on image error
function TokenAvatar({
  logoUrl,
  symbol,
  size = 44,
  ringClass = "ring-2 ring-zinc-100 dark:ring-zinc-800",
}: {
  logoUrl?: string;
  symbol: string;
  size?: number;
  ringClass?: string;
}) {
  const [hasError, setHasError] = useState(false);

  // Reset error state when logoUrl changes
  useEffect(() => {
    setHasError(false);
  }, [logoUrl]);

  if (!logoUrl || hasError) {
    return (
      <div
        className={`rounded-full bg-gradient-to-br from-brand-400 to-brand-500 flex items-center justify-center`}
        style={{ width: size, height: size }}
      >
        <span className="text-white font-bold" style={{ fontSize: size * 0.4 }}>
          {symbol.charAt(0)}
        </span>
      </div>
    );
  }

  return (
    <Image
      src={logoUrl}
      alt={symbol}
      width={size}
      height={size}
      className={`rounded-full ${ringClass}`}
      style={{ width: size, height: size }}
      onError={() => setHasError(true)}
    />
  );
}

// Re-export type from hook for compatibility
export type TokenWithBalance = WalletToken;

interface TokenSelectionProps {
  formData: { tokenId: string };
  updateFormData: (updates: { tokenId: string }) => void;
  onNext: () => void;
  onTokenSelect?: (token: TokenWithBalance) => void;
}

// formatBalance uses centralized formatRawTokenAmount from @/utils/format
// formatUsd uses centralized formatUsdCompact from @/utils/format

export function TokenSelectionStep({
  formData,
  updateFormData,
  onNext,
  onTokenSelect,
}: TokenSelectionProps) {
  const {
    activeFamily,
    setActiveFamily,
    evmAddress,
    solanaPublicKey,
    evmConnected,
    solanaConnected,
    hasWallet,
    privyAuthenticated,
    connectWallet,
  } = useMultiWallet();
  const { login, ready: privyReady } = usePrivy();
  const chainId = useChainId();

  // Determine initial chain from connected wallet
  const getInitialChain = useCallback((): Chain => {
    if (activeFamily === "solana") return "solana";
    if (chainId === mainnet.id || chainId === sepolia.id) return "ethereum";
    if (chainId === bsc.id || chainId === bscTestnet.id) return "bsc";
    if (chainId === base.id || chainId === baseSepolia.id) return "base";
    return "base"; // Default fallback
  }, [activeFamily, chainId]);

  // Local state for selected chain - allows switching between all chains
  const [selectedChain, setSelectedChain] = useState<Chain>(getInitialChain);
  const [searchQuery, setSearchQuery] = useState("");

  // Sync selectedChain when activeFamily changes (e.g., when user connects a Solana wallet)
  useEffect(() => {
    if (activeFamily === "solana" && selectedChain !== "solana") {
      setSelectedChain("solana");
    } else if (activeFamily === "evm" && selectedChain === "solana") {
      // If user switches to EVM wallet, default to base
      setSelectedChain("base");
    }
  }, [activeFamily, selectedChain]);

  // Sync activeFamily when selectedChain changes
  const handleChainSelect = useCallback(
    (chain: Chain) => {
      setSelectedChain(chain);
      if (chain === "solana") {
        setActiveFamily("solana");
      } else {
        setActiveFamily("evm");
      }
    },
    [setActiveFamily],
  );

  // Determine which chains are available based on connected wallets
  const availableChains = useMemo(() => {
    const chains: Chain[] = [];
    if (evmConnected) {
      chains.push("ethereum", "base", "bsc");
    }
    if (solanaConnected) {
      chains.push("solana");
    }
    return chains;
  }, [evmConnected, solanaConnected]);

  // Use React Query for wallet tokens (cached, deduplicated)
  const chain = selectedChain;
  const userAddress = selectedChain === "solana" ? solanaPublicKey : evmAddress;

  const {
    data: tokens = [],
    isLoading: loading,
    isFetched: hasLoadedOnce,
    refetch: refetchTokens,
  } = useWalletTokens(userAddress ?? undefined, chain, {
    enabled: hasWallet && !!userAddress,
  });

  const refetchWalletTokens = useRefetchWalletTokens();
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Filter tokens by search query (symbol or name)
  const filteredTokens = useMemo(() => {
    if (!searchQuery.trim()) return tokens;
    const query = searchQuery.toLowerCase().trim();
    return tokens.filter(
      (t) =>
        t.symbol.toLowerCase().includes(query) ||
        t.name.toLowerCase().includes(query) ||
        t.contractAddress.toLowerCase().includes(query),
    );
  }, [tokens, searchQuery]);

  // Detect if we should search by address
  const searchIsAddress = useMemo(() => {
    const trimmed = searchQuery.trim();
    return trimmed.length > 0 && isContractAddress(trimmed);
  }, [searchQuery]);

  // Check if the searched address is already in wallet
  const addressFoundInWallet = useMemo(() => {
    if (!searchIsAddress) return false;
    const query = searchQuery.trim().toLowerCase();
    return tokens.some((t) => t.contractAddress.toLowerCase() === query);
  }, [searchIsAddress, searchQuery, tokens]);

  // Determine lookup chain based on address format
  const lookupChain = useMemo((): Chain | undefined => {
    const trimmed = searchQuery.trim();
    if (!searchIsAddress || addressFoundInWallet) return undefined;
    return isSolanaAddress(trimmed)
      ? "solana"
      : selectedChain === "solana"
        ? "base"
        : selectedChain;
  }, [searchQuery, searchIsAddress, addressFoundInWallet, selectedChain]);

  // Use React Query for token lookup - automatic caching and deduplication
  const {
    token: lookupResult,
    isSearching: isSearchingAddress,
    searchError: addressSearchError,
  } = useTokenLookup(
    searchIsAddress && !addressFoundInWallet ? searchQuery.trim() : null,
    lookupChain,
  );

  // Convert lookup result to WalletToken format
  const searchedToken = useMemo((): TokenWithBalance | null => {
    if (!lookupResult) return null;
    return {
      id: `token-${lookupResult.chain}-${lookupResult.address}`,
      symbol: lookupResult.symbol,
      name: lookupResult.name,
      contractAddress: lookupResult.address,
      chain: lookupResult.chain as Chain,
      decimals: lookupResult.decimals,
      logoUrl: lookupResult.logoUrl ?? "",
      description: "",
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      balance: "0", // User doesn't have this token
      balanceUsd: 0,
      priceUsd: lookupResult.priceUsd ?? 0,
    };
  }, [lookupResult]);

  const handleConnect = useCallback(() => {
    if (privyAuthenticated) {
      connectWallet();
    } else {
      login();
    }
  }, [privyAuthenticated, connectWallet, login]);

  // Refresh handler using React Query's refetch
  const handleRefresh = useCallback(async () => {
    if (!userAddress) return;
    setIsRefreshing(true);
    await refetchWalletTokens(userAddress, chain);
    await refetchTokens();
    setIsRefreshing(false);
  }, [userAddress, chain, refetchWalletTokens, refetchTokens]);

  const prefetchPoolCheck = usePrefetchPoolCheck();

  // Prefetch pool check on hover for faster form-step loading
  const handleTokenHover = useCallback(
    (token: TokenWithBalance) => {
      // Prefetch pool check for EVM tokens (Solana doesn't use pool checks)
      if (token.chain !== "solana") {
        prefetchPoolCheck(token.contractAddress, token.chain);
      }
    },
    [prefetchPoolCheck],
  );

  const handleTokenClick = (token: TokenWithBalance) => {
    updateFormData({ tokenId: token.id });
    if (onTokenSelect) {
      onTokenSelect(token);
    }
    onNext();
  };

  if (!hasWallet) {
    return (
      <div className="text-center py-8 space-y-4">
        <p className="text-zinc-600 dark:text-zinc-400">
          {privyAuthenticated
            ? "Connect a wallet to list your tokens"
            : "Sign in to list your tokens"}
        </p>
        <Button
          color="brand"
          onClick={handleConnect}
          disabled={!privyReady}
          className="!px-8 !py-3"
        >
          {privyReady
            ? privyAuthenticated
              ? "Connect Wallet"
              : "Sign In"
            : "Loading..."}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Chain switcher - show available chains */}
      {availableChains.length > 1 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            Chain:
          </span>
          <div className="flex gap-1">
            {availableChains.includes("ethereum") && (
              <button
                onClick={() => handleChainSelect("ethereum")}
                className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                  selectedChain === "ethereum"
                    ? "bg-brand-500 text-white"
                    : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                }`}
              >
                Ethereum
              </button>
            )}
            {availableChains.includes("base") && (
              <button
                onClick={() => handleChainSelect("base")}
                className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                  selectedChain === "base"
                    ? "bg-brand-500 text-white"
                    : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                }`}
              >
                Base
              </button>
            )}
            {availableChains.includes("bsc") && (
              <button
                onClick={() => handleChainSelect("bsc")}
                className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                  selectedChain === "bsc"
                    ? "bg-brand-500 text-white"
                    : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                }`}
              >
                BSC
              </button>
            )}
            {availableChains.includes("solana") && (
              <button
                onClick={() => handleChainSelect("solana")}
                className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                  selectedChain === "solana"
                    ? "bg-brand-500 text-white"
                    : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                }`}
              >
                Solana
              </button>
            )}
          </div>
        </div>
      )}

      {/* Search and info row */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
          <input
            type="text"
            placeholder="Search tokens..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-10 py-2.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-sm focus:ring-2 focus:ring-brand-500/20 focus:outline-none transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing || loading}
          className="flex items-center gap-1.5 px-3 py-2.5 text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-full transition-colors disabled:opacity-50"
          title="Refresh token list"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`}
          />
        </button>
      </div>

      {/* Show searched token from address lookup */}
      {searchIsAddress && !addressFoundInWallet && (
        <div>
          {isSearchingAddress ? (
            <div className="flex items-center justify-center gap-2 py-6 text-zinc-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Looking up token...</span>
            </div>
          ) : searchedToken ? (
            <div className="space-y-2">
              <p className="text-xs text-zinc-500 flex items-center gap-1">
                <ExternalLink className="w-3 h-3" />
                Token found by address (not in your wallet)
              </p>
              <div
                onClick={() => handleTokenClick(searchedToken)}
                onMouseEnter={() => handleTokenHover(searchedToken)}
                className="p-3 rounded-lg bg-brand-500/5 border border-brand-500/20 cursor-pointer transition-all hover:bg-brand-500/10"
              >
                <div className="flex items-center gap-3">
                  <TokenAvatar
                    logoUrl={searchedToken.logoUrl}
                    symbol={searchedToken.symbol}
                    size={40}
                    ringClass=""
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                        {searchedToken.symbol}
                      </span>
                      <span className="text-xs bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 px-2 py-0.5 rounded-full">
                        {searchedToken.chain}
                      </span>
                    </div>
                    <div className="text-sm text-zinc-500 truncate">
                      {searchedToken.name}
                    </div>
                  </div>
                  <svg
                    className="w-5 h-5 text-brand-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </div>
              </div>
            </div>
          ) : addressSearchError ? (
            <p className="text-sm text-brand-600 dark:text-brand-400 text-center py-6">
              {addressSearchError === "Token not found"
                ? `No token found at ${searchQuery.slice(0, 8)}...${searchQuery.slice(-4)}`
                : addressSearchError}
            </p>
          ) : null}
        </div>
      )}

      {filteredTokens.length === 0 && searchQuery && !searchIsAddress && (
        <p className="text-sm text-zinc-500 text-center py-6">
          No tokens found matching &quot;{searchQuery}&quot;
        </p>
      )}

      {filteredTokens.length === 0 &&
        searchQuery &&
        searchIsAddress &&
        addressFoundInWallet && (
          <p className="text-sm text-zinc-500 text-center py-6">
            Token found in your wallet
          </p>
        )}

      {/* Divider when showing both searched token and wallet tokens */}
      {searchedToken && !addressFoundInWallet && filteredTokens.length > 0 && (
        <div className="flex items-center gap-3 py-1">
          <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-700" />
          <span className="text-xs text-zinc-400">Your wallet tokens</span>
          <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-700" />
        </div>
      )}

      {/* Token list - no inner scroll, flows naturally */}
      <div className="space-y-2">
        {loading && <InlineLoading message="Loading tokens..." />}
        {!loading &&
          filteredTokens.length === 0 &&
          !searchQuery &&
          hasLoadedOnce && (
            <div className="text-center py-8 text-zinc-500 dark:text-zinc-400 text-sm">
              No tokens found in your wallet
            </div>
          )}
        {!loading &&
          filteredTokens.map((token) => (
            <div
              key={token.id}
              data-testid={`token-row-${token.id}`}
              onClick={() => handleTokenClick(token)}
              onMouseEnter={() => handleTokenHover(token)}
              className={`p-3 rounded-lg cursor-pointer transition-all ${
                formData.tokenId === token.id
                  ? "bg-brand-500/10 ring-1 ring-brand-500/30"
                  : "bg-zinc-50 dark:bg-zinc-800/50 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}
            >
              <div className="flex items-center gap-3">
                <TokenAvatar
                  logoUrl={token.logoUrl}
                  symbol={token.symbol}
                  size={40}
                  ringClass=""
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                      {token.symbol}
                    </span>
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {formatUsdCompact(token.balanceUsd)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-zinc-500 truncate pr-2">
                      {token.name}
                    </span>
                    <span className="text-xs text-zinc-400 whitespace-nowrap">
                      {formatRawTokenAmount(token.balance, token.decimals)}
                    </span>
                  </div>
                </div>
                <svg
                  className="w-5 h-5 text-zinc-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
