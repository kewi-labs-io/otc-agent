"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import Image from "next/image";
import { useMultiWallet } from "../multiwallet";
import { Button } from "../button";
import { InlineLoading } from "@/components/ui/loading-spinner";
import { useChainId } from "wagmi";
import {
  mainnet,
  sepolia,
  base,
  baseSepolia,
  bsc,
  bscTestnet,
} from "wagmi/chains";
import type { Chain } from "@/config/chains";
import { usePrivy } from "@privy-io/react-auth";
import { Search, X, RefreshCw, ExternalLink, Loader2 } from "lucide-react";
import {
  useWalletTokens,
  useRefetchWalletTokens,
  type WalletToken,
} from "@/hooks/useWalletTokens";

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

// Address detection helpers
function isSolanaAddress(address: string): boolean {
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  return base58Regex.test(address);
}

function isEvmAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/i.test(address);
}

function isContractAddress(query: string): boolean {
  return isSolanaAddress(query) || isEvmAddress(query);
}

// Re-export type from hook for compatibility
export type TokenWithBalance = WalletToken;

interface TokenSelectionProps {
  formData: { tokenId: string };
  updateFormData: (updates: { tokenId: string }) => void;
  onNext: () => void;
  onTokenSelect?: (token: TokenWithBalance) => void;
}

function formatBalance(balance: string, decimals: number): string {
  const num = Number(balance) / Math.pow(10, decimals);
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(2)}K`;
  return num.toFixed(2);
}

function formatUsd(usd: number): string {
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(2)}M`;
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(2)}K`;
  return `$${usd.toFixed(2)}`;
}

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

  // State for address lookup
  const [searchedToken, setSearchedToken] = useState<TokenWithBalance | null>(
    null,
  );
  const [isSearchingAddress, setIsSearchingAddress] = useState(false);
  const [addressSearchError, setAddressSearchError] = useState<string | null>(
    null,
  );
  const addressSearchRef = useRef<string | null>(null);

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

  const handleConnect = useCallback(() => {
    if (privyAuthenticated) {
      connectWallet();
    } else {
      login();
    }
  }, [privyAuthenticated, connectWallet, login]);

  // Look up token by contract address when not found in wallet
  useEffect(() => {
    const trimmed = searchQuery.trim();

    // Clear if not a valid address or found in wallet
    if (!searchIsAddress || addressFoundInWallet) {
      setSearchedToken(null);
      setAddressSearchError(null);
      addressSearchRef.current = null;
      return;
    }

    // Don't re-search same address
    if (addressSearchRef.current === trimmed) return;

    // Detect chain from address format - use selected chain for EVM addresses
    const lookupChain: Chain = isSolanaAddress(trimmed)
      ? "solana"
      : selectedChain === "solana"
        ? "base"
        : selectedChain;

    // Debounce the lookup
    const timeoutId = setTimeout(async () => {
      addressSearchRef.current = trimmed;
      setIsSearchingAddress(true);
      setAddressSearchError(null);

      const response = await fetch(
        `/api/token-lookup?address=${encodeURIComponent(trimmed)}&chain=${lookupChain}`,
      );
      // FAIL-FAST: Check response status
      if (!response.ok) {
        throw new Error(
          `Token lookup API failed: ${response.status} ${response.statusText}`,
        );
      }
      const data = await response.json();
      // FAIL-FAST: Validate response structure
      if (typeof data !== "object" || data === null) {
        throw new Error("Invalid token lookup response: expected object");
      }

      if (data.success && data.token) {
        const token = data.token;
        // FAIL-FAST: Validate chain is a valid Chain type
        const validChains: Chain[] = ["ethereum", "base", "bsc", "solana"];
        if (!validChains.includes(token.chain as Chain)) {
          throw new Error(`Invalid chain from API: ${token.chain}`);
        }
        // logoUrl is optional - use empty string if not provided
        const logoUrlValue = token.logoUrl ?? "";
        // priceUsd is optional - use 0 if not provided
        const priceUsdValue =
          typeof token.priceUsd === "number" ? token.priceUsd : 0;

        setSearchedToken({
          id: `token-${token.chain}-${token.address}`,
          symbol: token.symbol,
          name: token.name,
          contractAddress: token.address,
          chain: token.chain as Chain,
          decimals: token.decimals,
          logoUrl: logoUrlValue,
          description: "",
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          balance: "0", // User doesn't have this token
          balanceUsd: 0,
          priceUsd: priceUsdValue,
        });
        setAddressSearchError(null);
      } else {
        setSearchedToken(null);
        // Error message is optional in error response - provide fallback
        const errorMessage =
          typeof data.error === "string" && data.error.trim() !== ""
            ? data.error
            : "Token not found";
        setAddressSearchError(errorMessage);
      }
      setIsSearchingAddress(false);
    }, 500); // 500ms debounce

    return () => clearTimeout(timeoutId);
  }, [searchQuery, searchIsAddress, addressFoundInWallet, selectedChain]);

  // Refresh handler using React Query's refetch
  const handleRefresh = useCallback(async () => {
    if (!userAddress) return;
    setIsRefreshing(true);
    await refetchWalletTokens(userAddress, chain);
    await refetchTokens();
    setIsRefreshing(false);
  }, [userAddress, chain, refetchWalletTokens, refetchTokens]);

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
                      {formatUsd(token.balanceUsd)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-zinc-500 truncate pr-2">
                      {token.name}
                    </span>
                    <span className="text-xs text-zinc-400 whitespace-nowrap">
                      {formatBalance(token.balance, token.decimals)}
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
