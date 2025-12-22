"use client";

import type { Wallet } from "@coral-xyz/anchor";
import * as anchor from "@coral-xyz/anchor";
import { usePrivy } from "@privy-io/react-auth";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import {
  Keypair,
  PublicKey as SolPubkey,
  SystemProgram as SolSystemProgram,
} from "@solana/web3.js";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import type { Abi, Address } from "viem";
import { createPublicClient, erc20Abi, formatUnits, http } from "viem";
import { base, baseSepolia, bsc, bscTestnet, mainnet, sepolia } from "viem/chains";
import { useAccount, useBalance, useReadContracts } from "wagmi";
import { Button } from "@/components/button";
import { Dialog } from "@/components/dialog";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import type { ChainConfig } from "@/config/chains";
import { SUPPORTED_CHAINS } from "@/config/chains";
import { getCurrentNetwork, getSolanaConfig, getSolanaDesk } from "@/config/contracts";
import { useChain, useWalletActions, useWalletConnection } from "@/contexts";
import otcArtifact from "@/contracts/artifacts/contracts/OTC.sol/OTC.json";
import { useOTC } from "@/hooks/contracts/useOTC";
import { useNativePrices } from "@/hooks/useNativePrices";
import { useSolanaPaymentBalance } from "@/hooks/useSolanaBalance";
import { useTransactionErrorHandler } from "@/hooks/useTransactionErrorHandler";
import { safeReadContract } from "@/lib/viem-utils";
import type {
  Currency,
  ModalAction,
  ModalState,
  QuoteChain,
  TokenMetadata,
  TransactionError,
} from "@/types";
import { getExplorerTxUrl } from "@/utils/format";
// Shared Solana OTC utilities
import {
  createSolanaConnection,
  deriveTokenRegistryPda,
  fetchSolanaIdl,
  waitForSolanaTx,
} from "@/utils/solana-otc";
import type { OTCQuote } from "@/utils/xml-parser";

interface AcceptQuoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialQuote: OTCQuote;
  onComplete?: (data: { offerId: bigint; txHash?: `0x${string}` }) => void;
}

const ONE_MILLION = 1_000_000;

const tokenMetadataCache = new Map<string, TokenMetadata>();

function tokenCacheKey(chain: string, symbol: string): string {
  return `${chain}:${symbol.toUpperCase()}`;
}

function loadCachedTokenMetadata(chain: string, symbol: string): TokenMetadata | null {
  const key = tokenCacheKey(chain, symbol);
  const cached = tokenMetadataCache.get(key);
  if (cached) return cached;

  if (typeof window !== "undefined" && window.sessionStorage) {
    const stored = sessionStorage.getItem(`token-meta:${key}`);
    if (stored) {
      const metadata = JSON.parse(stored) as TokenMetadata;
      tokenMetadataCache.set(key, metadata);
      return metadata;
    }
  }
  return null;
}

function setCachedTokenMetadata(chain: string, symbol: string, metadata: TokenMetadata): void {
  const key = tokenCacheKey(chain, symbol);
  tokenMetadataCache.set(key, metadata);
  if (typeof window !== "undefined" && window.sessionStorage) {
    sessionStorage.setItem(`token-meta:${key}`, JSON.stringify(metadata));
  }
}

const CONTRACT_CACHE_TTL_MS = 5 * 60 * 1000;
const contractExistsCache = new Map<string, { exists: boolean; cachedAt: number }>();

function getContractExists(key: string): boolean | null {
  const entry = contractExistsCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt >= CONTRACT_CACHE_TTL_MS) {
    contractExistsCache.delete(key);
    return null;
  }
  return entry.exists;
}

function setContractExists(key: string, exists: boolean): void {
  contractExistsCache.set(key, { exists, cachedAt: Date.now() });
}

// Types imported from @/types/shared

function modalReducer(state: ModalState, action: ModalAction): ModalState {
  switch (action.type) {
    case "SET_TOKEN_AMOUNT":
      return { ...state, tokenAmount: action.payload };
    case "SET_CURRENCY":
      return { ...state, currency: action.payload };
    case "SET_STEP":
      return { ...state, step: action.payload };
    case "SET_PROCESSING":
      return { ...state, isProcessing: action.payload };
    case "SET_ERROR":
      return { ...state, error: action.payload };
    case "SET_REQUIRE_APPROVER":
      return { ...state, requireApprover: action.payload };
    case "SET_CONTRACT_VALID":
      return { ...state, contractValid: action.payload };
    case "SET_SOLANA_TOKEN_MINT":
      return { ...state, solanaTokenMint: action.payload };
    case "SET_SOLANA_DECIMALS":
      return { ...state, solanaTokenDecimals: action.payload };
    case "SET_TOKEN_METADATA":
      return { ...state, tokenMetadata: action.payload };
    case "SET_CONTRACT_CONSIGNMENT_ID":
      return { ...state, contractConsignmentId: action.payload };
    case "SET_CONSIGNMENT_REMAINING_TOKENS":
      return { ...state, consignmentRemainingTokens: action.payload };
    case "SET_COMPLETED":
      return {
        ...state,
        step: "complete",
        isProcessing: false,
        completedTxHash: action.payload.txHash,
        completedOfferId: action.payload.offerId,
      };
    case "RESET":
      return {
        ...state,
        step: "amount",
        isProcessing: false,
        error: null,
        tokenAmount: action.payload.tokenAmount,
        currency: action.payload.currency,
        solanaTokenMint: null,
        solanaTokenDecimals: null,
        tokenMetadata: null,
        completedTxHash: null,
        completedOfferId: null,
        contractConsignmentId: null,
        consignmentRemainingTokens: null,
      };
    case "START_TRANSACTION":
      return { ...state, error: null, isProcessing: true, step: "creating" };
    case "TRANSACTION_ERROR":
      return {
        ...state,
        error: action.payload,
        isProcessing: false,
        step: "amount",
      };
    default:
      return state;
  }
}

export function AcceptQuoteModal({
  isOpen,
  onClose,
  initialQuote,
  onComplete,
}: AcceptQuoteModalProps) {
  const { isConnected, address } = useAccount();
  const { activeFamily, setActiveFamily } = useChain();
  const {
    isConnected: walletConnected,
    solanaWallet,
    solanaPublicKey,
    privyAuthenticated,
  } = useWalletConnection();
  const { connectWallet } = useWalletActions();

  if (!initialQuote.tokenChain) {
    throw new Error("Quote missing tokenChain");
  }
  const quoteChain = initialQuote.tokenChain as Exclude<QuoteChain, null>;
  const requiredFamily = quoteChain === "solana" ? "solana" : "evm";
  const isChainMismatch = activeFamily !== null && activeFamily !== requiredFamily;

  // Auto-switch networks when mismatch detected
  useEffect(() => {
    if (isOpen && isChainMismatch && requiredFamily && walletConnected) {
      console.log(`[AcceptQuote] Auto-switching from ${activeFamily} to ${requiredFamily}`);
      setActiveFamily(requiredFamily);
    }
  }, [isOpen, isChainMismatch, requiredFamily, activeFamily, setActiveFamily, walletConnected]);
  const router = useRouter();
  const {
    otcAddress,
    createOfferFromConsignment,
    defaultUnlockDelaySeconds,
    usdcAddress,
    maxTokenPerOrder,
    getOtcAddressForChain,
  } = useOTC();

  const abi = useMemo(() => otcArtifact.abi as Abi, []);

  const networkEnv = getCurrentNetwork();
  const isMainnet = networkEnv === "mainnet";
  const isLocal = networkEnv === "local";

  // Determine chain type first (used throughout component)
  const isSolanaToken = quoteChain === "solana";
  const isEvmToken = quoteChain === "base" || quoteChain === "bsc" || quoteChain === "ethereum";

  // For EVM tokens, determine target chain and validate config
  const targetEvmChain: QuoteChain | null = isEvmToken ? quoteChain : null;

  // For EVM chains, chain config MUST exist (fail-fast)
  // TypeScript narrowing: if targetEvmChain exists, SUPPORTED_CHAINS[targetEvmChain] always returns ChainConfig
  // ChainConfig.rpcUrl and ChainConfig.contracts are required fields, so no need to check them
  const chainContracts: ChainConfig | null = targetEvmChain
    ? SUPPORTED_CHAINS[targetEvmChain]
    : null;

  // For EVM chains, OTC address must be available
  // chainContracts is guaranteed to exist when targetEvmChain exists (SUPPORTED_CHAINS is complete)
  const chainOtcAddressFromHook =
    targetEvmChain && chainContracts
      ? (getOtcAddressForChain(targetEvmChain) as `0x${string}` | undefined)
      : undefined;
  const chainOtcAddressFromConfig =
    targetEvmChain && chainContracts
      ? (chainContracts.contracts.otc as `0x${string}` | undefined)
      : undefined;
  const chainOtcAddress = chainOtcAddressFromHook ?? chainOtcAddressFromConfig;

  if (isEvmToken && !chainOtcAddress && !otcAddress) {
    throw new Error(`No OTC address for ${targetEvmChain}`);
  }
  // Use chain-specific address if available, otherwise fall back to default otcAddress
  const effectiveOtcAddress = chainOtcAddress ?? otcAddress;

  // TypeScript narrowing: if isEvmToken is true, targetEvmChain is not null
  const nativeSymbol = useMemo(() => {
    if (isSolanaToken) {
      return "SOL";
    }
    // For EVM chains, targetEvmChain is guaranteed to be non-null (set from quoteChain when isEvmToken is true)
    // TypeScript should narrow this, but we assert for clarity
    if (!targetEvmChain) {
      throw new Error(`targetEvmChain is null for EVM token - type system should prevent this`);
    }
    return targetEvmChain === "bsc" ? "BNB" : targetEvmChain === "ethereum" ? "ETH" : "ETH";
  }, [isSolanaToken, targetEvmChain]);

  const rpcUrl = useMemo(() => {
    // For Solana tokens, use Solana RPC directly
    if (isSolanaToken) {
      return SUPPORTED_CHAINS.solana.rpcUrl;
    }

    // For EVM chains, chainContracts MUST exist (SUPPORTED_CHAINS guarantees it)
    // TypeScript narrowing: if isEvmToken is true, chainContracts is not null
    if (!chainContracts) {
      throw new Error(
        `Chain contracts not available for EVM chain ${targetEvmChain} - SUPPORTED_CHAINS should have all chains`,
      );
    }
    // chainContracts.rpcUrl is required in ChainConfig type - no need to check

    if (isLocal) {
      // RPC URL is optional - default to localhost if not set
      return process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8545";
    }
    if (targetEvmChain === "bsc" && process.env.NEXT_PUBLIC_BSC_RPC_URL) {
      return process.env.NEXT_PUBLIC_BSC_RPC_URL;
    }
    if (targetEvmChain === "ethereum" && process.env.NEXT_PUBLIC_ETHEREUM_RPC_URL) {
      return process.env.NEXT_PUBLIC_ETHEREUM_RPC_URL;
    }
    if (targetEvmChain === "base" && process.env.NEXT_PUBLIC_BASE_RPC_URL) {
      return process.env.NEXT_PUBLIC_BASE_RPC_URL;
    }
    // chainContracts.rpcUrl is required in ChainConfig - always exists
    return chainContracts.rpcUrl;
  }, [isLocal, isSolanaToken, targetEvmChain, chainContracts]);

  const isLocalRpc = useMemo(() => /localhost|127\.0\.0\.1/.test(rpcUrl), [rpcUrl]);

  const readChain = useMemo(() => {
    // For Solana tokens, readChain is not used (Solana uses different client)
    // But we still need a valid chain for type compatibility - use base as default
    if (isSolanaToken) {
      return isMainnet ? base : baseSepolia;
    }

    // For EVM chains, targetEvmChain is guaranteed to be non-null (set from quoteChain when isEvmToken is true)
    if (!targetEvmChain) {
      throw new Error(`targetEvmChain is null for EVM token - type system should prevent this`);
    }

    if (isLocalRpc) {
      return {
        id: 31337,
        name: "Localhost",
        network: "localhost",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [rpcUrl] } },
      };
    }
    if (targetEvmChain === "bsc") {
      return isMainnet ? bsc : bscTestnet;
    }
    if (targetEvmChain === "ethereum") {
      return isMainnet ? mainnet : sepolia;
    }
    return isMainnet ? base : baseSepolia;
  }, [isLocalRpc, rpcUrl, isMainnet, targetEvmChain, isSolanaToken]);

  // getExplorerUrl uses centralized getExplorerTxUrl from @/utils/format
  const getExplorerUrl = useCallback(
    (txHash: string) => {
      if (isSolanaToken) {
        return getExplorerTxUrl(txHash, "solana");
      }
      if (!targetEvmChain) {
        throw new Error(`targetEvmChain is null for EVM token - type system should prevent this`);
      }
      // Testnet chain IDs: BSC testnet = 97, Sepolia = 11155111, Base Sepolia = 84532
      const isTestnet = readChain.id === 97 || readChain.id === 11155111 || readChain.id === 84532;
      return getExplorerTxUrl(txHash, targetEvmChain, isTestnet);
    },
    [readChain.id, targetEvmChain, isSolanaToken],
  );

  const publicClient = useMemo(
    () => createPublicClient({ chain: readChain, transport: http(rpcUrl) }),
    [readChain, rpcUrl],
  );

  // isSolanaToken and isEvmToken are already defined above

  // --- Consolidated State ---
  // Max available from quote - FAIL-FAST if not provided
  const maxAvailableTokens = useMemo(() => {
    // Prefer the formatted (human-readable) amount
    if (initialQuote.tokenAmountFormatted) {
      const formatted = Number(initialQuote.tokenAmountFormatted.replace(/,/g, ""));
      if (formatted > 0) {
        return Math.floor(formatted);
      }
    }
    // Parse tokenAmount - must be valid
    const available = Number(initialQuote.tokenAmount);
    if (Number.isNaN(available) || available <= 0) {
      throw new Error(`Invalid tokenAmount in quote: ${initialQuote.tokenAmount}`);
    }
    // If it's a reasonable human amount (< 100 billion), use it directly
    if (available < 100_000_000_000) {
      return Math.floor(available);
    }
    // Large amounts are likely in wei/lamports - use fallback
    return ONE_MILLION;
  }, [initialQuote.tokenAmount, initialQuote.tokenAmountFormatted]);

  const quotedTokenAmount = initialQuote.tokenAmountFormatted
    ? Number(initialQuote.tokenAmountFormatted.replace(/,/g, ""))
    : (() => {
        const amount = Number(initialQuote.tokenAmount);
        if (Number.isNaN(amount) || amount <= 0) {
          return null;
        }
        return amount < 100_000_000_000 ? amount : null;
      })();

  // Determine if this is a fixed-price (non-fractional) deal
  // Fixed price means user MUST buy the exact quoted amount - no slider
  const isFixedPriceDeal = useMemo(() => {
    // If explicitly marked as fractionalized, it's NOT fixed price
    if (initialQuote.isFractionalized === true) return false;
    // Explicit fixed price flag from quote
    if (initialQuote.isFixedPrice === true) return true;
    // Default to fractional (not fixed) for better UX
    return false;
  }, [initialQuote.isFixedPrice, initialQuote.isFractionalized]);

  const initialTokenAmount =
    isFixedPriceDeal && quotedTokenAmount !== null
      ? quotedTokenAmount
      : Math.min(
          maxAvailableTokens,
          quotedTokenAmount !== null
            ? Math.min(quotedTokenAmount, 1000)
            : Math.min(maxAvailableTokens, 1000),
        );

  const initialState: ModalState = {
    tokenAmount: initialTokenAmount,
    currency: isSolanaToken ? "SOL" : isEvmToken && quoteChain === "bsc" ? "BNB" : "ETH",
    step: "amount",
    isProcessing: false,
    error: null,
    requireApprover: false,
    contractValid: false,
    solanaTokenMint: null,
    solanaTokenDecimals: null,
    tokenMetadata: null,
    completedTxHash: null,
    completedOfferId: null,
    contractConsignmentId: null,
    consignmentRemainingTokens: null,
  };

  const [state, dispatch] = useReducer(modalReducer, initialState);
  const [evmUsdcAddress, setEvmUsdcAddress] = useState<`0x${string}` | undefined>(undefined);

  // Use React Query for native prices - auto-caching and deduplication
  const { prices: nativePrices } = useNativePrices();
  const [fallbackTokenPrice, setFallbackTokenPrice] = useState<number>(0);
  const {
    tokenAmount,
    currency,
    step,
    isProcessing,
    error,
    requireApprover,
    contractValid,
    solanaTokenMint,
    solanaTokenDecimals,
    tokenMetadata,
    completedTxHash,
    contractConsignmentId,
    consignmentRemainingTokens,
  } = state;

  const { handleTransactionError } = useTransactionErrorHandler();
  const { login, ready: privyReady } = usePrivy();

  // Fetch Solana payment balance when on Solana chain
  // Maps currency to the format expected by useSolanaPaymentBalance
  const solanaCurrency = currency === "SOL" ? "SOL" : "USDC";
  const { data: solanaBalance } = useSolanaPaymentBalance(
    isSolanaToken ? solanaPublicKey : null,
    solanaCurrency,
  );

  // Fetch token price from API if quote doesn't have pricePerToken
  useEffect(() => {
    if (!isOpen) return;
    if (initialQuote.pricePerToken && initialQuote.pricePerToken > 0) {
      // Quote already has price, no fallback needed
      setFallbackTokenPrice(0);
      return;
    }

    // Need to fetch price - use quote address (always available) or metadata if loaded
    // Try multiple sources for token address (quote > metadata > solana mint)
    const tokenAddressFromQuote = initialQuote.tokenAddress?.trim() || undefined;
    const tokenAddressFromMetadata = tokenMetadata?.contractAddress?.trim() || undefined;
    const tokenAddressFromSolana = solanaTokenMint?.trim() || undefined;
    const tokenAddress =
      tokenAddressFromQuote ?? tokenAddressFromMetadata ?? tokenAddressFromSolana;
    // tokenAddress may be missing for some quotes - that's OK, we just can't fetch price
    if (!tokenAddress) {
      console.warn("[AcceptQuote] Cannot fetch price: no token address available");
      return;
    }

    let cancelled = false;
    (async () => {
      // Try the price update API which checks pools and market data
      const res = await fetch("/api/solana/update-price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokenMint: tokenAddress }),
      });

      if (!res.ok) {
        throw new Error(`Price fetch failed: HTTP ${res.status}`);
      }

      const data = await res.json();

      // Get price from response (could be from pool, database, or on-chain)
      // Try multiple possible field names (different APIs use different names)
      const price =
        typeof data.newPrice === "number"
          ? data.newPrice
          : typeof data.price === "number"
            ? data.price
            : typeof data.priceUsd === "number"
              ? data.priceUsd
              : undefined;
      if (typeof price !== "number" || price <= 0) {
        throw new Error(`Invalid price: ${price}`);
      }

      if (!cancelled) {
        console.log(`[AcceptQuote] Fallback price fetched: $${price}`);
        setFallbackTokenPrice(price);
      }
    })().catch((err) => {
      console.error("[AcceptQuote] Failed to fetch fallback price:", err);
    });

    return () => {
      cancelled = true;
    };
  }, [
    isOpen,
    initialQuote.pricePerToken,
    initialQuote.tokenAddress,
    tokenMetadata?.contractAddress,
    solanaTokenMint,
  ]);

  // Keep isSolanaActive for execution logic only (user's actual connected wallet)
  const isSolanaActive = activeFamily === "solana";
  // Use centralized Solana config (from JSON deployment files)
  const SOLANA_DESK = getSolanaDesk();
  const SOLANA_USDC_MINT = getSolanaConfig().usdcMint;

  // Polling-based transaction confirmation - alias for shared utility
  const confirmTransactionPolling = waitForSolanaTx;

  // Wallet balances for display and MAX calculation
  const ethBalanceQuery = useBalance({ address });
  // Format native balance (wagmi v3 no longer has `formatted`)
  const ethBalance = useMemo(() => {
    if (!ethBalanceQuery.data) return null;
    return {
      ...ethBalanceQuery.data,
      formatted: formatUnits(ethBalanceQuery.data.value, ethBalanceQuery.data.decimals),
    };
  }, [ethBalanceQuery.data]);

  // Use evmUsdcAddress if available, otherwise fall back to usdcAddress
  const effectiveUsdcAddress = (evmUsdcAddress ?? usdcAddress) as `0x${string}` | undefined;

  // ERC20 USDC balance (wagmi v3 uses useReadContracts for token balances)
  const usdcBalanceQuery = useReadContracts({
    contracts:
      effectiveUsdcAddress && address
        ? [
            {
              address: effectiveUsdcAddress,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [address],
            },
            {
              address: effectiveUsdcAddress,
              abi: erc20Abi,
              functionName: "decimals",
            },
          ]
        : [],
  });

  const usdcBalance = useMemo(() => {
    const results = usdcBalanceQuery.data;
    if (!results || results.length < 2) return { data: null };
    const balanceResult = results[0];
    const decimalsResult = results[1];
    if (!balanceResult || !decimalsResult) return { data: null };
    if (balanceResult.status !== "success" || decimalsResult.status !== "success") {
      return { data: null };
    }
    const value = balanceResult.result as bigint;
    const decimals = decimalsResult.result as number;
    return {
      data: {
        value,
        decimals,
        symbol: "USDC",
        formatted: formatUnits(value, decimals),
      },
    };
  }, [usdcBalanceQuery.data]);

  useEffect(() => {
    if (!isOpen) {
      dispatch({
        type: "RESET",
        payload: {
          tokenAmount: initialTokenAmount,
          currency: isSolanaToken ? "SOL" : quoteChain === "bsc" ? "BNB" : "ETH",
        },
      });
    }
  }, [isOpen, initialTokenAmount, isSolanaToken, quoteChain]);

  // Look up token metadata - FAIL-FAST if quote missing required fields
  useEffect(() => {
    if (!isOpen) return;

    if (!initialQuote.tokenSymbol) throw new Error("Quote missing tokenSymbol");
    if (!initialQuote.tokenChain) throw new Error("Quote missing tokenChain");

    const chain = initialQuote.tokenChain;
    const symbol = initialQuote.tokenSymbol;

    // If quote has token address directly, use it for metadata but still need decimals
    if (initialQuote.tokenAddress) {
      console.log("[AcceptQuote] Using token address from quote:", initialQuote.tokenAddress);
      const metadata: TokenMetadata = {
        symbol: symbol,
        name: symbol, // Name not critical for transaction
        logoUrl: "",
        contractAddress: initialQuote.tokenAddress,
      };
      dispatch({ type: "SET_TOKEN_METADATA", payload: metadata });
      if (chain === "solana") {
        dispatch({
          type: "SET_SOLANA_TOKEN_MINT",
          payload: initialQuote.tokenAddress,
        });
      }
      // Still need to fetch decimals from DB - don't return early
      // Fall through to DB lookup for decimals
    } else {
      console.warn("[AcceptQuote] Quote missing tokenAddress - will fetch from DB");
    }

    const cached = loadCachedTokenMetadata(chain, symbol);
    if (cached && !initialQuote.tokenAddress) {
      // Only use cache if we don't have address from quote (need to fetch decimals regardless)
      console.log("[AcceptQuote] Using cached token metadata for", symbol);
      dispatch({ type: "SET_TOKEN_METADATA", payload: cached });
      if (chain === "solana") {
        dispatch({
          type: "SET_SOLANA_TOKEN_MINT",
          payload: cached.contractAddress,
        });
      }
      // Still need to fetch decimals - don't return early
    }

    // Fetch token by address (tokenId), NOT by symbol - symbol lookup is unreliable
    (async () => {
      // Prefer fetching by tokenId (address-based) - most reliable
      const tokenAddress = initialQuote.tokenAddress;
      if (tokenAddress) {
        const tokenId = `token-${chain}-${tokenAddress}`;
        console.log(`[AcceptQuote] Fetching token by ID: ${tokenId}`);
        const res = await fetch(`/api/tokens/${encodeURIComponent(tokenId)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.token) {
            const token = data.token;
            // logoUrl is optional - use empty string as default if not provided
            const logoUrl = token.logoUrl ?? "";
            const metadata: TokenMetadata = {
              symbol: token.symbol,
              name: token.name,
              logoUrl,
              contractAddress: token.contractAddress,
            };
            setCachedTokenMetadata(chain, symbol, metadata);
            if (!initialQuote.tokenAddress) {
              dispatch({ type: "SET_TOKEN_METADATA", payload: metadata });
            }
            if (typeof token.decimals === "number") {
              console.log(`[AcceptQuote] Setting token decimals: ${token.decimals}`);
              dispatch({
                type: "SET_SOLANA_DECIMALS",
                payload: token.decimals,
              });
            }
            if (chain === "solana") {
              dispatch({
                type: "SET_SOLANA_TOKEN_MINT",
                payload: token.contractAddress,
              });
            }
            return;
          }
        }
      }

      // Fallback: fetch decimals directly from chain if DB lookup failed
      if (tokenAddress) {
        console.log(`[AcceptQuote] Token not in DB, fetching decimals from chain...`);
        const res = await fetch(
          `/api/tokens/decimals?address=${encodeURIComponent(tokenAddress)}&chain=${chain}`,
        );
        if (res.ok) {
          const data = await res.json();
          if (data.success && typeof data.decimals === "number") {
            console.log(`[AcceptQuote] Got decimals from chain: ${data.decimals}`);
            dispatch({ type: "SET_SOLANA_DECIMALS", payload: data.decimals });
          }
        }
      }
    })().catch((err) => {
      console.error("[AcceptQuote] Failed to fetch token metadata:", err);
    });
  }, [isOpen, initialQuote.tokenSymbol, initialQuote.tokenChain, initialQuote.tokenAddress]);

  // Fetch consignment data for Solana tokens (to get actual remaining balance AND on-chain address)
  useEffect(() => {
    if (!isOpen || !isSolanaToken) return;

    if (!initialQuote.consignmentId) {
      dispatch({ type: "SET_ERROR", payload: "Quote missing consignmentId" });
      return;
    }

    const consignmentDbId = initialQuote.consignmentId;
    const tokenAddress = initialQuote.tokenAddress;
    const tokenSymbol = initialQuote.tokenSymbol;
    const tokenChain = initialQuote.tokenChain;

    console.log(`[AcceptQuote] Solana consignment fetch starting...`);
    console.log(`[AcceptQuote] Quote data:`, {
      consignmentDbId,
      tokenAddress,
      tokenSymbol,
      tokenChain,
    });

    (async () => {
      // Fetch consignment by DB ID (validated above that it exists)
      console.log(`[AcceptQuote] Fetching consignment by DB ID: ${consignmentDbId}`);
      const res = await fetch(`/api/consignments/${consignmentDbId}`);

      if (!res.ok) {
        throw new Error(`Failed to fetch consignment ${consignmentDbId}: ${res.status}`);
      }

      const data = await res.json();
      if (!data.success || !data.consignment) {
        throw new Error(`Consignment ${consignmentDbId} not found in database`);
      }

      console.log(`[AcceptQuote] Consignment found:`, {
        id: data.consignment.id,
        tokenId: data.consignment.tokenId,
        contractConsignmentId: data.consignment.contractConsignmentId,
        status: data.consignment.status,
        chain: data.consignment.chain,
      });

      if (!data.consignment.contractConsignmentId) {
        throw new Error(`Consignment ${consignmentDbId} missing contractConsignmentId`);
      }

      console.log(
        `[AcceptQuote] Setting contractConsignmentId: ${data.consignment.contractConsignmentId}`,
      );
      dispatch({
        type: "SET_CONTRACT_CONSIGNMENT_ID",
        payload: data.consignment.contractConsignmentId,
      });

      // Get token address from consignment's tokenId
      // Format is: token-{chain}-{contractAddress}
      const tokenId = data.consignment.tokenId as string;
      if (tokenId) {
        // Extract contract address from tokenId format: token-solana-{address}
        const parts = tokenId.split("-");
        if (parts.length >= 3 && parts[1] === "solana") {
          const contractAddress = parts.slice(2).join("-"); // Handle addresses with dashes
          console.log(`[AcceptQuote] Token mint from tokenId: ${contractAddress}`);
          dispatch({
            type: "SET_SOLANA_TOKEN_MINT",
            payload: contractAddress,
          });
        }

        // Also try to get decimals from token DB
        const tokenRes = await fetch(`/api/tokens/${tokenId}`);
        if (tokenRes.ok) {
          const tokenData = await tokenRes.json();
          if (tokenData.success && tokenData.token?.decimals) {
            dispatch({
              type: "SET_SOLANA_DECIMALS",
              payload: tokenData.token.decimals,
            });
          }
        }
      }

      if (data.consignment.remainingAmount) {
        // Get decimals from state or consignment data
        // This handles race conditions where token fetch may not have completed yet
        const decimals =
          typeof solanaTokenDecimals === "number"
            ? solanaTokenDecimals
            : typeof data.consignment.tokenDecimals === "number"
              ? data.consignment.tokenDecimals
              : null;

        if (decimals === null) {
          // Log warning but don't throw - decimals may be set later by token fetch
          console.warn(`[AcceptQuote] Token decimals not yet available - will retry when set`);
          return;
        }

        const remaining = Number(BigInt(data.consignment.remainingAmount) / BigInt(10 ** decimals));
        console.log(`[AcceptQuote] Solana consignment remaining: ${remaining} tokens`);
        dispatch({
          type: "SET_CONSIGNMENT_REMAINING_TOKENS",
          payload: remaining,
        });
      }
    })().catch((err) => {
      console.error("[AcceptQuote] Failed to fetch Solana consignment:", err);
      const errorMsg = err instanceof Error ? err.message : "Failed to load consignment";
      dispatch({ type: "SET_ERROR", payload: errorMsg });
    });
  }, [isOpen, isSolanaToken, initialQuote, solanaTokenDecimals]);

  // Fetch consignment data to get on-chain ID (EVM only)
  useEffect(() => {
    if (!isOpen || isSolanaToken) return;

    if (!initialQuote.consignmentId) {
      dispatch({ type: "SET_ERROR", payload: "Quote missing consignmentId" });
      return;
    }

    const consignmentDbId = initialQuote.consignmentId;

    (async () => {
      console.log(`[AcceptQuote] EVM fetching consignment: ${consignmentDbId}`);
      const res = await fetch(`/api/consignments/${consignmentDbId}`);

      if (!res.ok) {
        throw new Error(`Failed to fetch consignment ${consignmentDbId}: ${res.status}`);
      }

      const data = await res.json();
      if (!data.success || !data.consignment) {
        throw new Error(`Consignment ${consignmentDbId} not found in database`);
      }

      if (!data.consignment.contractConsignmentId) {
        throw new Error(`Consignment ${consignmentDbId} missing contractConsignmentId`);
      }

      dispatch({
        type: "SET_CONTRACT_CONSIGNMENT_ID",
        payload: data.consignment.contractConsignmentId,
      });

      if (data.consignment.remainingAmount) {
        if (typeof data.consignment.tokenDecimals !== "number") {
          throw new Error(`Consignment missing tokenDecimals - cannot display remaining amount`);
        }
        const decimals = data.consignment.tokenDecimals;
        dispatch({
          type: "SET_CONSIGNMENT_REMAINING_TOKENS",
          payload: Number(BigInt(data.consignment.remainingAmount) / BigInt(10 ** decimals)),
        });
      }
    })().catch((err) => {
      console.error("[AcceptQuote] Failed to fetch EVM consignment:", err);
      const errorMsg = err instanceof Error ? err.message : "Failed to load consignment";
      dispatch({ type: "SET_ERROR", payload: errorMsg });
    });
  }, [isOpen, isSolanaToken, initialQuote]);

  // Keep currency coherent with token's chain when modal opens
  useEffect(() => {
    if (!isOpen) return;
    // Set currency based on token's chain, not user's wallet
    if (isSolanaToken && currency !== "SOL" && currency !== "USDC") {
      dispatch({ type: "SET_CURRENCY", payload: "SOL" });
    } else if (isEvmToken && currency === "SOL") {
      dispatch({
        type: "SET_CURRENCY",
        payload: quoteChain === "bsc" ? "BNB" : "ETH",
      });
    }
  }, [isOpen, isSolanaToken, isEvmToken, currency, quoteChain]);

  // Validate contract exists and read config - with caching
  // Use isSolanaToken (from quote data) not activeFamily (from wallet) to determine path
  // biome-ignore lint/correctness/useExhaustiveDependencies: readContract is defined after this hook but uses effectiveOtcAddress/publicClient/abi from closure
  useEffect(() => {
    (async () => {
      // For Solana tokens, validate Solana desk account
      if (isSolanaToken) {
        if (!SOLANA_DESK) {
          dispatch({ type: "SET_CONTRACT_VALID", payload: false });
          dispatch({
            type: "SET_ERROR",
            payload: "SOLANA_DESK not configured. Please deploy desk program.",
          });
          setEvmUsdcAddress(undefined);
          return;
        }
        const connection = createSolanaConnection();
        const info = await connection.getAccountInfo(new SolPubkey(SOLANA_DESK));
        const valid = Boolean(info);
        dispatch({ type: "SET_CONTRACT_VALID", payload: valid });
        dispatch({ type: "SET_REQUIRE_APPROVER", payload: false });
        setEvmUsdcAddress(undefined);
        if (!valid) {
          dispatch({
            type: "SET_ERROR",
            payload: "Solana desk account not found on this RPC.",
          });
        }
        return;
      }

      // EVM token validation
      if (!isOpen || !effectiveOtcAddress) {
        dispatch({ type: "SET_CONTRACT_VALID", payload: false });
        setEvmUsdcAddress(undefined);
        return;
      }

      const cacheKey = `${effectiveOtcAddress}:${readChain.id}`;

      const cachedExists = getContractExists(cacheKey);
      if (cachedExists !== null && typeof cachedExists === "boolean") {
        dispatch({ type: "SET_CONTRACT_VALID", payload: cachedExists });
        if (!cachedExists) {
          dispatch({
            type: "SET_ERROR",
            payload: "Contract not found. Ensure Anvil node is running and contracts are deployed.",
          });
        }
        return;
      }

      const code = await publicClient.getBytecode({
        address: effectiveOtcAddress as `0x${string}`,
      });

      const exists = Boolean(code && code !== "0x");
      setContractExists(cacheKey, exists);

      if (!exists) {
        console.error(`[AcceptQuote] No contract at ${effectiveOtcAddress} on ${readChain.name}.`);
        dispatch({ type: "SET_CONTRACT_VALID", payload: false });
        dispatch({
          type: "SET_ERROR",
          payload: "Contract not found. Ensure Anvil node is running and contracts are deployed.",
        });
        return;
      }

      dispatch({ type: "SET_CONTRACT_VALID", payload: true });
      const usdcAddr = (await readContract("usdc")) as `0x${string}`;
      setEvmUsdcAddress(usdcAddr);

      // Read contract state (this changes rarely, but should still be fresh)
      const flag = await safeReadContract<boolean>(publicClient, {
        address: effectiveOtcAddress as Address,
        abi: abi as Abi,
        functionName: "requireApproverToFulfill",
        args: [],
      });
      dispatch({ type: "SET_REQUIRE_APPROVER", payload: flag });
    })().catch((err) => {
      console.error("[AcceptQuote] Failed to validate contract:", err);
      dispatch({
        type: "SET_ERROR",
        payload: `Contract validation failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    });
  }, [isOpen, effectiveOtcAddress, publicClient, abi, isSolanaToken, readChain, SOLANA_DESK]);

  const discountBps = useMemo(() => {
    const bps = initialQuote.discountBps;
    if (typeof bps !== "number" || Number.isNaN(bps)) {
      throw new Error(`Invalid discountBps in quote: ${bps}`);
    }
    return bps;
  }, [initialQuote.discountBps]);

  const nativeUsdPrice = useMemo(() => {
    // For USDC, no native price needed
    if (currency === "USDC") return 0;
    if (currency === "ETH") {
      if (initialQuote.ethPrice) return initialQuote.ethPrice;
      if (initialQuote.nativePrice) return initialQuote.nativePrice;
      if (nativePrices.ETH) return nativePrices.ETH;
      // Return 0 if price not available yet - will show loading state
      return 0;
    }
    if (currency === "BNB") {
      if (initialQuote.bnbPrice) return initialQuote.bnbPrice;
      if (initialQuote.nativePrice) return initialQuote.nativePrice;
      if (nativePrices.BNB) return nativePrices.BNB;
      return 0;
    }
    if (currency === "SOL") {
      if (nativePrices.SOL) return nativePrices.SOL;
      if (initialQuote.nativePrice) return initialQuote.nativePrice;
      return 0;
    }
    // Unknown currency - return 0
    console.warn(`[AcceptQuoteModal] Unknown currency: ${currency}`);
    return 0;
  }, [
    currency,
    initialQuote.nativePrice,
    initialQuote.bnbPrice,
    initialQuote.ethPrice,
    nativePrices.ETH,
    nativePrices.BNB,
    nativePrices.SOL,
  ]);

  // Check if we're waiting for native price (for non-USDC currencies)
  const isWaitingForNativePrice = currency !== "USDC" && nativeUsdPrice === 0;

  const lockupDays = useMemo(() => {
    if (typeof initialQuote.lockupDays === "number") return initialQuote.lockupDays;
    if (typeof initialQuote.lockupMonths === "number")
      return Math.max(1, initialQuote.lockupMonths * 30);
    // Fallback to contract default if quote doesn't specify
    return Number(defaultUnlockDelaySeconds ? defaultUnlockDelaySeconds / 86400n : 180n);
  }, [initialQuote.lockupDays, initialQuote.lockupMonths, defaultUnlockDelaySeconds]);

  const contractMaxTokens = useMemo(() => {
    // For Solana, we don't have an on-chain maxTokenPerOrder - use fallback
    if (isSolanaToken) {
      return ONE_MILLION;
    }
    // For EVM, use the contract's maxTokenPerOrder with actual token decimals
    // If decimals not loaded yet, use default (will be updated when decimals load)
    if (typeof solanaTokenDecimals !== "number") {
      // Return default while decimals are loading - this is not an error state
      return ONE_MILLION;
    }
    const decimals = solanaTokenDecimals;
    const v = maxTokenPerOrder ? Number(maxTokenPerOrder / BigInt(10 ** decimals)) : ONE_MILLION;
    return Math.max(1, Math.min(ONE_MILLION, v));
  }, [maxTokenPerOrder, isSolanaToken, solanaTokenDecimals]);

  const effectiveMaxTokens = useMemo(() => {
    if (typeof consignmentRemainingTokens === "number" && consignmentRemainingTokens > 0) {
      return Math.min(contractMaxTokens, consignmentRemainingTokens);
    }
    return Math.min(contractMaxTokens, maxAvailableTokens);
  }, [contractMaxTokens, maxAvailableTokens, consignmentRemainingTokens]);

  const clampAmount = useCallback(
    (value: number) => {
      const raw = Math.floor(value);
      return Math.min(effectiveMaxTokens, Math.max(1, raw));
    },
    [effectiveMaxTokens],
  );

  const setTokenAmount = useCallback(
    (value: number) => {
      dispatch({
        type: "SET_TOKEN_AMOUNT",
        payload: clampAmount(value),
      });
    },
    [clampAmount],
  );

  const setCurrency = useCallback((value: Currency) => {
    dispatch({ type: "SET_CURRENCY", payload: value });
  }, []);

  type OfferTuple = readonly [
    `0x${string}`,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    number,
    boolean,
    boolean,
    boolean,
    boolean,
    `0x${string}`,
    bigint,
  ];

  async function readContract<T>(fn: string, args: readonly bigint[] = []): Promise<T> {
    if (!effectiveOtcAddress) throw new Error("Missing OTC address");
    return safeReadContract<T>(publicClient, {
      address: effectiveOtcAddress as Address,
      abi: abi as Abi,
      functionName: fn,
      args,
    });
  }

  const readNextOfferId = () => readContract<bigint>("nextOfferId");
  const readOffer = (id: bigint) => readContract<OfferTuple>("offers", [id]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: executeTransaction is stable within same render, readContract is internal helper
  const handleConfirm = useCallback(async () => {
    // Check if user needs to connect a wallet first
    if (!walletConnected) {
      console.log("[AcceptQuote] No wallet connected, prompting login...");
      // Close modal first so Privy login modal is visible
      onClose();
      // Small delay to ensure modal closes before login opens
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (privyAuthenticated) {
        connectWallet();
      } else {
        login();
      }
      return;
    }

    // Check if the correct wallet type is connected for this token's chain
    if (isSolanaToken && activeFamily !== "solana") {
      console.log("[AcceptQuote] Solana token but no Solana wallet, switching...");
      dispatch({
        type: "SET_ERROR",
        payload: "This token requires a Solana wallet. Please connect a Solana wallet.",
      });
      setActiveFamily("solana");
      // Close modal so Privy wallet selector is visible
      onClose();
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (privyAuthenticated) {
        connectWallet();
      } else {
        login();
      }
      return;
    }

    if (isEvmToken && activeFamily === "solana") {
      console.log("[AcceptQuote] EVM token but Solana wallet active, switching...");
      dispatch({
        type: "SET_ERROR",
        payload: "This token requires an EVM wallet. Please connect an EVM wallet.",
      });
      setActiveFamily("evm");
      // Close modal so Privy wallet selector is visible
      onClose();
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (privyAuthenticated) {
        connectWallet();
      } else {
        login();
      }
      return;
    }

    // For Solana tokens, verify we actually have a Solana wallet with publicKey
    if (isSolanaToken && (!solanaWallet || !solanaPublicKey)) {
      console.log("[AcceptQuote] Solana wallet not ready, prompting connection...");
      dispatch({
        type: "SET_ERROR",
        payload: "Please connect your Solana wallet to continue.",
      });
      // Close modal so Privy wallet selector is visible
      onClose();
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (privyAuthenticated) {
        connectWallet();
      } else {
        login();
      }
      return;
    }

    // For EVM tokens, verify we have an address
    if (isEvmToken && !address) {
      console.log("[AcceptQuote] EVM wallet not ready, prompting connection...");
      dispatch({
        type: "SET_ERROR",
        payload: "Please connect your EVM wallet to continue.",
      });
      // Close modal so Privy wallet selector is visible
      onClose();
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (privyAuthenticated) {
        connectWallet();
      } else {
        login();
      }
      return;
    }

    // Quote ID already validated at component mount

    // Block if contract isn't valid (EVM tokens only)
    if (!isSolanaToken && !contractValid) {
      dispatch({
        type: "SET_ERROR",
        payload:
          "Contract not available. Please ensure Anvil node is running and contracts are deployed.",
      });
      return;
    }

    dispatch({ type: "START_TRANSACTION" });

    console.log("[AcceptQuote] Starting executeTransaction...");
    await executeTransaction().catch((err) => {
      console.error("[AcceptQuote] executeTransaction error:", err);
      const error = err instanceof Error ? err : new Error(String(err));
      // Use TransactionError type which already has cause, details, and shortMessage
      const txError: TransactionError = {
        ...error,
        message: error.message,
        cause: error.cause as { reason?: string; code?: string | number } | undefined,
        details: (error as TransactionError).details,
        shortMessage: (error as TransactionError).shortMessage,
      };
      const errorMessage = handleTransactionError(txError);
      dispatch({ type: "TRANSACTION_ERROR", payload: errorMessage });
      throw err; // Re-throw to fail fast
    });
    console.log("[AcceptQuote] executeTransaction completed successfully");
  }, [
    walletConnected,
    privyAuthenticated,
    activeFamily,
    isSolanaToken,
    isEvmToken,
    solanaWallet,
    solanaPublicKey,
    address,
    contractValid,
    handleTransactionError,
    connectWallet,
    login,
    setActiveFamily,
    onClose,
  ]);

  const executeTransaction = async () => {
    /**
     * TRANSACTION FLOW (Optimized UX - Backend Pays)
     *
     * requireApproverToFulfill = true (set in contract)
     *
     * Flow:
     * 1. User creates offer (1 wallet signature - ONLY user interaction)
     * 2. Backend approves offer (using agent wallet)
     * 3. Backend pays for offer (using agent's ETH/USDC)
     * 4. Deal saved to database with offerId
     * 5. User redirected to deal page
     *
     * Benefits:
     * - User signs ONCE only (great UX)
     * - No risk of user abandoning after approval
     * - Backend controls payment execution
     * - Consistent pricing (no user slippage)
     */

    // SAFETY: Block execution if chain mismatch
    if (isChainMismatch) {
      const requiredChain = quoteChain === "solana" ? "Solana" : "EVM";
      const currentChain = activeFamily === "solana" ? "Solana" : "EVM";
      throw new Error(
        `Chain mismatch: This quote requires ${requiredChain} but you're connected to ${currentChain}. Please switch networks.`,
      );
    }

    // Solana path
    if (isSolanaActive) {
      // Basic config checks
      if (!SOLANA_DESK || !SOLANA_USDC_MINT) {
        throw new Error(
          "Solana OTC configuration is incomplete. Please check your environment variables.",
        );
      }
      // Get token mint from state (should be loaded from consignment fetch above)
      // Sources: consignment's token contractAddress → quote's tokenAddress
      const tokenMintAddress = solanaTokenMint || initialQuote.tokenAddress;

      if (!tokenMintAddress) {
        throw new Error(
          `Token mint address not available. The consignment's token must be registered.`,
        );
      }
      console.log("[AcceptQuote] Using token mint:", tokenMintAddress);

      if (!solanaWallet) {
        throw new Error("Solana wallet not connected");
      }
      if (!solanaWallet.publicKey) {
        throw new Error("Solana wallet public key not available - wallet not ready");
      }

      // Use HTTP-only connection (no WebSocket) since we're using a proxy
      const connection = createSolanaConnection();
      // Adapt our wallet adapter to Anchor's Wallet interface
      // Type assertion needed as anchor's Wallet type has changed across versions
      const anchorWallet = {
        publicKey: new SolPubkey(solanaWallet.publicKey.toBase58()),
        signTransaction: solanaWallet.signTransaction,
        signAllTransactions: solanaWallet.signAllTransactions,
      } as Wallet;
      const provider = new anchor.AnchorProvider(connection, anchorWallet, {
        commitment: "confirmed",
      });
      console.log("Fetching IDL");
      const idl = await fetchSolanaIdl();
      console.log("Fetched IDL");
      const program = new anchor.Program(idl, provider);
      console.log("Program created");

      // Use desk address from environment
      if (!SOLANA_DESK) {
        throw new Error("SOLANA_DESK address not configured in environment.");
      }
      const desk = new SolPubkey(SOLANA_DESK);
      const tokenMintPk = new SolPubkey(tokenMintAddress);
      const usdcMintPk = new SolPubkey(SOLANA_USDC_MINT);

      console.log("Token mint PK:", tokenMintPk.toString());
      console.log("USDC mint PK:", usdcMintPk.toString());
      console.log("Desk:", desk.toString());

      const deskTokenTreasury = await getAssociatedTokenAddress(tokenMintPk, desk, true);
      const deskUsdcTreasury = await getAssociatedTokenAddress(usdcMintPk, desk, true);

      console.log("Desk token treasury:", deskTokenTreasury.toString());
      console.log("Desk USDC treasury:", deskUsdcTreasury.toString());

      // Read nextOfferId from desk account
      // The program.account namespace is dynamically generated from IDL
      interface DeskAccountProgram {
        desk: {
          fetch: (address: SolPubkey) => Promise<{ nextOfferId: anchor.BN }>;
        };
      }

      const deskAccount = await (program.account as DeskAccountProgram).desk.fetch(desk);
      const nextOfferId = new anchor.BN(deskAccount.nextOfferId.toString());

      console.log("Next offer ID:", nextOfferId.toString());

      // Generate offer keypair (IDL expects signer)
      const offerKeypair = Keypair.generate();
      console.log("Generated offer keypair:", offerKeypair.publicKey.toString());

      // Create offer on Solana
      // Get decimals from state or fetch from API (handles race condition)
      let solDecimals: bigint;
      if (typeof solanaTokenDecimals === "number") {
        solDecimals = BigInt(solanaTokenDecimals);
      } else {
        // Fetch decimals from API as fallback
        console.log("[AcceptQuote] Solana decimals not in state, fetching from API...");
        const tokenAddress = initialQuote.tokenAddress?.trim() || solanaTokenMint?.trim();
        if (!tokenAddress) {
          throw new Error("Token address not available - cannot fetch decimals");
        }
        const decRes = await fetch(
          `/api/tokens/decimals?address=${encodeURIComponent(tokenAddress)}&chain=solana`,
        );
        if (!decRes.ok) {
          throw new Error(`Failed to fetch Solana decimals: HTTP ${decRes.status}`);
        }
        const decData = await decRes.json();
        if (!decData.success || typeof decData.decimals !== "number") {
          throw new Error(`Invalid decimals response for ${tokenAddress}`);
        }
        solDecimals = BigInt(decData.decimals);
        console.log(`[AcceptQuote] Fetched Solana decimals: ${solDecimals}`);
      }
      const tokenAmountWei = new anchor.BN((BigInt(tokenAmount) * 10n ** solDecimals).toString());
      const lockupSeconds = new anchor.BN(lockupDays * 24 * 60 * 60);
      const paymentCurrencySol = currency === "USDC" ? 1 : 0; // 0 SOL, 1 USDC

      console.log("Token amount wei:", tokenAmountWei.toString());
      console.log("Lockup seconds:", lockupSeconds.toString());
      console.log("Payment currency:", paymentCurrencySol);

      // Derive token registry PDA using shared utility
      const tokenRegistryPda = deriveTokenRegistryPda(desk, tokenMintPk, program.programId);
      console.log("Token registry PDA:", tokenRegistryPda.toString());

      // CRITICAL: Ensure token has a price set on-chain before creating offer
      // Without this, the Solana program will reject with "NoPrice" error
      console.log("Ensuring token price is set before offer...");
      const priceRes = await fetch("/api/solana/update-price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokenMint: tokenMintAddress,
          forceUpdate: true,
        }),
      });
      const priceData = await priceRes.json();

      console.log("[AcceptQuote] Price update response:", priceData);

      if (!priceRes.ok) {
        // If we have a price but couldn't update on-chain, show detailed error
        const poolInfo = priceData.pool ? ` (found pool: ${priceData.pool.slice(0, 8)}...)` : "";
        const priceInfo = priceData.priceUsd ? ` Price: $${priceData.priceUsd.toFixed(8)}` : "";
        // error message is optional - use default if not provided
        const errorMsg =
          typeof priceData.error === "string" && priceData.error.trim() !== ""
            ? priceData.error
            : "Price update failed";
        throw new Error(
          `${errorMsg}${poolInfo}${priceInfo}. ` +
            "Token may need to be registered with pool type and address on the OTC desk.",
        );
      }

      if (priceData.updated) {
        console.log(
          `✅ Price updated: $${priceData.oldPrice} → $${priceData.newPrice} (method: ${priceData.method})`,
        );
      } else if (priceData.price && priceData.price > 0) {
        console.log(`✅ Price available: $${priceData.price}`);
      } else if (priceData.stale) {
        // Price was fetched but couldn't be written on-chain
        // price is optional - use "?" if not available
        const priceDisplay = typeof priceData.price === "number" ? priceData.price.toFixed(8) : "?";
        // reason is optional - use empty string if not provided
        const reasonText =
          typeof priceData.reason === "string" && priceData.reason.trim() !== ""
            ? priceData.reason
            : "";
        throw new Error(
          `Token price ($${priceDisplay}) could not be set on-chain. ` +
            reasonText +
            "Please contact support to configure pricing.",
        );
      }

      // Validate we have a consignment address for Solana
      console.log(
        `[AcceptQuote] At transaction time, contractConsignmentId: ${contractConsignmentId}`,
      );
      if (!initialQuote.tokenChain) throw new Error("Quote missing tokenChain");
      if (!initialQuote.tokenSymbol) throw new Error("Quote missing tokenSymbol");
      console.log(`[AcceptQuote] Quote data:`, {
        consignmentId: initialQuote.consignmentId, // Optional field
        tokenAddress: initialQuote.tokenAddress, // Optional field
        tokenSymbol: initialQuote.tokenSymbol, // Required field
        tokenChain: initialQuote.tokenChain, // Required field
      });
      if (!contractConsignmentId) {
        throw new Error(
          "No consignment available for this token. Please ensure the seller has deposited tokens to the OTC desk.",
        );
      }

      // Fetch consignment's numeric ID from on-chain account
      const consignmentPubkey = new SolPubkey(contractConsignmentId);
      console.log(`[AcceptQuote] Fetching consignment account: ${contractConsignmentId}`);

      interface ConsignmentAccountProgram {
        consignment: {
          fetch: (addr: SolPubkey) => Promise<{ id: anchor.BN }>;
        };
      }

      const consignmentAccount = await (
        program.account as ConsignmentAccountProgram
      ).consignment.fetch(consignmentPubkey);
      const consignmentId = new anchor.BN(consignmentAccount.id.toString());
      console.log(`[AcceptQuote] Consignment numeric ID: ${consignmentId.toString()}`);

      // Get agent commission from quote (0 for P2P, 25-150 for negotiated)
      const agentCommissionBps =
        typeof initialQuote.agentCommissionBps === "number" ? initialQuote.agentCommissionBps : 25;

      // Build transaction using createOfferFromConsignment (matches FlowTest pattern)
      const tx = await program.methods
        .createOfferFromConsignment(
          consignmentId, // consignment_id
          tokenAmountWei, // token_amount
          discountBps, // discount_bps
          paymentCurrencySol, // currency (0 = SOL, 1 = USDC)
          lockupSeconds, // lockup_secs
          agentCommissionBps, // agent_commission_bps
        )
        .accounts({
          desk,
          consignment: consignmentPubkey,
          tokenRegistry: tokenRegistryPda,
          deskTokenTreasury,
          beneficiary: new SolPubkey(solanaWallet.publicKey.toBase58()),
          offer: offerKeypair.publicKey,
          systemProgram: SolSystemProgram.programId,
        })
        .transaction();

      // Set recent blockhash and fee payer
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = new SolPubkey(solanaWallet.publicKey.toBase58());

      // Sign with offer keypair first
      tx.partialSign(offerKeypair);

      if (!solanaWallet.signTransaction) {
        throw new Error("Wallet missing signTransaction");
      }
      const signedTx = await solanaWallet.signTransaction(tx);

      // Send raw transaction
      const txSignature = await connection.sendRawTransaction(signedTx.serialize(), {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });

      // Confirm using polling (avoids WebSocket)
      await confirmTransactionPolling(connection, txSignature, "confirmed");

      console.log("Offer created:", txSignature);

      dispatch({ type: "SET_STEP", payload: "await_approval" });

      // Request backend approval (same as EVM flow) - include consignmentAddress for Solana
      console.log("Requesting approval from backend...");
      const approveRes = await fetch("/api/otc/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offerId: nextOfferId.toString(),
          chain: "solana",
          offerAddress: offerKeypair.publicKey.toString(),
          consignmentAddress: contractConsignmentId, // Required for Solana approval
        }),
      });

      if (!approveRes.ok) {
        const errorText = await approveRes.text();
        throw new Error(`Approval failed: ${errorText}`);
      }

      console.log("Approval requested, backend will approve and pay...");

      // Wait for backend to approve AND auto-fulfill
      dispatch({ type: "SET_STEP", payload: "paying" });
      const approveData = await approveRes.json();

      if (!approveData.autoFulfilled || !approveData.fulfillTx) {
        throw new Error("Backend did not auto-fulfill Solana offer");
      }

      console.log("✅ Backend approved:", approveData.approvalTx);
      console.log("✅ Backend paid:", approveData.fulfillTx);
      console.log("Offer completed automatically");

      // Auto-claim tokens (backend handles this after lockup expires)
      console.log("Requesting automatic token distribution...");
      const claimRes = await fetch("/api/solana/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offerAddress: offerKeypair.publicKey.toString(),
          beneficiary: solanaWallet.publicKey.toBase58(),
        }),
      });

      if (claimRes.ok) {
        const claimData = await claimRes.json();
        if (claimData.scheduled) {
          console.log(
            `✅ Tokens will be automatically distributed after lockup (${Math.floor(claimData.secondsRemaining / 86400)} days)`,
          );
        } else {
          console.log("✅ Tokens immediately distributed");
        }
      } else {
        console.warn("Claim scheduling failed, tokens will be claimable manually");
      }

      // Quote ID already validated at component mount

      if (!solanaPublicKey) {
        throw new Error("Solana public key not available");
      }
      // Solana addresses are Base58 encoded and case-sensitive - preserve original case
      const solanaWalletAddress = solanaPublicKey;

      // CRITICAL: Capture tokenAmount NOW before any async operations
      const finalTokenAmount = tokenAmount;

      console.log("[Solana] Saving deal completion:", {
        quoteId: initialQuote.quoteId,
        wallet: solanaWalletAddress,
        offerId: nextOfferId.toString(),
        tokenAmount: finalTokenAmount,
        currency,
      });

      const response = await fetch("/api/deal-completion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "complete",
          quoteId: initialQuote.quoteId,
          tokenAmount: String(finalTokenAmount),
          paymentCurrency: currency,
          offerId: nextOfferId.toString(),
          transactionHash: "",
          chain: "solana",
          offerAddress: offerKeypair.publicKey.toString(),
          beneficiary: solanaWalletAddress,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[Solana] Deal save failed:", errorText);
        throw new Error(`Failed to save deal: ${errorText}`);
      }

      const saveResult = await response.json();
      console.log("✅ Deal completion saved:", saveResult);

      // VERIFY the save succeeded
      if (!saveResult.success) {
        throw new Error("Deal save returned success=false");
      }
      if (!saveResult.quote) {
        throw new Error("Deal save didn't return quote data");
      }
      if (saveResult.quote.status !== "executed") {
        throw new Error(`Deal saved but status is ${saveResult.quote.status}, not executed`);
      }

      console.log("✅ VERIFIED deal is in database as executed");

      dispatch({
        type: "SET_COMPLETED",
        payload: {
          txHash: null, // Solana tx hashes handled differently
          offerId: nextOfferId.toString(),
        },
      });
      onComplete?.({ offerId: BigInt(nextOfferId.toString()) });

      // Redirect to deal page after showing success
      setTimeout(() => {
        router.push(`/deal/${initialQuote.quoteId}`);
      }, 2000);
      return;
    }

    // Validate beneficiary matches connected wallet (fast, no network)
    if (
      initialQuote.beneficiary &&
      address &&
      initialQuote.beneficiary.toLowerCase() !== address.toLowerCase()
    ) {
      throw new Error(
        `Wallet mismatch: Quote is for ${initialQuote.beneficiary.slice(0, 6)}... but you're connected as ${address.slice(0, 6)}...`,
      );
    }

    // Run pre-transaction calls in parallel (saves ~500ms)
    const [nextId] = await Promise.all([
      readNextOfferId(),
      // Non-blocking quote update (log errors but don't block transaction)
      // The actual financial data is calculated in /api/deal-completion after the offer is created
      fetch("/api/quote/latest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteId: initialQuote.quoteId,
          beneficiary: address,
          tokenAmount: String(tokenAmount),
          paymentCurrency: currency,
          totalUsd: 0,
          discountUsd: 0,
          discountedUsd: 0,
          paymentAmount: "0",
        }),
      }).catch((err) => {
        // Log but don't block - actual data saved in deal-completion
        console.warn("[AcceptQuote] Pre-transaction quote update failed (non-critical):", err);
      }),
    ]);
    const newOfferId = nextId;

    // Step 1: Create offer from consignment (User transaction - ONLY transaction user signs)
    console.log(`[AcceptQuote] Creating offer ${newOfferId}...`);

    // Validate we have a consignment ID
    if (!contractConsignmentId) {
      throw new Error(
        "No consignment available. This quote may not be linked to an active listing. Please request a new quote from the chat.",
      );
    }

    // CRITICAL: Fetch token decimals synchronously if not already set
    // This prevents race condition where user clicks Confirm before async useEffect completes
    let tokenDecimals: number | null =
      typeof solanaTokenDecimals === "number" ? solanaTokenDecimals : null;
    if (tokenDecimals === null) {
      console.log("[AcceptQuote] Decimals not set, fetching from API...");
      const chain = initialQuote.tokenChain ?? targetEvmChain ?? undefined;
      if (!chain) {
        throw new Error("Token chain not available - cannot fetch decimals");
      }
      // Use quote tokenAddress if available, otherwise fall back to solanaTokenMint
      const tokenAddress =
        initialQuote.tokenAddress?.trim() || solanaTokenMint?.trim() || undefined;
      if (!tokenAddress) {
        throw new Error("Token address not available - cannot fetch decimals");
      }

      // Prefer fetching by address (more reliable - gets decimals directly from chain)
      if (tokenAddress) {
        const res = await fetch(
          `/api/tokens/decimals?address=${encodeURIComponent(tokenAddress)}&chain=${chain}`,
        );
        if (!res.ok) {
          throw new Error(`Failed to fetch decimals: HTTP ${res.status}`);
        }
        const data = await res.json();
        if (!data.success || typeof data.decimals !== "number") {
          throw new Error(`Invalid decimals response for ${tokenAddress}`);
        }
        tokenDecimals = data.decimals;
        console.log(
          `[AcceptQuote] Fetched decimals from chain: ${tokenDecimals} (source: ${data.source})`,
        );
      }

      if (tokenDecimals === null || typeof tokenDecimals !== "number") {
        throw new Error(
          `Token decimals not available for ${tokenAddress || "unknown token"}. Cannot proceed without decimals.`,
        );
      }
    }

    const tokenAmountWei = BigInt(tokenAmount) * 10n ** BigInt(tokenDecimals);
    const lockupSeconds = BigInt(lockupDays * 24 * 60 * 60);
    const paymentCurrency = currency === "USDC" ? 1 : 0;

    // Get agent commission from quote (0 for P2P, 25-150 for negotiated)
    const agentCommissionBps =
      typeof initialQuote.agentCommissionBps === "number" ? initialQuote.agentCommissionBps : 0;

    console.log(`[AcceptQuote] Using consignment ID: ${contractConsignmentId}`);
    console.log(`[AcceptQuote] Token decimals: ${tokenDecimals}, amount wei: ${tokenAmountWei}`);
    console.log(`[AcceptQuote] Agent commission: ${agentCommissionBps} bps`);

    const createTxHash = (await createOfferFromConsignment({
      consignmentId: BigInt(contractConsignmentId),
      tokenAmountWei,
      discountBps,
      paymentCurrency,
      lockupSeconds,
      agentCommissionBps,
      chain: targetEvmChain || "base",
      otcOverride: effectiveOtcAddress,
    })) as `0x${string}`;

    console.log(`[AcceptQuote] ✅ Offer created: ${newOfferId}, tx: ${createTxHash}`);

    // Don't wait for receipt - immediately trigger backend approval
    // Backend will verify on-chain state directly via Alchemy (faster than frontend polling)
    console.log("[AcceptQuote] Transaction hash:", createTxHash);
    console.log("[AcceptQuote] View on explorer: https://basescan.org/tx/" + createTxHash);

    // Step 2: Immediately trigger backend approval
    console.log("[AcceptQuote] Updating UI to await_approval step...");
    dispatch({ type: "SET_STEP", payload: "await_approval" });

    // Small delay for UI update
    await new Promise((resolve) => setTimeout(resolve, 100));

    console.log(`[AcceptQuote] Triggering backend approval for offer ${newOfferId}...`);

    // Call backend with retry logic - backend verifies on-chain state (idempotent)
    let approveRes: Response | undefined;
    let lastApproveError: Error | string | null = null;
    const maxApproveAttempts = 5;

    for (let attempt = 1; attempt <= maxApproveAttempts; attempt++) {
      try {
        console.log(
          `[AcceptQuote] Calling /api/otc/approve (attempt ${attempt}/${maxApproveAttempts})...`,
        );
        approveRes = await fetch("/api/otc/approve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            offerId: newOfferId.toString(),
            txHash: createTxHash,
            chain: targetEvmChain,
          }),
        });

        console.log("[AcceptQuote] /api/otc/approve response status:", approveRes.status);

        if (approveRes.ok) break;
        if (approveRes.status >= 400 && approveRes.status < 500) break; // Don't retry client errors

        lastApproveError = `HTTP ${approveRes.status}`;
      } catch (fetchError) {
        console.warn(`[AcceptQuote] Approve attempt ${attempt} failed:`, fetchError);
        lastApproveError = fetchError instanceof Error ? fetchError : String(fetchError);
      }

      if (attempt < maxApproveAttempts) {
        const delay = 2 ** attempt * 1000;
        console.log(`[AcceptQuote] Retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    if (!approveRes) {
      throw new Error(`Network error calling approval API: ${lastApproveError}`);
    }

    if (!approveRes.ok) {
      const errorText = await approveRes.text();
      console.error("[AcceptQuote] Approval API error:", errorText);
      throw new Error(`Approval failed: ${errorText}`);
    }

    const approveData = await approveRes.json();
    const approvalTxHash = approveData.approvalTx ?? approveData.txHash;
    if (!approvalTxHash) {
      throw new Error("Approval response missing transaction hash");
    }
    console.log(`[AcceptQuote] ✅ Offer approved:`, approvalTxHash);

    // Backend should have auto-fulfilled (requireApproverToFulfill=true)
    if (!approveData.autoFulfilled || !approveData.fulfillTx) {
      // Check if contract is misconfigured
      if (!requireApprover) {
        throw new Error(
          "Contract is not configured for auto-fulfillment. Please contact support to enable requireApproverToFulfill.",
        );
      }

      // Check if offer was already paid
      const [, , , , , , , , , isPaid] = await readOffer(newOfferId);
      if (isPaid) {
        console.log("[AcceptQuote] Offer was already paid by another transaction");
        // Continue to verification - this is actually fine
      } else {
        // Something went wrong - offer is approved but not paid
        console.error("[AcceptQuote] Backend approval succeeded but auto-fulfill failed:", {
          approveData,
          requireApprover,
          offerId: newOfferId.toString(),
        });

        throw new Error(
          `Backend approval succeeded but payment failed. Your offer (ID: ${newOfferId}) is approved but not paid. Please contact support with this offer ID.`,
        );
      }
    }

    const paymentTxHashTyped = (approveData.fulfillTx ?? approveData.approvalTx) as
      | `0x${string}`
      | undefined;
    if (!paymentTxHashTyped) {
      throw new Error("Payment transaction hash not available in approval response");
    }

    if (approveData.fulfillTx) {
      console.log(`[AcceptQuote] ✅ Backend auto-fulfilled:`, paymentTxHashTyped);
    } else {
      console.log(`[AcceptQuote] ✅ Offer was already fulfilled, continuing...`);
    }

    // Verify payment was actually made on-chain
    console.log("[AcceptQuote] Verifying payment on-chain...");
    const [, , , , , , , , , isPaidFinal] = await readOffer(newOfferId);

    if (!isPaidFinal) {
      throw new Error(
        "Backend reported success but offer not paid on-chain. Please contact support with offer ID: " +
          newOfferId,
      );
    }
    console.log("[AcceptQuote] ✅ Payment verified on-chain");

    // Quote ID already validated at component mount

    console.log("[AcceptQuote] Saving deal completion:", {
      quoteId: initialQuote.quoteId,
      offerId: String(newOfferId),
      tokenAmount: String(tokenAmount),
      currency,
      txHash: paymentTxHashTyped,
    });

    const saveRes = await fetch("/api/deal-completion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "complete",
        quoteId: initialQuote.quoteId,
        tokenAmount: String(tokenAmount),
        paymentCurrency: currency,
        offerId: String(newOfferId),
        transactionHash: paymentTxHashTyped,
        chain: "evm",
      }),
    });

    if (!saveRes.ok) {
      const errorText = await saveRes.text();
      throw new Error(
        `Deal completion save failed: ${errorText}. Your offer is paid but not saved. Offer ID: ${newOfferId}`,
      );
    }

    const saveData = await saveRes.json();
    console.log("[AcceptQuote] ✅ Deal completion saved:", saveData);

    // NOW show success (everything confirmed)
    dispatch({
      type: "SET_COMPLETED",
      payload: {
        txHash: paymentTxHashTyped,
        offerId: newOfferId.toString(),
      },
    });

    onComplete?.({ offerId: newOfferId, txHash: paymentTxHashTyped });

    // Auto-redirect after showing success briefly
    setTimeout(() => {
      router.push(`/deal/${initialQuote.quoteId}`);
    }, 2000);
  };

  const estPerTokenUsd = useMemo(() => {
    // Use quote's pricePerToken with discount applied for estimation
    // Use pricePerToken if available, otherwise fallbackTokenPrice
    const basePrice =
      initialQuote.pricePerToken && initialQuote.pricePerToken > 0
        ? initialQuote.pricePerToken
        : fallbackTokenPrice && fallbackTokenPrice > 0
          ? fallbackTokenPrice
          : 0;
    if (!basePrice || basePrice <= 0) {
      // Price estimation unavailable - return 0 to indicate we can't estimate
      // This is acceptable for display purposes, but transaction will fail if price is truly missing
      return 0;
    }
    const discountBps = initialQuote.discountBps;
    const discountMultiplier = 1 - discountBps / 10000;
    return basePrice * discountMultiplier;
  }, [initialQuote.pricePerToken, initialQuote.discountBps, fallbackTokenPrice]);

  const balanceDisplay = useMemo(() => {
    // For Solana tokens, use the Solana balance hook
    if (isSolanaToken) {
      if (!solanaBalance?.formatted) {
        return "—";
      }
      return solanaBalance.formatted;
    }
    if (!isConnected) return "—";
    if (currency === "USDC") {
      if (!usdcBalance.data?.formatted) {
        return "0";
      }
      const v = Number(usdcBalance.data.formatted);
      return `${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    }
    // Native balance (ETH/BNB)
    if (!ethBalance?.formatted) {
      return "0";
    }
    const eth = Number(ethBalance.formatted);
    return `${eth.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
  }, [
    isConnected,
    isSolanaToken,
    currency,
    usdcBalance.data?.formatted,
    ethBalance?.formatted,
    solanaBalance?.formatted,
  ]);

  const handleMaxClick = () => {
    // For Solana tokens or when we can't calculate affordability, use max available
    if (isSolanaToken) {
      setTokenAmount(effectiveMaxTokens);
      return;
    }

    let maxByFunds = effectiveMaxTokens; // Start with max available
    if (currency === "USDC") {
      if (!usdcBalance.data?.formatted) {
        return; // No balance data available
      }
      const usdc = Number(usdcBalance.data.formatted);
      if (estPerTokenUsd > 0 && usdc > 0) {
        maxByFunds = Math.min(maxByFunds, Math.floor(usdc / estPerTokenUsd));
      }
    } else if (currency === "ETH" || currency === "BNB") {
      if (!ethBalance?.formatted) {
        return; // No balance data available
      }
      const eth = Number(ethBalance.formatted);
      const nativeUsd = nativeUsdPrice;
      if (nativeUsd > 0 && estPerTokenUsd > 0 && eth > 0) {
        const usd = eth * nativeUsd;
        maxByFunds = Math.min(maxByFunds, Math.floor(usd / estPerTokenUsd));
      }
    }
    // Ensure we stay above minimum (1 token)
    if (maxByFunds < 1) {
      maxByFunds = 1;
    }
    setTokenAmount(clampAmount(maxByFunds));
  };

  // Unified connection handler - uses connectWallet if already authenticated, login if not
  const handleConnect = () => {
    console.log("[AcceptQuote] Opening Privy login/connect modal...");
    if (privyAuthenticated) {
      connectWallet();
    } else {
      login();
    }
  };

  const maxAffordableTokens = useMemo(() => {
    // For Solana, we can't check balance via wagmi - return max available
    if (isSolanaToken || estPerTokenUsd <= 0) return effectiveMaxTokens;

    let maxByFunds = effectiveMaxTokens;
    if (currency === "USDC") {
      if (!usdcBalance.data?.formatted) {
        return effectiveMaxTokens; // No balance data available
      }
      const usdc = Number(usdcBalance.data.formatted);
      if (usdc > 0) maxByFunds = Math.floor(usdc / estPerTokenUsd);
    } else if (currency === "ETH" || currency === "BNB") {
      if (!ethBalance?.formatted) {
        return effectiveMaxTokens; // No balance data available
      }
      const eth = Number(ethBalance.formatted);
      if (nativeUsdPrice > 0 && eth > 0)
        maxByFunds = Math.floor((eth * nativeUsdPrice) / estPerTokenUsd);
    }
    // Return min of what user can afford vs what's available
    return Math.min(maxByFunds, effectiveMaxTokens);
  }, [
    isSolanaToken,
    effectiveMaxTokens,
    estPerTokenUsd,
    currency,
    nativeUsdPrice,
    usdcBalance.data?.formatted,
    ethBalance?.formatted,
  ]);

  const validationError = useMemo(() => {
    if (tokenAmount < 1) return "You must buy at least 1 token.";
    if (tokenAmount > effectiveMaxTokens)
      return `Exceeds available supply (~${effectiveMaxTokens.toLocaleString()} max).`;
    if (!isSolanaToken && estPerTokenUsd > 0 && tokenAmount > maxAffordableTokens) {
      return `Exceeds what you can afford (~${maxAffordableTokens.toLocaleString()} max).`;
    }
    return null;
  }, [tokenAmount, effectiveMaxTokens, estPerTokenUsd, maxAffordableTokens, isSolanaToken]);

  const estimatedPayment = useMemo(() => {
    if (estPerTokenUsd <= 0) return { usdc: undefined, native: undefined, usd: undefined };
    const totalUsd = tokenAmount * estPerTokenUsd;
    const usd = totalUsd.toFixed(2);
    if (currency === "USDC") return { usdc: usd, native: undefined, usd };
    const nativeUsd = nativeUsdPrice;
    return {
      usdc: undefined,
      native: nativeUsd > 0 ? (totalUsd / nativeUsd).toFixed(6) : undefined,
      usd,
    };
  }, [tokenAmount, estPerTokenUsd, currency, nativeUsdPrice]);

  const insufficientFunds = useMemo(() => {
    if (isSolanaToken || estPerTokenUsd <= 0) return false;
    if ((currency === "ETH" || currency === "BNB") && !nativeUsdPrice) return false;
    return tokenAmount > maxAffordableTokens;
  }, [isSolanaToken, estPerTokenUsd, tokenAmount, maxAffordableTokens, currency, nativeUsdPrice]);

  return (
    <Dialog open={isOpen} onClose={onClose} size="3xl" data-testid="accept-quote-modal">
      <div className="w-full max-w-[720px] mx-auto p-0 rounded-2xl bg-zinc-950 text-white ring-1 ring-white/10 max-h-[95dvh] overflow-y-auto">
        {/* Chain Mismatch or Not Connected Warning */}
        {(isChainMismatch || (isSolanaToken && !solanaPublicKey) || (isEvmToken && !address)) && (
          <div className="bg-blue-500/10 border-b border-blue-500/20 p-4">
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center">
                {walletConnected &&
                isChainMismatch &&
                ((quoteChain === "solana" && Boolean(solanaPublicKey)) ||
                  (quoteChain !== "solana" && Boolean(address))) ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-500 border-t-transparent" />
                ) : (
                  <svg
                    className="w-4 h-4 text-blue-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                    />
                  </svg>
                )}
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-blue-400">
                  {walletConnected &&
                  isChainMismatch &&
                  ((quoteChain === "solana" && Boolean(solanaPublicKey)) ||
                    (quoteChain !== "solana" && Boolean(address)))
                    ? `Switching to ${quoteChain === "solana" ? "Solana" : "EVM"}...`
                    : `Connect ${quoteChain === "solana" ? "Solana" : "EVM"} Wallet`}
                </h3>
                <p className="text-xs text-zinc-400">
                  This token requires a {quoteChain === "solana" ? "Solana" : "EVM"} wallet.
                </p>
              </div>
              {/* Show connect button when not connected */}
              {!walletConnected && (
                <button
                  type="button"
                  className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                    privyReady
                      ? "bg-blue-500 hover:bg-blue-600 text-white"
                      : "bg-zinc-700 text-zinc-300 cursor-not-allowed"
                  }`}
                  disabled={!privyReady}
                  onClick={async () => {
                    setActiveFamily(quoteChain === "solana" ? "solana" : "evm");
                    onClose();
                    await new Promise((resolve) => setTimeout(resolve, 100));
                    handleConnect();
                  }}
                >
                  {privyReady ? "Connect" : "Loading..."}
                </button>
              )}
              {/* Show connect button when wrong wallet type connected */}
              {walletConnected &&
                ((isSolanaToken && !solanaPublicKey) || (isEvmToken && !address)) && (
                  <button
                    type="button"
                    className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                      privyReady
                        ? "bg-blue-500 hover:bg-blue-600 text-white"
                        : "bg-zinc-700 text-zinc-300 cursor-not-allowed"
                    }`}
                    disabled={!privyReady}
                    onClick={async () => {
                      setActiveFamily(quoteChain === "solana" ? "solana" : "evm");
                      onClose();
                      await new Promise((resolve) => setTimeout(resolve, 100));
                      handleConnect();
                    }}
                  >
                    {privyReady
                      ? `Connect ${quoteChain === "solana" ? "Phantom" : "MetaMask"}`
                      : "Loading..."}
                  </button>
                )}
            </div>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between px-3 sm:px-5 pt-4 sm:pt-5">
          <div className="text-base sm:text-lg font-semibold tracking-wide">Your Quote</div>
          <div className="flex items-center gap-2 sm:gap-3 text-xs sm:text-sm">
            <button
              type="button"
              className={`px-2 py-1 rounded-md ${isChainMismatch ? "cursor-not-allowed opacity-50" : ""} ${currency === "USDC" ? "bg-white text-black" : "text-zinc-300"}`}
              onClick={() => setCurrency("USDC")}
              disabled={isChainMismatch}
            >
              USDC
            </button>
            <span className="text-zinc-600">|</span>
            <button
              type="button"
              className={`px-2 py-1 rounded-md ${isChainMismatch ? "cursor-not-allowed opacity-50" : ""} ${currency !== "USDC" ? "bg-white text-black" : "text-zinc-300"}`}
              onClick={() =>
                // Use quoteChain (token's chain), not activeFamily (user's wallet)
                setCurrency(isSolanaToken ? "SOL" : nativeSymbol === "BNB" ? "BNB" : "ETH")
              }
              disabled={isChainMismatch}
            >
              {/* Show SOL for Solana tokens, ETH for EVM tokens */}
              {isSolanaToken ? "SOL" : nativeSymbol}
            </button>
          </div>
        </div>

        {/* Main amount card */}
        <div className="m-3 sm:m-5 rounded-xl bg-zinc-900 ring-1 ring-white/10">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between px-3 sm:px-5 pt-3 sm:pt-4 gap-2">
            <div className="text-xs sm:text-sm text-zinc-400">
              {isFixedPriceDeal ? "Fixed Amount" : "Amount to Buy"}
            </div>
            {/* Only show balance and MAX button for fractional deals */}
            {!isFixedPriceDeal && (
              <div className="flex items-center gap-2 sm:gap-3 text-xs sm:text-sm text-zinc-400">
                <span className="whitespace-nowrap">Balance: {balanceDisplay}</span>
                <button
                  type="button"
                  className={`font-medium ${isChainMismatch ? "text-zinc-600 cursor-not-allowed" : "text-brand-400 hover:text-brand-300"}`}
                  onClick={handleMaxClick}
                  disabled={isChainMismatch}
                >
                  MAX
                </button>
              </div>
            )}
          </div>
          <div className="px-3 sm:px-5 pb-3 sm:pb-4">
            <div className="flex items-center justify-between gap-2 sm:gap-3">
              {isFixedPriceDeal ? (
                /* Fixed price: Show amount as static text */
                <div className="text-3xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-white">
                  {tokenAmount.toLocaleString()}
                </div>
              ) : (
                /* Fractional: Show editable input */
                <input
                  data-testid="token-amount-input"
                  type="number"
                  value={tokenAmount}
                  onChange={(e) => setTokenAmount(Number(e.target.value))}
                  min={1}
                  max={effectiveMaxTokens}
                  disabled={isChainMismatch}
                  className={`w-full bg-transparent border-none outline-none text-3xl sm:text-5xl md:text-6xl font-extrabold tracking-tight ${isChainMismatch ? "text-zinc-500 cursor-not-allowed" : "text-white"}`}
                />
              )}
              <div className="flex items-center gap-3 text-right flex-shrink-0">
                {/* Token Logo */}
                <div className="h-10 w-10 rounded-full bg-zinc-800 flex items-center justify-center overflow-hidden ring-1 ring-white/10 relative">
                  {/* Use tokenMetadata if loaded, otherwise fallback to quote data (always available) */}
                  {tokenMetadata?.logoUrl ? (
                    <Image
                      src={tokenMetadata.logoUrl}
                      alt={tokenMetadata.symbol}
                      fill
                      className="object-cover"
                      unoptimized
                      onError={(e) => {
                        // Fallback to symbol if image fails - hide the image
                        e.currentTarget.style.display = "none";
                      }}
                    />
                  ) : null}
                  {/* Fallback symbol - shown when no logo or logo fails to load */}
                  {(!tokenMetadata || !tokenMetadata.logoUrl) && (
                    <span className="text-brand-400 text-sm font-bold">
                      {(tokenMetadata?.symbol || initialQuote.tokenSymbol).slice(0, 2)}
                    </span>
                  )}
                </div>
                {/* Token Name & Symbol */}
                <div className="text-right min-w-0">
                  <div className="text-sm font-semibold truncate">
                    {tokenMetadata ? tokenMetadata.symbol : initialQuote.tokenSymbol}
                  </div>
                  <div className="text-xs text-zinc-400 truncate max-w-[120px]">
                    {tokenMetadata ? tokenMetadata.name : initialQuote.tokenSymbol}
                  </div>
                </div>
              </div>
            </div>
            {/* Only show range info and slider for fractional deals */}
            {!isFixedPriceDeal && (
              <>
                <div className="mt-1 text-[10px] sm:text-xs text-zinc-500">
                  {`1 - ${effectiveMaxTokens.toLocaleString()} ${initialQuote.tokenSymbol} available`}
                </div>
                <div className="mt-2">
                  <input
                    data-testid="token-amount-slider"
                    type="range"
                    min={1}
                    max={effectiveMaxTokens}
                    value={tokenAmount}
                    onChange={(e) => setTokenAmount(Number(e.target.value))}
                    disabled={isChainMismatch}
                    className={`w-full ${isChainMismatch ? "accent-zinc-600 cursor-not-allowed opacity-50" : "accent-brand-500"}`}
                  />
                </div>
              </>
            )}
            {/* Show "Fixed Price Deal" label for non-fractional */}
            {isFixedPriceDeal && (
              <div className="mt-2 text-[10px] sm:text-xs text-brand-400">
                This is a fixed-price deal — buy the entire allocation
              </div>
            )}
          </div>
        </div>

        {/* Stats row */}
        <div className="px-3 sm:px-5 pb-1">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-6 text-xs sm:text-sm">
            <div>
              <div className="text-zinc-500 text-xs">Your Discount</div>
              <div className="text-base sm:text-lg font-semibold">
                {(discountBps / 100).toFixed(0)}%
              </div>
            </div>
            <div>
              <div className="text-zinc-500 text-xs">Maturity</div>
              <div className="text-base sm:text-lg font-semibold">
                {Math.round(lockupDays / 30)} mo
              </div>
            </div>
            <div>
              <div className="text-zinc-500 text-xs">Maturity date</div>
              <div className="text-base sm:text-lg font-semibold">
                {new Date(Date.now() + lockupDays * 24 * 60 * 60 * 1000).toLocaleDateString(
                  undefined,
                  {
                    month: "2-digit",
                    day: "2-digit",
                    year: "2-digit",
                  },
                )}
              </div>
            </div>
            <div>
              <div className="text-zinc-500 text-xs">Est. Payment</div>
              <div className="text-base sm:text-lg font-semibold">
                {currency === "USDC" && estimatedPayment.usdc
                  ? `$${Number(estimatedPayment.usdc).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                  : (currency === "ETH" || currency === "BNB") && estimatedPayment.native
                    ? `${estimatedPayment.native} ${nativeSymbol}`
                    : (currency === "ETH" || currency === "BNB") && estimatedPayment.usd
                      ? `~$${Number(estimatedPayment.usd).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                      : currency === "SOL" && estimatedPayment.usd
                        ? `~$${Number(estimatedPayment.usd).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                        : "—"}
              </div>
            </div>
          </div>
        </div>

        {requireApprover && (
          <div className="px-3 sm:px-5 pb-1 text-xs text-zinc-400">
            Payment will be executed by the desk&apos;s whitelisted approver wallet on your behalf
            after approval.
          </div>
        )}

        {(error || validationError || insufficientFunds) && (
          <div className="px-3 sm:px-5 pt-2 text-xs text-red-400">
            {error ||
              validationError ||
              (insufficientFunds ? `Insufficient ${currency} balance for this purchase.` : null)}
          </div>
        )}

        {/* Actions / Connect state */}
        {!walletConnected ? (
          <div className="px-3 sm:px-5 pb-4 sm:pb-5">
            <div className="rounded-xl overflow-hidden ring-1 ring-white/10 bg-zinc-900">
              <div className="relative">
                <div className="relative min-h-[200px] sm:min-h-[280px] w-full bg-gradient-to-br from-zinc-900 to-zinc-800 py-6 sm:py-8">
                  <div
                    aria-hidden
                    className="absolute inset-0 opacity-30 bg-no-repeat bg-right-bottom"
                    style={{
                      backgroundImage: "url('/business.png')",
                      backgroundSize: "contain",
                    }}
                  />
                  <div className="relative z-10 h-full w-full flex flex-col items-center justify-center text-center px-4 sm:px-6">
                    <h3 className="text-lg sm:text-xl font-semibold text-white tracking-tight mb-2">
                      Sign in to continue
                    </h3>
                    <p className="text-zinc-300 text-sm sm:text-md mb-4">Let&apos;s deal, anon.</p>
                    {/* Single connect button - Privy handles wallet detection */}
                    <Button
                      onClick={handleConnect}
                      disabled={!privyReady}
                      color="brand"
                      className="!px-6 sm:!px-8 !py-2 sm:!py-3 !text-base sm:!text-lg"
                    >
                      {privyReady ? "Connect Wallet" : "Loading..."}
                    </Button>
                    <p className="text-xs text-zinc-500 mt-3 sm:mt-4">
                      Supports Farcaster, MetaMask, Phantom, Coinbase Wallet & more
                    </p>
                  </div>
                </div>
              </div>
              <div className="p-3 sm:p-4 text-xs text-zinc-400">
                This token is on{" "}
                <span className="font-semibold">
                  {quoteChain === "solana"
                    ? "Solana"
                    : quoteChain === "base"
                      ? "BASE"
                      : quoteChain === "bsc"
                        ? "BSC"
                        : quoteChain === "ethereum"
                          ? "ETHEREUM"
                          : String(quoteChain).toUpperCase()}
                </span>
                . Connect a compatible wallet to buy.
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 sm:gap-3 mt-3 sm:mt-4">
              <Button onClick={onClose} color="dark">
                <div className="px-3 sm:px-4 py-2">Cancel</div>
              </Button>
            </div>
          </div>
        ) : step !== "complete" ? (
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2 sm:gap-3 px-3 sm:px-5 py-4 sm:py-5">
            <Button onClick={onClose} color="dark" className="w-full sm:w-auto">
              <div className="px-4 py-2">Cancel</div>
            </Button>
            <Button
              data-testid="confirm-amount-button"
              onClick={handleConfirm}
              color="brand"
              className="w-full sm:w-auto"
              disabled={
                Boolean(validationError) ||
                insufficientFunds ||
                isProcessing ||
                isChainMismatch ||
                isWaitingForNativePrice
              }
              title={
                isChainMismatch
                  ? `Switch to ${quoteChain === "solana" ? "Solana" : "EVM"} first`
                  : isWaitingForNativePrice
                    ? "Loading prices..."
                    : undefined
              }
            >
              <div className="px-4 py-2">
                {isWaitingForNativePrice ? "Loading Prices..." : "Buy Now"}
              </div>
            </Button>
          </div>
        ) : null}

        {/* Progress states */}
        {step === "creating" && (
          <div className="px-5 pb-6">
            <div className="text-center py-6">
              <LoadingSpinner size={48} className="mx-auto mb-4" />
              <h3 className="font-semibold mb-2">Creating Offer</h3>
              <p className="text-sm text-zinc-400">
                Confirm the transaction in your wallet to create your offer on-chain.
              </p>
            </div>
          </div>
        )}

        {step === "await_approval" && (
          <div className="px-5 pb-6">
            <div className="text-center py-6">
              <LoadingSpinner size={48} colorClass="border-green-500" className="mx-auto mb-4" />
              <h3 className="font-semibold mb-2">Processing Deal</h3>
              <p className="text-sm text-zinc-400">
                Our desk is reviewing and completing your purchase. Payment will be processed
                automatically.
              </p>
              <p className="text-xs text-zinc-500 mt-2">This usually takes a few seconds...</p>
            </div>
          </div>
        )}

        {step === "paying" && (
          <div className="px-5 pb-6">
            <div className="text-center py-6">
              <LoadingSpinner size={48} colorClass="border-blue-500" className="mx-auto mb-4" />
              <h3 className="font-semibold mb-2">Completing Payment</h3>
              <p className="text-sm text-zinc-400">Finalizing your purchase on-chain...</p>
            </div>
          </div>
        )}

        {step === "complete" && (
          <div className="px-5 pb-6">
            <div className="text-center py-6">
              <div className="w-12 h-12 rounded-full bg-green-900/30 flex items-center justify-center mx-auto mb-4">
                <svg
                  className="w-6 h-6 text-green-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <h3 className="font-semibold mb-2">Deal Complete</h3>
              <p className="text-sm text-zinc-400">
                Your purchase is complete. You&apos;ll receive your tokens at maturity.
              </p>
              {completedTxHash && (
                <a
                  href={getExplorerUrl(completedTxHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-brand-400 hover:text-brand-300 mt-3"
                >
                  View transaction ↗
                </a>
              )}
              <p className="text-xs text-zinc-500 mt-3">Redirecting to your deal page...</p>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
