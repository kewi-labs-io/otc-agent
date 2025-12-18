"use client";

import { Button } from "@/components/button";
import { Dialog } from "@/components/dialog";
import { useMultiWallet } from "@/components/multiwallet";
import { EVMLogo, SolanaLogo } from "@/components/icons/index";
import { usePrivy } from "@privy-io/react-auth";
import otcArtifact from "@/contracts/artifacts/contracts/OTC.sol/OTC.json";
import { useOTC } from "@/hooks/contracts/useOTC";
import type { OTCQuote } from "@/utils/xml-parser";
import type { Idl, Wallet } from "@coral-xyz/anchor";
import * as anchor from "@coral-xyz/anchor";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey as SolPubkey,
  SystemProgram as SolSystemProgram,
} from "@solana/web3.js";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useReducer } from "react";
import type { Abi } from "viem";
import { createPublicClient, http } from "viem";
import { base, baseSepolia } from "viem/chains";
import { useAccount, useBalance } from "wagmi";
import { useTransactionErrorHandler } from "@/hooks/useTransactionErrorHandler";
import { getCurrentNetwork } from "@/config/contracts";

interface AcceptQuoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialQuote?: Partial<OTCQuote> | null;
  onComplete?: (data: { offerId: bigint; txHash?: `0x${string}` }) => void;
}

type StepState =
  | "amount"
  | "sign"
  | "creating"
  | "await_approval"
  | "paying"
  | "complete";

const ONE_MILLION = 1_000_000;
const MIN_TOKENS = 100;

interface TokenMetadata {
  symbol: string;
  name: string;
  logoUrl: string;
  contractAddress: string;
}

const tokenMetadataCache = new Map<string, TokenMetadata>();

function tokenCacheKey(chain: string, symbol: string): string {
  return `${chain}:${symbol.toUpperCase()}`;
}

function loadCachedTokenMetadata(chain: string, symbol: string): TokenMetadata | null {
  const key = tokenCacheKey(chain, symbol);
  const cached = tokenMetadataCache.get(key);
  if (cached) return cached;
  
  try {
    const stored = sessionStorage.getItem(`token-meta:${key}`);
    if (stored) {
      const metadata = JSON.parse(stored) as TokenMetadata;
      tokenMetadataCache.set(key, metadata);
      return metadata;
    }
  } catch { /* sessionStorage unavailable */ }
  return null;
}

function setCachedTokenMetadata(chain: string, symbol: string, metadata: TokenMetadata): void {
  const key = tokenCacheKey(chain, symbol);
  tokenMetadataCache.set(key, metadata);
  try {
    sessionStorage.setItem(`token-meta:${key}`, JSON.stringify(metadata));
  } catch { /* sessionStorage unavailable */ }
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

interface ModalState {
  tokenAmount: number;
  currency: "ETH" | "USDC" | "SOL";
  step: StepState;
  isProcessing: boolean;
  error: string | null;
  requireApprover: boolean;
  contractValid: boolean;
  solanaTokenMint: string | null;
  tokenMetadata: TokenMetadata | null;
  completedTxHash: string | null;
  completedOfferId: string | null;
  contractConsignmentId: string | null;
  consignmentRemainingTokens: number | null;
}

type ModalAction =
  | { type: "SET_TOKEN_AMOUNT"; payload: number }
  | { type: "SET_CURRENCY"; payload: "ETH" | "USDC" | "SOL" }
  | { type: "SET_STEP"; payload: StepState }
  | { type: "SET_PROCESSING"; payload: boolean }
  | { type: "SET_ERROR"; payload: string | null }
  | { type: "SET_REQUIRE_APPROVER"; payload: boolean }
  | { type: "SET_CONTRACT_VALID"; payload: boolean }
  | { type: "SET_SOLANA_TOKEN_MINT"; payload: string | null }
  | { type: "SET_TOKEN_METADATA"; payload: TokenMetadata | null }
  | { type: "SET_CONTRACT_CONSIGNMENT_ID"; payload: string | null }
  | { type: "SET_CONSIGNMENT_REMAINING_TOKENS"; payload: number | null }
  | {
      type: "SET_COMPLETED";
      payload: { txHash: string | null; offerId: string };
    }
  | {
      type: "RESET";
      payload: { tokenAmount: number; currency: "ETH" | "USDC" | "SOL" };
    }
  | { type: "START_TRANSACTION" }
  | { type: "TRANSACTION_ERROR"; payload: string };

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
  const {
    activeFamily,
    isConnected: walletConnected,
    solanaWallet,
    solanaPublicKey,
    setActiveFamily,
    privyAuthenticated,
    connectWallet,
  } = useMultiWallet();

  // Validate chain compatibility
  const quoteChain = initialQuote?.tokenChain;
  const isChainMismatch = quoteChain
    ? (quoteChain === "solana" && activeFamily !== "solana") ||
      ((quoteChain === "base" ||
        quoteChain === "bsc" ||
        quoteChain === "ethereum") &&
        activeFamily !== "evm")
    : false;
  const router = useRouter();
  const {
    otcAddress,
    createOfferFromConsignment,
    defaultUnlockDelaySeconds,
    usdcAddress,
    maxTokenPerOrder,
  } = useOTC();

  const abi = useMemo(() => otcArtifact.abi as Abi, []);

  // Determine RPC URL based on network configuration
  const networkEnv = getCurrentNetwork();
  const isMainnet = networkEnv === "mainnet";
  const isLocal = networkEnv === "local";

  const rpcUrl = useMemo(() => {
    if (isLocal) {
      return process.env.NEXT_PUBLIC_RPC_URL || "http://127.0.0.1:8545";
    }
    // Use Base RPC proxy to keep Alchemy API key server-side
    if (process.env.NEXT_PUBLIC_BASE_RPC_URL) {
      return process.env.NEXT_PUBLIC_BASE_RPC_URL;
    }
    // Use our proxy route for Alchemy (same as wagmi client)
    if (typeof window !== "undefined") {
      return `${window.location.origin}/api/rpc/base`;
    }
    return "/api/rpc/base";
  }, [isLocal]);

  const isLocalRpc = useMemo(
    () => /localhost|127\.0\.0\.1/.test(rpcUrl),
    [rpcUrl],
  );

  const readChain = useMemo(() => {
    if (isLocalRpc) {
      return {
        id: 31337,
        name: "Localhost",
        network: "localhost",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [rpcUrl] } },
      };
    }
    // Use Base mainnet or Sepolia based on network
    return isMainnet ? base : baseSepolia;
  }, [isLocalRpc, rpcUrl, isMainnet]);

  const publicClient = useMemo(
    () => createPublicClient({ chain: readChain, transport: http(rpcUrl) }),
    [readChain, rpcUrl],
  );

  // --- Token Chain Detection (needed for initial state) ---
  // IMPORTANT: Use quoteChain (token's chain) for UI, not activeFamily (user's current wallet)
  // This ensures Solana tokens show SOL options even before user connects Solana wallet
  const isSolanaToken = quoteChain === "solana";
  const isEvmToken = quoteChain === "base" || quoteChain === "bsc" || quoteChain === "ethereum";

  // --- Consolidated State ---
  // Max available from quote (or fallback to 1M if not specified)
  const maxAvailableTokens = useMemo(() => {
    if (initialQuote?.tokenAmount) {
      const available = Number(initialQuote.tokenAmount);
      if (available > 0 && available < ONE_MILLION) {
        return Math.floor(available);
      }
    }
    return ONE_MILLION;
  }, [initialQuote?.tokenAmount]);

  const initialState: ModalState = {
    tokenAmount: Math.min(
      maxAvailableTokens,
      Math.max(
        MIN_TOKENS,
        initialQuote?.tokenAmount ? Math.min(Number(initialQuote.tokenAmount), 1000) : 1000,
      ),
    ),
    currency: isSolanaToken ? "SOL" : "ETH",
    step: "amount",
    isProcessing: false,
    error: null,
    requireApprover: false,
    contractValid: false,
    solanaTokenMint: null,
    tokenMetadata: null,
    completedTxHash: null,
    completedOfferId: null,
    contractConsignmentId: null,
    consignmentRemainingTokens: null,
  };

  const [state, dispatch] = useReducer(modalReducer, initialState);
  const {
    tokenAmount,
    currency,
    step,
    isProcessing,
    error,
    requireApprover,
    contractValid,
    solanaTokenMint,
    tokenMetadata,
    completedTxHash,
    contractConsignmentId,
    consignmentRemainingTokens,
  } = state;

  const { handleTransactionError } = useTransactionErrorHandler();
  const { login, ready: privyReady } = usePrivy();
  // Keep isSolanaActive for execution logic only (user's actual connected wallet)
  const isSolanaActive = activeFamily === "solana";
  const SOLANA_RPC =
    (process.env.NEXT_PUBLIC_SOLANA_RPC as string | undefined) ||
    "http://127.0.0.1:8899";
  const SOLANA_DESK = process.env.NEXT_PUBLIC_SOLANA_DESK as string | undefined;
  const SOLANA_USDC_MINT = process.env.NEXT_PUBLIC_SOLANA_USDC_MINT as
    | string
    | undefined;

  // Wallet balances for display and MAX calculation
  const ethBalance = useBalance({ address });
  const usdcBalance = useBalance({
    address,
    token: usdcAddress as `0x${string}` | undefined,
  });

  useEffect(() => {
    if (!isOpen) {
      dispatch({
        type: "RESET",
        payload: {
          tokenAmount: Math.min(
            maxAvailableTokens,
            Math.max(
              MIN_TOKENS,
              initialQuote?.tokenAmount
                ? Math.min(Number(initialQuote.tokenAmount), 1000)
                : 1000,
            ),
          ),
          currency: isSolanaToken ? "SOL" : "ETH",
        },
      });
    }
  }, [isOpen, initialQuote, isSolanaToken, maxAvailableTokens]);

  // Look up token metadata from cache first, then database
  useEffect(() => {
    if (!isOpen || !initialQuote?.tokenSymbol) return;

    const chain = initialQuote?.tokenChain || (isSolanaToken ? "solana" : "base");
    const symbol = initialQuote.tokenSymbol;

    const cached = loadCachedTokenMetadata(chain, symbol);
    if (cached) {
      console.log("[AcceptQuote] Using cached token metadata for", symbol);
      dispatch({ type: "SET_TOKEN_METADATA", payload: cached });
      if (chain === "solana") {
        dispatch({
          type: "SET_SOLANA_TOKEN_MINT",
          payload: cached.contractAddress,
        });
      }
      return;
    }

    // Fetch from API if not cached - use efficient by-symbol endpoint
    (async () => {
      try {
        const res = await fetch(
          `/api/tokens/by-symbol?symbol=${encodeURIComponent(symbol)}&chain=${chain}`,
        );
        const data = await res.json();
        if (data.success && data.token) {
          const token = data.token;
          const metadata: TokenMetadata = {
            symbol: token.symbol,
            name: token.name,
            logoUrl: token.logoUrl || "",
            contractAddress: token.contractAddress,
          };
          // Cache it (permanent - token metadata doesn't change)
          setCachedTokenMetadata(chain, symbol, metadata);
          dispatch({ type: "SET_TOKEN_METADATA", payload: metadata });
          if (chain === "solana") {
            dispatch({
              type: "SET_SOLANA_TOKEN_MINT",
              payload: token.contractAddress,
            });
          }
        }
      } catch (err) {
        console.error("[AcceptQuote] Failed to look up token:", err);
      }
    })();
  }, [
    isOpen,
    isSolanaToken,
    initialQuote?.tokenSymbol,
    initialQuote?.tokenChain,
  ]);

  // Fetch consignment data to get on-chain ID (EVM only)
  useEffect(() => {
    if (!isOpen || isSolanaToken) return;
    
    const consignmentDbId = (initialQuote as { consignmentId?: string })?.consignmentId;
    
    (async () => {
      try {
        if (consignmentDbId) {
          const res = await fetch(`/api/consignments/${consignmentDbId}`);
          if (!res.ok) {
            dispatch({ type: "SET_ERROR", payload: `Failed to fetch consignment: HTTP ${res.status}` });
            return;
          }
          const data = await res.json();
          if (data.success && data.consignment?.contractConsignmentId) {
            dispatch({ type: "SET_CONTRACT_CONSIGNMENT_ID", payload: data.consignment.contractConsignmentId });
            if (data.consignment.remainingAmount) {
              dispatch({ type: "SET_CONSIGNMENT_REMAINING_TOKENS", payload: Number(BigInt(data.consignment.remainingAmount) / 10n ** 18n) });
            }
          } else {
            dispatch({ type: "SET_ERROR", payload: "Consignment not deployed on-chain yet." });
          }
          return;
        }
        
        // Find consignment by token
        const { tokenSymbol, tokenChain } = initialQuote || {};
        if (!tokenSymbol || !tokenChain) {
          dispatch({ type: "SET_ERROR", payload: "Missing token information." });
          return;
        }

        // Look up token ID
        const tokenRes = await fetch(`/api/tokens/by-symbol?symbol=${encodeURIComponent(tokenSymbol)}&chain=${tokenChain}`);
        if (!tokenRes.ok) {
          dispatch({ type: "SET_ERROR", payload: `Token ${tokenSymbol} not found on ${tokenChain}` });
          return;
        }
        const tokenData = await tokenRes.json();
        if (!tokenData.success || !tokenData.token?.id) {
          dispatch({ type: "SET_ERROR", payload: `Token ${tokenSymbol} not registered.` });
          return;
        }
        const expectedTokenId = tokenData.token.id;

        // Fetch consignments
        const res = await fetch(`/api/consignments?chains=${tokenChain}`);
        if (!res.ok) {
          dispatch({ type: "SET_ERROR", payload: `Failed to fetch consignments: HTTP ${res.status}` });
          return;
        }
        const data = await res.json();
        if (!data.success || !data.consignments?.length) {
          dispatch({ type: "SET_ERROR", payload: `No consignments for ${tokenSymbol}` });
          return;
        }

        // Filter matching consignments
        interface ConsignmentData {
          id: string;
          tokenId: string;
          status: string;
          contractConsignmentId?: string;
          remainingAmount?: string;
        }
        
        const matching = data.consignments.filter((c: ConsignmentData) =>
          c.tokenId === expectedTokenId &&
          c.status === "active" &&
          c.contractConsignmentId &&
          BigInt(c.remainingAmount || "0") > 0n
        );

        if (matching.length === 0) {
          dispatch({ type: "SET_ERROR", payload: `No active consignments for ${tokenSymbol}` });
          return;
        }

        // Pick consignment with most tokens
        matching.sort((a: ConsignmentData, b: ConsignmentData) => {
          const diff = BigInt(b.remainingAmount || "0") - BigInt(a.remainingAmount || "0");
          return diff > 0n ? 1 : diff < 0n ? -1 : 0;
        });
        
        const best = matching[0] as ConsignmentData;
        dispatch({ type: "SET_CONTRACT_CONSIGNMENT_ID", payload: best.contractConsignmentId! });
        if (best.remainingAmount) {
          dispatch({ type: "SET_CONSIGNMENT_REMAINING_TOKENS", payload: Number(BigInt(best.remainingAmount) / 10n ** 18n) });
        }
      } catch (err) {
        dispatch({ type: "SET_ERROR", payload: err instanceof Error ? err.message : "Failed to load consignment" });
      }
    })();
  }, [isOpen, isSolanaToken, initialQuote]);

  // Keep currency coherent with token's chain when modal opens
  useEffect(() => {
    if (!isOpen) return;
    // Set currency based on token's chain, not user's wallet
    if (isSolanaToken && currency !== "SOL" && currency !== "USDC") {
      dispatch({ type: "SET_CURRENCY", payload: "SOL" });
    } else if (isEvmToken && currency === "SOL") {
      dispatch({ type: "SET_CURRENCY", payload: "ETH" });
    }
  }, [isOpen, isSolanaToken, isEvmToken, currency]);

  // Validate contract exists and read config (EVM only) - with caching
  useEffect(() => {
    (async () => {
      if (activeFamily === "solana") {
        dispatch({ type: "SET_CONTRACT_VALID", payload: true });
        dispatch({ type: "SET_REQUIRE_APPROVER", payload: false });
        return;
      }

      if (!isOpen || !otcAddress) {
        dispatch({ type: "SET_CONTRACT_VALID", payload: false });
        return;
      }

      const cacheKey = `${otcAddress}:${readChain.id}`;

      const cachedExists = getContractExists(cacheKey);
      if (cachedExists !== null) {
        dispatch({ type: "SET_CONTRACT_VALID", payload: cachedExists });
        if (!cachedExists) {
          dispatch({
            type: "SET_ERROR",
            payload:
              "Contract not found. Ensure Anvil node is running and contracts are deployed.",
          });
        }
        return;
      }

      const code = await publicClient.getBytecode({
        address: otcAddress as `0x${string}`,
      });

      const exists = Boolean(code && code !== "0x");
      setContractExists(cacheKey, exists);

      if (!exists) {
        console.error(
          `[AcceptQuote] No contract at ${otcAddress} on ${readChain.name}.`,
        );
        dispatch({ type: "SET_CONTRACT_VALID", payload: false });
        dispatch({
          type: "SET_ERROR",
          payload:
            "Contract not found. Ensure Anvil node is running and contracts are deployed.",
        });
        return;
      }

      dispatch({ type: "SET_CONTRACT_VALID", payload: true });

      // Read contract state (this changes rarely, but should still be fresh)
      const readContract = publicClient.readContract as (
        params: unknown,
      ) => Promise<unknown>;
      const flag = (await readContract({
        address: otcAddress as `0x${string}`,
        abi: abi as Abi,
        functionName: "requireApproverToFulfill",
        args: [],
      })) as boolean;
      dispatch({ type: "SET_REQUIRE_APPROVER", payload: flag });
    })();
  }, [isOpen, otcAddress, publicClient, abi, activeFamily, readChain]);

  const discountBps = useMemo(() => {
    const bps = initialQuote?.discountBps;
    return typeof bps === "number" && !Number.isNaN(bps) ? bps : 100;
  }, [initialQuote?.discountBps]);

  const lockupDays = useMemo(() => {
    if (typeof initialQuote?.lockupDays === "number")
      return initialQuote.lockupDays;
    if (typeof initialQuote?.lockupMonths === "number")
      return Math.max(1, initialQuote.lockupMonths * 30);
    return Number(
      defaultUnlockDelaySeconds ? defaultUnlockDelaySeconds / 86400n : 180n,
    );
  }, [
    initialQuote?.lockupDays,
    initialQuote?.lockupMonths,
    defaultUnlockDelaySeconds,
  ]);

  const contractMaxTokens = useMemo(() => {
    const v = maxTokenPerOrder
      ? Number(maxTokenPerOrder / 10n ** 18n)
      : ONE_MILLION;
    return Math.max(MIN_TOKENS, Math.min(ONE_MILLION, v));
  }, [maxTokenPerOrder]);

  const effectiveMaxTokens = useMemo(() => {
    if (consignmentRemainingTokens !== null && consignmentRemainingTokens > 0) {
      return Math.min(contractMaxTokens, consignmentRemainingTokens);
    }
    return Math.min(contractMaxTokens, maxAvailableTokens);
  }, [contractMaxTokens, maxAvailableTokens, consignmentRemainingTokens]);

  const clampAmount = useCallback(
    (value: number) =>
      Math.min(effectiveMaxTokens, Math.max(MIN_TOKENS, Math.floor(value))),
    [effectiveMaxTokens],
  );

  const setTokenAmount = useCallback(
    (value: number) => {
      dispatch({ type: "SET_TOKEN_AMOUNT", payload: clampAmount(value) });
    },
    [clampAmount],
  );

  const setCurrency = useCallback((value: "ETH" | "USDC" | "SOL") => {
    dispatch({ type: "SET_CURRENCY", payload: value });
  }, []);

  async function fetchSolanaIdl(): Promise<Idl> {
    const res = await fetch("/api/solana/idl");
    if (!res.ok) throw new Error("Failed to load Solana IDL");
    return (await res.json()) as Idl;
  }

  type OfferTuple = readonly [
    `0x${string}`, bigint, bigint, bigint, bigint, bigint, bigint, number,
    boolean, boolean, boolean, boolean, `0x${string}`, bigint,
  ];

  async function readContract<T>(fn: string, args: unknown[] = []): Promise<T> {
    if (!otcAddress) throw new Error("Missing OTC address");
    const read = publicClient.readContract as (p: unknown) => Promise<unknown>;
    return (await read({
      address: otcAddress as `0x${string}`,
      abi: abi as Abi,
      functionName: fn,
      args,
    })) as T;
  }

  const readNextOfferId = () => readContract<bigint>("nextOfferId");
  const readOffer = (id: bigint) => readContract<OfferTuple>("offers", [id]);
  const handleConfirm = useCallback(async () => {
    if (!walletConnected) return;

    // CRITICAL: Quote must exist
    if (!initialQuote?.quoteId) {
      dispatch({
        type: "SET_ERROR",
        payload:
          "No quote ID available. Please request a quote from the chat first.",
      });
      return;
    }

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

    try {
      console.log("[AcceptQuote] Starting executeTransaction...");
      await executeTransaction();
      console.log("[AcceptQuote] executeTransaction completed successfully");
    } catch (err) {
      console.error("[AcceptQuote] executeTransaction error:", err);
      const error = err instanceof Error ? err : new Error(String(err));
      const txError = {
        ...error,
        message: error.message,
        cause: error.cause as
          | { reason?: string; code?: string | number }
          | undefined,
        details: (error as { details?: string }).details,
        shortMessage: (error as { shortMessage?: string }).shortMessage,
      };
      const errorMessage = handleTransactionError(txError);
      dispatch({ type: "TRANSACTION_ERROR", payload: errorMessage });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    walletConnected,
    initialQuote?.quoteId,
    isSolanaToken,
    contractValid,
    handleTransactionError,
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
      if (!solanaTokenMint) {
        throw new Error(
          `Token ${initialQuote?.tokenSymbol || "unknown"} not found on Solana. Register it first.`,
        );
      }

      // Use Solana wallet from context
      if (!solanaWallet || !solanaWallet.publicKey) {
        throw new Error("Connect a Solana wallet to continue.");
      }

      const connection = new Connection(SOLANA_RPC, "confirmed");
      // Adapt our wallet adapter to Anchor's Wallet interface
      // Type assertion needed as anchor's Wallet type has changed across versions
      const anchorWallet = {
        publicKey: new SolPubkey(solanaWallet.publicKey!.toBase58()),
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
      const tokenMintPk = new SolPubkey(solanaTokenMint);
      const usdcMintPk = new SolPubkey(SOLANA_USDC_MINT);

      console.log("Token mint PK:", tokenMintPk.toString());
      console.log("USDC mint PK:", usdcMintPk.toString());
      console.log("Desk:", desk.toString());

      const deskTokenTreasury = await getAssociatedTokenAddress(
        tokenMintPk,
        desk,
        true,
      );
      const deskUsdcTreasury = await getAssociatedTokenAddress(
        usdcMintPk,
        desk,
        true,
      );

      console.log("Desk token treasury:", deskTokenTreasury.toString());
      console.log("Desk USDC treasury:", deskUsdcTreasury.toString());

      // Read nextOfferId from desk account
      // The program.account namespace is dynamically generated from IDL
      const deskAccount = await (
        program.account as {
          desk: {
            fetch: (address: SolPubkey) => Promise<{ nextOfferId: anchor.BN }>;
          };
        }
      ).desk.fetch(desk);
      const nextOfferId = new anchor.BN(deskAccount.nextOfferId.toString());

      console.log("Next offer ID:", nextOfferId.toString());

      // Generate offer keypair (IDL expects signer)
      const offerKeypair = Keypair.generate();
      console.log(
        "Generated offer keypair:",
        offerKeypair.publicKey.toString(),
      );

      // Create offer on Solana
      const tokenAmountWei = new anchor.BN(
        (BigInt(tokenAmount) * 10n ** 9n).toString(),
      );
      const lockupSeconds = new anchor.BN(lockupDays * 24 * 60 * 60);
      const paymentCurrencySol = currency === "USDC" ? 1 : 0; // 0 SOL, 1 USDC

      console.log("Token amount wei:", tokenAmountWei.toString());
      console.log("Lockup seconds:", lockupSeconds.toString());
      console.log("Payment currency:", paymentCurrencySol);

      // Derive token registry PDA for multi-token support
      const [tokenRegistryPda] = SolPubkey.findProgramAddressSync(
        [Buffer.from("registry"), desk.toBuffer(), tokenMintPk.toBuffer()],
        program.programId,
      );
      console.log("Token registry PDA:", tokenRegistryPda.toString());

      // Lazy price update: Ensure price is fresh before creating offer
      // This prevents StalePrice errors and ensures accurate pricing
      console.log("Refreshing token price before offer...");
      try {
        const priceRes = await fetch("/api/solana/update-price", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tokenMint: solanaTokenMint }),
        });
        const priceData = await priceRes.json();
        if (priceData.updated) {
          console.log(`✅ Price updated: $${priceData.oldPrice} → $${priceData.newPrice}`);
        } else {
          console.log(`✅ Price still fresh: $${priceData.price}`);
        }
      } catch (priceErr) {
        console.warn("Price refresh failed (continuing with cached price):", priceErr);
        // Don't block the transaction - price update is best-effort
      }

      await program.methods
        .createOffer(
          tokenAmountWei,
          discountBps,
          paymentCurrencySol,
          lockupSeconds,
        )
        .accountsStrict({
          desk,
          tokenRegistry: tokenRegistryPda,
          deskTokenTreasury,
          beneficiary: new SolPubkey(solanaWallet.publicKey.toBase58()),
          offer: offerKeypair.publicKey,
          systemProgram: SolSystemProgram.programId,
        })
        .signers([offerKeypair])
        .rpc();

      console.log("Offer created");

      dispatch({ type: "SET_STEP", payload: "await_approval" });

      // Request backend approval (same as EVM flow)
      console.log("Requesting approval from backend...");
      const approveRes = await fetch("/api/otc/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offerId: nextOfferId.toString(),
          chain: "solana",
          offerAddress: offerKeypair.publicKey.toString(),
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
        console.warn(
          "Claim scheduling failed, tokens will be claimable manually",
        );
      }

      // Save deal completion to database
      if (!initialQuote?.quoteId) {
        dispatch({
          type: "TRANSACTION_ERROR",
          payload:
            "No quote ID - you must get a quote from the chat before buying.",
        });
        return;
      }

      // Solana addresses are Base58 encoded and case-sensitive - preserve original case
      const solanaWalletAddress = solanaPublicKey || "";

      // CRITICAL: Capture tokenAmount NOW before any async operations
      const finalTokenAmount = tokenAmount;

      console.log("[Solana] Saving deal completion:", {
        quoteId: initialQuote.quoteId,
        wallet: solanaWalletAddress,
        offerId: nextOfferId.toString(),
        tokenAmount: finalTokenAmount,
        tokenAmountType: typeof finalTokenAmount,
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
        throw new Error(
          `Deal saved but status is ${saveResult.quote.status}, not executed`,
        );
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
      if (initialQuote?.quoteId) {
        setTimeout(() => {
          router.push(`/deal/${initialQuote.quoteId}`);
        }, 2000);
      }
      return;
    }

    // Validate beneficiary matches connected wallet (fast, no network)
    if (
      initialQuote?.beneficiary &&
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
      initialQuote?.quoteId
        ? fetch("/api/quote/latest", {
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
          })
        : Promise.resolve(),
    ]);
    const newOfferId = nextId;

    // Step 1: Create offer from consignment (User transaction - ONLY transaction user signs)
    console.log(`[AcceptQuote] Creating offer ${newOfferId}...`);
    
    // Validate we have a consignment ID
    if (!contractConsignmentId) {
      throw new Error(
        "No consignment available. This quote may not be linked to an active listing. Please request a new quote from the chat."
      );
    }
    
    const tokenAmountWei = BigInt(tokenAmount) * 10n ** 18n;
    const lockupSeconds = BigInt(lockupDays * 24 * 60 * 60);
    const paymentCurrency = currency === "ETH" ? 0 : 1;
    
    // Get agent commission from quote (0 for P2P, 25-150 for negotiated)
    const agentCommissionBps = (initialQuote as { agentCommissionBps?: number })?.agentCommissionBps || 0;

    console.log(`[AcceptQuote] Using consignment ID: ${contractConsignmentId}`);
    console.log(`[AcceptQuote] Agent commission: ${agentCommissionBps} bps`);
    
    const createTxHash = (await createOfferFromConsignment({
      consignmentId: BigInt(contractConsignmentId),
      tokenAmountWei,
      discountBps,
      paymentCurrency,
      lockupSeconds,
      agentCommissionBps,
    })) as `0x${string}`;

    console.log(
      `[AcceptQuote] ✅ Offer created: ${newOfferId}, tx: ${createTxHash}`,
    );

    // Don't wait for receipt - immediately trigger backend approval
    // Backend will verify on-chain state directly via Alchemy (faster than frontend polling)
    console.log("[AcceptQuote] Transaction hash:", createTxHash);
    console.log(
      "[AcceptQuote] View on explorer: https://basescan.org/tx/" + createTxHash,
    );

    // Step 2: Immediately trigger backend approval
    console.log("[AcceptQuote] Updating UI to await_approval step...");
    dispatch({ type: "SET_STEP", payload: "await_approval" });

    // Small delay for UI update
    await new Promise((resolve) => setTimeout(resolve, 100));

    console.log(
      `[AcceptQuote] Triggering backend approval for offer ${newOfferId}...`,
    );

    // Call backend with retry logic - backend verifies on-chain state (idempotent)
    let approveRes;
    let lastApproveError: unknown;
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
          }),
        });

        console.log(
          "[AcceptQuote] /api/otc/approve response status:",
          approveRes.status,
        );

        if (approveRes.ok) break;
        if (approveRes.status >= 400 && approveRes.status < 500) break; // Don't retry client errors

        lastApproveError = `HTTP ${approveRes.status}`;
      } catch (fetchError) {
        console.warn(
          `[AcceptQuote] Approve attempt ${attempt} failed:`,
          fetchError,
        );
        lastApproveError = fetchError;
      }

      if (attempt < maxApproveAttempts) {
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`[AcceptQuote] Retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    if (!approveRes) {
      throw new Error(
        `Network error calling approval API: ${lastApproveError}`,
      );
    }

    if (!approveRes.ok) {
      const errorText = await approveRes.text();
      console.error("[AcceptQuote] Approval API error:", errorText);
      throw new Error(`Approval failed: ${errorText}`);
    }

    const approveData = await approveRes.json();
    console.log(
      `[AcceptQuote] ✅ Offer approved:`,
      approveData.approvalTx || approveData.txHash,
    );

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
        console.log(
          "[AcceptQuote] Offer was already paid by another transaction",
        );
        // Continue to verification - this is actually fine
      } else {
        // Something went wrong - offer is approved but not paid
        console.error(
          "[AcceptQuote] Backend approval succeeded but auto-fulfill failed:",
          {
            approveData,
            requireApprover,
            offerId: newOfferId.toString(),
          },
        );

        throw new Error(
          `Backend approval succeeded but payment failed. Your offer (ID: ${newOfferId}) is approved but not paid. Please contact support with this offer ID.`,
        );
      }
    }

    const paymentTxHash = (approveData.fulfillTx ||
      approveData.approvalTx) as `0x${string}`;

    if (approveData.fulfillTx) {
      console.log(`[AcceptQuote] ✅ Backend auto-fulfilled:`, paymentTxHash);
    } else {
      console.log(
        `[AcceptQuote] ✅ Offer was already fulfilled, continuing...`,
      );
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

    // Notify backend of completion - MUST succeed before showing success
    if (!initialQuote?.quoteId) {
      throw new Error("Missing quote ID - cannot save deal completion");
    }

    console.log("[AcceptQuote] Saving deal completion:", {
      quoteId: initialQuote.quoteId,
      offerId: String(newOfferId),
      tokenAmount: String(tokenAmount),
      currency,
      txHash: paymentTxHash,
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
        transactionHash: paymentTxHash,
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
        txHash: paymentTxHash,
        offerId: newOfferId.toString(),
      },
    });

    onComplete?.({ offerId: newOfferId, txHash: paymentTxHash });

    // Auto-redirect after showing success briefly
    setTimeout(() => {
      router.push(`/deal/${initialQuote.quoteId}`);
    }, 2000);
  };

  const estPerTokenUsd = useMemo(() => {
    // Use quote's pricePerToken with discount applied for estimation
    // Actual cost will be determined by on-chain oracle at execution
    const basePrice = initialQuote?.pricePerToken || 0;
    if (basePrice <= 0) return 0;
    const discountBps = initialQuote?.discountBps || 0;
    const discountMultiplier = 1 - discountBps / 10000;
    return basePrice * discountMultiplier;
  }, [initialQuote?.pricePerToken, initialQuote?.discountBps]);

  const balanceDisplay = useMemo(() => {
    // For Solana tokens, we don't have wagmi balances - show dash
    if (isSolanaToken) {
      return "—"; // Solana balance fetching not implemented via wagmi
    }
    if (!isConnected) return "—";
    if (currency === "USDC") {
      const v = Number(usdcBalance.data?.formatted || 0);
      return `${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    }
    // ETH balance
    const eth = Number(ethBalance.data?.formatted || 0);
    return `${eth.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
  }, [
    isConnected,
    isSolanaToken,
    currency,
    usdcBalance.data?.formatted,
    ethBalance.data?.formatted,
  ]);

  const handleMaxClick = () => {
    // For Solana tokens or when we can't calculate affordability, use max available
    if (isSolanaToken) {
      setTokenAmount(effectiveMaxTokens);
      return;
    }
    
    let maxByFunds = effectiveMaxTokens; // Start with max available
    if (currency === "USDC") {
      const usdc = Number(usdcBalance.data?.formatted || 0);
      if (estPerTokenUsd > 0 && usdc > 0) {
        maxByFunds = Math.min(maxByFunds, Math.floor(usdc / estPerTokenUsd));
      }
    } else if (currency === "ETH") {
      const eth = Number(ethBalance.data?.formatted || 0);
      const ethUsd = initialQuote?.ethPrice || 0;
      if (ethUsd > 0 && estPerTokenUsd > 0 && eth > 0) {
        const usd = eth * ethUsd;
        maxByFunds = Math.min(maxByFunds, Math.floor(usd / estPerTokenUsd));
      }
      // If no ETH price, just use max available
    }
    // Ensure we stay above minimum
    if (maxByFunds < MIN_TOKENS) {
      maxByFunds = MIN_TOKENS;
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

  // When quote requires specific chain, show appropriate messaging
  const handleConnectForChain = (requiredChain: "solana" | "evm") => {
    console.log(`[AcceptQuote] Connecting for ${requiredChain}...`);
    if (requiredChain === "solana") {
      setActiveFamily("solana");
    } else {
      setActiveFamily("evm");
    }
    if (privyAuthenticated) {
      connectWallet();
    } else {
      login();
    }
  };

  const maxAffordableTokens = useMemo(() => {
    if (isSolanaToken || estPerTokenUsd <= 0) return maxAvailableTokens;
    
    let max = maxAvailableTokens;
    if (currency === "USDC") {
      const usdc = Number(usdcBalance.data?.formatted || 0);
      if (usdc > 0) max = Math.floor(usdc / estPerTokenUsd);
    } else if (currency === "ETH") {
      const eth = Number(ethBalance.data?.formatted || 0);
      const ethUsd = initialQuote?.ethPrice || 0;
      if (ethUsd > 0 && eth > 0) max = Math.floor((eth * ethUsd) / estPerTokenUsd);
    }
    return Math.min(max, maxAvailableTokens);
  }, [isSolanaToken, maxAvailableTokens, estPerTokenUsd, currency, usdcBalance.data?.formatted, ethBalance.data?.formatted, initialQuote?.ethPrice]);

  const validationError = useMemo(() => {
    if (tokenAmount < MIN_TOKENS) return `Minimum is ${MIN_TOKENS.toLocaleString()} tokens.`;
    if (tokenAmount > maxAvailableTokens) return `Exceeds supply (~${maxAvailableTokens.toLocaleString()} max).`;
    if (tokenAmount > contractMaxTokens) return `Exceeds maximum of ${contractMaxTokens.toLocaleString()}.`;
    if (!isSolanaToken && estPerTokenUsd > 0 && tokenAmount > maxAffordableTokens) {
      return `Exceeds what you can afford (~${maxAffordableTokens.toLocaleString()} max).`;
    }
    return null;
  }, [tokenAmount, maxAvailableTokens, contractMaxTokens, estPerTokenUsd, maxAffordableTokens, isSolanaToken]);

  const estimatedPayment = useMemo(() => {
    if (estPerTokenUsd <= 0) return { usdc: undefined, eth: undefined, usd: undefined };
    const totalUsd = tokenAmount * estPerTokenUsd;
    const usd = totalUsd.toFixed(2);
    if (currency === "USDC") return { usdc: usd, eth: undefined, usd };
    if (currency === "SOL") return { usdc: undefined, eth: undefined, usd };
    const ethUsd = initialQuote?.ethPrice || 0;
    return { usdc: undefined, eth: ethUsd > 0 ? (totalUsd / ethUsd).toFixed(6) : undefined, usd };
  }, [tokenAmount, estPerTokenUsd, currency, initialQuote?.ethPrice]);

  const insufficientFunds = useMemo(() => {
    if (isSolanaToken || estPerTokenUsd <= 0) return false;
    if (currency === "ETH" && !initialQuote?.ethPrice) return false;
    return tokenAmount > maxAffordableTokens;
  }, [isSolanaToken, estPerTokenUsd, tokenAmount, maxAffordableTokens, currency, initialQuote?.ethPrice]);

  return (
    <>
      <Dialog
        open={isOpen}
        onClose={onClose}
        size="3xl"
        data-testid="accept-quote-modal"
      >
        <div className="w-full max-w-[720px] mx-auto p-0 rounded-2xl bg-zinc-950 text-white ring-1 ring-white/10 max-h-[95dvh] overflow-y-auto">
          {/* Chain Mismatch Warning */}
          {isChainMismatch && (
            <div className="bg-yellow-500/10 border-b border-yellow-500/20 p-4">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-yellow-500/20 flex items-center justify-center">
                  <span className="text-yellow-500 text-sm">⚠</span>
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-yellow-500 mb-1">
                    Wrong Network
                  </h3>
                  <p className="text-xs text-zinc-300 mb-3">
                    This quote is for a{" "}
                    <span className="font-semibold">
                      {quoteChain === "solana" ? "Solana" : "EVM"}
                    </span>{" "}
                    token, but you&apos;re connected to{" "}
                    <span className="font-semibold">
                      {activeFamily === "solana" ? "Solana" : "EVM"}
                    </span>
                    . Please switch networks to continue.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      onClick={() =>
                        handleConnectForChain(
                          quoteChain === "solana" ? "solana" : "evm",
                        )
                      }
                      className={`!h-8 !px-3 !text-xs ${quoteChain === "solana" ? "bg-gradient-to-br from-solana-purple to-solana-green" : "bg-gradient-to-br from-blue-600 to-blue-800"} hover:brightness-110`}
                    >
                      <div className="flex items-center gap-2">
                        {quoteChain === "solana" ? (
                          <SolanaLogo className="w-4 h-4" />
                        ) : (
                          <EVMLogo className="w-4 h-4" />
                        )}
                        Connect {quoteChain === "solana" ? "Solana" : "EVM"}{" "}
                        Wallet
                      </div>
                    </Button>
                    <Button
                      onClick={onClose}
                      color="dark"
                      className="!h-8 !px-3 !text-xs"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Header */}
          <div className="flex items-center justify-between px-3 sm:px-5 pt-4 sm:pt-5">
            <div className="text-base sm:text-lg font-semibold tracking-wide">
              Your Quote
            </div>
            <div className="flex items-center gap-2 sm:gap-3 text-xs sm:text-sm">
              <button
                type="button"
                className={`px-2 py-1 rounded-md ${currency === "USDC" ? "bg-white text-black" : "text-zinc-300"}`}
                onClick={() => setCurrency("USDC")}
              >
                USDC
              </button>
              <span className="text-zinc-600">|</span>
              <button
                type="button"
                className={`px-2 py-1 rounded-md ${currency !== "USDC" ? "bg-white text-black" : "text-zinc-300"}`}
                onClick={() =>
                  // Use quoteChain (token's chain), not activeFamily (user's wallet)
                  setCurrency(isSolanaToken ? "SOL" : "ETH")
                }
              >
                {/* Show SOL for Solana tokens, ETH for EVM tokens */}
                {isSolanaToken ? "SOL" : "ETH"}
              </button>
            </div>
          </div>

          {/* Main amount card */}
          <div className="m-3 sm:m-5 rounded-xl bg-zinc-900 ring-1 ring-white/10">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between px-3 sm:px-5 pt-3 sm:pt-4 gap-2">
              <div className="text-xs sm:text-sm text-zinc-400">
                Amount to Buy
              </div>
              <div className="flex items-center gap-2 sm:gap-3 text-xs sm:text-sm text-zinc-400">
                <span className="whitespace-nowrap">
                  Balance: {balanceDisplay}
                </span>
                <button
                  type="button"
                  className="text-brand-400 hover:text-brand-300 font-medium"
                  onClick={handleMaxClick}
                >
                  MAX
                </button>
              </div>
            </div>
            <div className="px-3 sm:px-5 pb-2">
              <div className="flex items-center justify-between gap-2 sm:gap-3">
                <input
                  data-testid="token-amount-input"
                  type="number"
                  value={tokenAmount}
                  onChange={(e) =>
                    setTokenAmount(clampAmount(Number(e.target.value)))
                  }
                  min={MIN_TOKENS}
                  max={maxAvailableTokens}
                  className="w-full bg-transparent border-none outline-none text-3xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-white"
                />
                <div className="flex items-center gap-3 text-right flex-shrink-0">
                  {/* Token Logo */}
                  <div className="h-10 w-10 rounded-full bg-zinc-800 flex items-center justify-center overflow-hidden ring-1 ring-white/10">
                    {tokenMetadata?.logoUrl ? (
                      <img
                        src={tokenMetadata.logoUrl}
                        alt={tokenMetadata.symbol}
                        className="h-full w-full object-cover"
                        onError={(e) => {
                          // Fallback to symbol if image fails
                          e.currentTarget.style.display = "none";
                          e.currentTarget.parentElement!.innerHTML = `<span class="text-brand-400 text-sm font-bold">${tokenMetadata?.symbol?.slice(0, 2) || "₣"}</span>`;
                        }}
                      />
                    ) : (
                      <span className="text-brand-400 text-sm font-bold">
                        {initialQuote?.tokenSymbol?.slice(0, 2) || "₣"}
                      </span>
                    )}
                  </div>
                  {/* Token Name & Symbol */}
                  <div className="text-right min-w-0">
                    <div className="text-sm font-semibold truncate">
                      {tokenMetadata?.symbol ||
                        initialQuote?.tokenSymbol ||
                        "TOKEN"}
                    </div>
                    <div className="text-xs text-zinc-400 truncate max-w-[120px]">
                      {tokenMetadata?.name || "Token"}
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-2">
                <input
                  data-testid="token-amount-slider"
                  type="range"
                  min={MIN_TOKENS}
                  max={maxAvailableTokens}
                  value={tokenAmount}
                  onChange={(e) =>
                    setTokenAmount(clampAmount(Number(e.target.value)))
                  }
                  className="w-full accent-brand-500"
                />
              </div>
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
                  {new Date(
                    Date.now() + lockupDays * 24 * 60 * 60 * 1000,
                  ).toLocaleDateString(undefined, {
                    month: "2-digit",
                    day: "2-digit",
                    year: "2-digit",
                  })}
                </div>
              </div>
              <div>
                <div className="text-zinc-500 text-xs">Est. Payment</div>
                <div className="text-base sm:text-lg font-semibold">
                  {currency === "USDC" && estimatedPayment.usdc
                    ? `$${Number(estimatedPayment.usdc).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                    : currency === "ETH" && estimatedPayment.eth
                      ? `${estimatedPayment.eth} ETH`
                      : currency === "ETH" && estimatedPayment.usd
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
              Payment will be executed by the desk&apos;s whitelisted approver
              wallet on your behalf after approval.
            </div>
          )}

          {(error || validationError || insufficientFunds) && (
            <div className="px-3 sm:px-5 pt-2 text-xs text-red-400">
              {error ||
                validationError ||
                (insufficientFunds
                  ? `Insufficient ${currency} balance for this purchase.`
                  : null)}
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
                      <p className="text-zinc-300 text-sm sm:text-md mb-4">
                        Let&apos;s deal, anon.
                      </p>
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
                        Supports Farcaster, MetaMask, Phantom, Coinbase Wallet &
                        more
                      </p>
                    </div>
                  </div>
                </div>
                <div className="p-3 sm:p-4 text-xs text-zinc-400">
                  {quoteChain ? (
                    <>
                      This token is on{" "}
                      <span className="font-semibold">
                        {quoteChain === "solana"
                          ? "Solana"
                          : quoteChain.toUpperCase()}
                      </span>
                      . Connect a compatible wallet to buy.
                    </>
                  ) : (
                    <>
                      Connect a wallet to continue and complete your purchase.
                    </>
                  )}
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
              <Button
                onClick={onClose}
                color="dark"
                className="w-full sm:w-auto"
              >
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
                  isChainMismatch
                }
                title={
                  isChainMismatch
                    ? `Switch to ${quoteChain === "solana" ? "Solana" : "EVM"} first`
                    : undefined
                }
              >
                <div className="px-4 py-2">Buy Now</div>
              </Button>
            </div>
          ) : null}

          {/* Progress states */}
          {step === "creating" && (
            <div className="px-5 pb-6">
              <div className="text-center py-6">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-500 mx-auto mb-4"></div>
                <h3 className="font-semibold mb-2">Creating Offer</h3>
                <p className="text-sm text-zinc-400">
                  Confirm the transaction in your wallet to create your offer
                  on-chain.
                </p>
              </div>
            </div>
          )}

          {step === "await_approval" && (
            <div className="px-5 pb-6">
              <div className="text-center py-6">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-500 mx-auto mb-4"></div>
                <h3 className="font-semibold mb-2">Processing Deal</h3>
                <p className="text-sm text-zinc-400">
                  Our desk is reviewing and completing your purchase. Payment
                  will be processed automatically.
                </p>
                <p className="text-xs text-zinc-500 mt-2">
                  This usually takes a few seconds...
                </p>
              </div>
            </div>
          )}

          {step === "paying" && (
            <div className="px-5 pb-6">
              <div className="text-center py-6">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
                <h3 className="font-semibold mb-2">Completing Payment</h3>
                <p className="text-sm text-zinc-400">
                  Finalizing your purchase on-chain...
                </p>
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
                  Your purchase is complete. You&apos;ll receive your tokens at
                  maturity.
                </p>
                {completedTxHash && (
                  <a
                    href={`https://basescan.org/tx/${completedTxHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-brand-400 hover:text-brand-300 mt-3"
                  >
                    View transaction ↗
                  </a>
                )}
                <p className="text-xs text-zinc-500 mt-3">
                  Redirecting to your deal page...
                </p>
              </div>
            </div>
          )}
        </div>
      </Dialog>
    </>
  );
}
