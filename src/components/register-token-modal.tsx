"use client";

import { useCallback, useEffect, useReducer } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useMultiWallet } from "@/components/multiwallet";
import { useWriteContract, usePublicClient, useChainId } from "wagmi";
import { parseEther } from "viem";
import Image from "next/image";
import type {
  Wallet as AnchorWallet,
  Idl as AnchorIdl,
} from "@coral-xyz/anchor";
import { Dialog, DialogTitle, DialogBody } from "@/components/dialog";
import { Button } from "@/components/button";
import {
  scanWalletTokens,
  type ScannedToken,
} from "@/utils/wallet-token-scanner";
import {
  findBestPool,
  validatePoolLiquidity,
  formatPoolInfo,
  type PoolInfo,
} from "@/utils/pool-finder-base";
import {
  findBestSolanaPool,
  type SolanaPoolInfo,
} from "@/utils/pool-finder-solana";
import {
  findSolanaOracle,
  validateSolanaOracle,
  formatOracleInfo,
  getSolanaRegistrationCost,
  type SolanaOracleInfo,
} from "@/utils/oracle-finder-solana";
import { checkPriceDivergence } from "@/utils/price-validator";
import type { Chain } from "@/config/chains";
import { useConnection } from "@solana/wallet-adapter-react";

interface RegisterTokenModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  defaultChain?: Chain;
}

type Step =
  | "scan"
  | "select"
  | "oracle"
  | "confirm"
  | "register"
  | "syncing"
  | "success";

// --- Consolidated Wizard State ---
interface WizardState {
  step: Step;
  selectedChain: Chain;
  tokens: ScannedToken[];
  selectedToken: ScannedToken | null;
  poolInfo: PoolInfo | null;
  solanaPoolInfo: SolanaPoolInfo | null;
  oracleInfo: SolanaOracleInfo | null;
  loading: boolean;
  error: string | null;
  warning: string | null;
  txHash: string | null;
  syncStatus: string;
}

type WizardAction =
  | { type: "SET_STEP"; payload: Step }
  | { type: "SET_CHAIN"; payload: Chain }
  | { type: "SET_TOKENS"; payload: ScannedToken[] }
  | { type: "SELECT_TOKEN"; payload: ScannedToken | null }
  | { type: "SET_POOL_INFO"; payload: PoolInfo | null }
  | { type: "SET_SOLANA_POOL_INFO"; payload: SolanaPoolInfo | null }
  | { type: "SET_ORACLE_INFO"; payload: SolanaOracleInfo | null }
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "SET_ERROR"; payload: string | null }
  | { type: "SET_WARNING"; payload: string | null }
  | { type: "SET_TX_HASH"; payload: string | null }
  | { type: "SET_SYNC_STATUS"; payload: string }
  | { type: "RESET" }
  | { type: "START_ORACLE_SEARCH"; payload: ScannedToken }
  | {
      type: "ORACLE_FOUND";
      payload: {
        poolInfo?: PoolInfo;
        solanaPoolInfo?: SolanaPoolInfo;
        oracleInfo?: SolanaOracleInfo;
        warning?: string | null;
      };
    }
  | { type: "START_REGISTRATION" }
  | { type: "REGISTRATION_SUCCESS"; payload: string };

function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "SET_STEP":
      return { ...state, step: action.payload };
    case "SET_CHAIN":
      return { ...state, selectedChain: action.payload };
    case "SET_TOKENS":
      return { ...state, tokens: action.payload };
    case "SELECT_TOKEN":
      return { ...state, selectedToken: action.payload };
    case "SET_POOL_INFO":
      return { ...state, poolInfo: action.payload };
    case "SET_SOLANA_POOL_INFO":
      return { ...state, solanaPoolInfo: action.payload };
    case "SET_ORACLE_INFO":
      return { ...state, oracleInfo: action.payload };
    case "SET_LOADING":
      return { ...state, loading: action.payload };
    case "SET_ERROR":
      return { ...state, error: action.payload };
    case "SET_WARNING":
      return { ...state, warning: action.payload };
    case "SET_TX_HASH":
      return { ...state, txHash: action.payload };
    case "SET_SYNC_STATUS":
      return { ...state, syncStatus: action.payload };
    case "RESET":
      return {
        ...state,
        step: "scan",
        tokens: [],
        selectedToken: null,
        poolInfo: null,
        solanaPoolInfo: null,
        oracleInfo: null,
        error: null,
        warning: null,
        txHash: null,
        syncStatus: "",
      };
    case "START_ORACLE_SEARCH":
      return {
        ...state,
        selectedToken: action.payload,
        loading: true,
        error: null,
        warning: null,
        step: "oracle",
      };
    case "ORACLE_FOUND":
      return {
        ...state,
        poolInfo: action.payload.poolInfo ?? null,
        solanaPoolInfo: action.payload.solanaPoolInfo ?? null,
        oracleInfo: action.payload.oracleInfo ?? null,
        warning: action.payload.warning ?? null,
        loading: false,
        step: "confirm",
      };
    case "START_REGISTRATION":
      return {
        ...state,
        loading: true,
        error: null,
        step: "register",
        txHash: null,
        syncStatus: "",
      };
    case "REGISTRATION_SUCCESS":
      return {
        ...state,
        txHash: action.payload,
        step: "success",
        loading: false,
      };
    default:
      return state;
  }
}

const initialWizardState: WizardState = {
  step: "scan",
  selectedChain: "base",
  tokens: [],
  selectedToken: null,
  poolInfo: null,
  solanaPoolInfo: null,
  oracleInfo: null,
  loading: false,
  error: null,
  warning: null,
  txHash: null,
  syncStatus: "",
};

export function RegisterTokenModal({
  open,
  onOpenChange,
  onSuccess,
  defaultChain = "base",
}: RegisterTokenModalProps) {
  const { user, authenticated } = usePrivy();
  const {
    solanaWallet,
    solanaPublicKey,
    evmAddress: multiWalletEvmAddress,
    activeFamily,
  } = useMultiWallet();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const chainId = useChainId();
  const { connection } = useConnection();

  // Determine initial chain based on active wallet family
  const initialChain: Chain =
    defaultChain === "solana" || activeFamily === "solana"
      ? "solana"
      : defaultChain;

  // --- Consolidated State ---
  const [state, dispatch] = useReducer(wizardReducer, {
    ...initialWizardState,
    selectedChain: initialChain,
  });
  const {
    step,
    selectedChain,
    tokens,
    selectedToken,
    poolInfo,
    solanaPoolInfo,
    oracleInfo,
    loading,
    error,
    warning,
    txHash,
    syncStatus,
  } = state;

  // Get wallet addresses - prefer multiWallet values which are more reliable
  const evmAddress = multiWalletEvmAddress || user?.wallet?.address;
  const solanaAccount = user?.linkedAccounts?.find(
    (acc: { type: string }) =>
      acc.type === "wallet" &&
      (acc as { chainType?: string }).chainType === "solana",
  );
  const solanaAddress =
    solanaPublicKey ||
    (solanaAccount && "address" in solanaAccount
      ? (solanaAccount as { address: string }).address
      : undefined);

  // Debug logging
  console.log("[RegisterTokenModal] Wallet addresses:", {
    evmAddress,
    solanaAddress,
    activeFamily,
    selectedChain,
  });

  // Reset state when modal opens/closes
  useEffect(() => {
    if (open) {
      dispatch({ type: "RESET" });
    }
  }, [open]);

  // Scan wallet for tokens
  const handleScan = useCallback(async () => {
    console.log("[RegisterTokenModal] Starting scan for chain:", selectedChain);
    dispatch({ type: "SET_LOADING", payload: true });
    dispatch({ type: "SET_ERROR", payload: null });

    try {
      const address = selectedChain === "solana" ? solanaAddress : evmAddress;
      console.log("[RegisterTokenModal] Using address:", address);

      if (!address) {
        throw new Error(`No ${selectedChain} wallet connected`);
      }

      console.log(
        `[RegisterTokenModal] Scanning ${selectedChain} wallet:`,
        address,
      );
      const scannedTokens = await scanWalletTokens(address, selectedChain);
      console.log("[RegisterTokenModal] Found tokens:", scannedTokens.length);

      if (scannedTokens.length === 0) {
        dispatch({
          type: "SET_ERROR",
          payload:
            "No tokens found in your wallet. Try adding a token manually below.",
        });
        dispatch({ type: "SET_STEP", payload: "select" });
        return;
      }

      dispatch({ type: "SET_TOKENS", payload: scannedTokens });
      dispatch({ type: "SET_STEP", payload: "select" });
    } catch (err) {
      console.error("[RegisterTokenModal] Scan error:", err);
      dispatch({
        type: "SET_ERROR",
        payload: err instanceof Error ? err.message : "Failed to scan wallet",
      });
    } finally {
      dispatch({ type: "SET_LOADING", payload: false });
    }
  }, [selectedChain, solanaAddress, evmAddress]);

  // Select token and find oracle
  const handleSelectToken = useCallback(
    async (token: ScannedToken) => {
      dispatch({ type: "START_ORACLE_SEARCH", payload: token });

      try {
        let foundPoolInfo: PoolInfo | undefined;
        let foundSolanaPoolInfo: SolanaPoolInfo | undefined;
        let foundOracleInfo: SolanaOracleInfo | undefined;
        let foundWarning: string | null = null;

        if (selectedChain === "base" || selectedChain === "bsc") {
          let targetChainId: number;
          if (selectedChain === "bsc") {
            targetChainId = chainId === 56 || chainId === 97 ? chainId : 56;
          } else {
            targetChainId =
              chainId === 8453 || chainId === 84532 ? chainId : 8453;
          }
          const pool = await findBestPool(token.address, targetChainId);

          if (!pool) {
            const dexName =
              selectedChain === "bsc"
                ? "PancakeSwap V3"
                : "Uniswap V3 or Aerodrome";
            throw new Error(`No ${dexName} pool found for this token`);
          }

          const validation = await validatePoolLiquidity(pool);
          if (!validation.valid) {
            throw new Error(validation.warning || "Pool validation failed");
          }

          foundPoolInfo = pool;

          const priceCheck = await checkPriceDivergence(
            token.address,
            selectedChain,
            pool.priceUsd || 0,
          );
          if (!priceCheck.valid && priceCheck.warning) {
            foundWarning = priceCheck.warning;
          }
        } else if (selectedChain === "solana") {
          const cluster = connection.rpcEndpoint.includes("devnet")
            ? "devnet"
            : "mainnet";

          const bestPool = await findBestSolanaPool(token.address, cluster);
          if (bestPool) {
            foundSolanaPoolInfo = bestPool;
            // Map pool protocol to oracle type for proper on-chain registration
            let oracleType: SolanaOracleInfo["type"];
            if (bestPool.protocol === "PumpSwap") {
              oracleType = "pumpswap";
            } else if (bestPool.protocol === "Raydium") {
              oracleType = "raydium";
            } else if (bestPool.protocol === "Orca") {
              oracleType = "orca";
            } else {
              oracleType = "jupiter"; // fallback
            }
            foundOracleInfo = {
              type: oracleType,
              address: bestPool.address,
              poolAddress: bestPool.address,
              liquidity: bestPool.tvlUsd,
              valid: true,
              warning: bestPool.tvlUsd < 10000 ? "Low Liquidity" : undefined,
            };

            const priceCheck = await checkPriceDivergence(
              token.address,
              "solana",
              bestPool.priceUsd || 0,
            );
            if (!priceCheck.valid && priceCheck.warning) {
              foundWarning = priceCheck.warning;
            }
          } else {
            const oracle = await findSolanaOracle(token.address);
            if (oracle) {
              const validation = await validateSolanaOracle(oracle);
              if (!validation.valid) throw new Error(validation.message);
              foundOracleInfo = oracle;
            } else {
              throw new Error("No liquid pool or oracle found for this token");
            }
          }
        }

        dispatch({
          type: "ORACLE_FOUND",
          payload: {
            poolInfo: foundPoolInfo,
            solanaPoolInfo: foundSolanaPoolInfo,
            oracleInfo: foundOracleInfo,
            warning: foundWarning,
          },
        });
      } catch (err) {
        dispatch({
          type: "SET_ERROR",
          payload: err instanceof Error ? err.message : "Failed to find oracle",
        });
        dispatch({ type: "SET_STEP", payload: "select" });
        dispatch({ type: "SET_LOADING", payload: false });
      }
    },
    [selectedChain, chainId, connection.rpcEndpoint],
  );

  // Register token
  const handleRegister = useCallback(async () => {
    if (!selectedToken) return;

    dispatch({ type: "START_REGISTRATION" });

    try {
      let hash: string;

      if (selectedChain === "base" || selectedChain === "bsc") {
        hash = await registerEvmToken();
      } else if (selectedChain === "solana") {
        hash = await registerSolanaToken();
      } else {
        throw new Error("Unsupported chain");
      }

      dispatch({ type: "SET_TX_HASH", payload: hash });

      dispatch({
        type: "SET_SYNC_STATUS",
        payload: "Waiting for transaction confirmation...",
      });
      if (
        (selectedChain === "base" || selectedChain === "bsc") &&
        publicClient &&
        hash
      ) {
        await publicClient.waitForTransactionReceipt({
          hash: hash as `0x${string}`,
        });
      } else if (selectedChain === "solana") {
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }

      if (selectedChain === "solana") {
        await registerSolanaTokenToDatabase();
      } else {
        await syncTokenToDatabase(hash);
      }

      dispatch({ type: "REGISTRATION_SUCCESS", payload: hash });
      onSuccess?.();
    } catch (err) {
      dispatch({
        type: "SET_ERROR",
        payload: err instanceof Error ? err.message : "Registration failed",
      });
      dispatch({ type: "SET_STEP", payload: "confirm" });
      dispatch({ type: "SET_LOADING", payload: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedToken, selectedChain, publicClient, onSuccess]);

  /**
   * Register Solana token directly to database after on-chain registration
   * This is needed because the sync endpoint doesn't fully parse Solana transactions
   */
  const registerSolanaTokenToDatabase = useCallback(async () => {
    if (!selectedToken) throw new Error("No token selected");

    dispatch({ type: "SET_STEP", payload: "syncing" });
    dispatch({
      type: "SET_SYNC_STATUS",
      payload: "Registering token to database...",
    });

    try {
      const response = await fetch("/api/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: selectedToken.symbol,
          name: selectedToken.name,
          contractAddress: selectedToken.address,
          chain: "solana",
          decimals: selectedToken.decimals,
          logoUrl: selectedToken.logoUrl,
          description: `Registered via OTC Desk`,
        }),
      });

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to register token to database");
      }

      dispatch({
        type: "SET_SYNC_STATUS",
        payload: "Token registered successfully!",
      });
    } catch (err) {
      console.error("Database registration error:", err);
      dispatch({
        type: "SET_SYNC_STATUS",
        payload: "Token registered on-chain (database sync pending)",
      });
    }
  }, [selectedToken]);

  /**
   * Sync token to database immediately after on-chain registration
   */
  const syncTokenToDatabase = useCallback(
    async (transactionHash: string) => {
      dispatch({ type: "SET_STEP", payload: "syncing" });
      dispatch({
        type: "SET_SYNC_STATUS",
        payload: "Syncing token to database...",
      });

      try {
        const syncResponse = await fetch("/api/tokens/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chain: selectedChain, transactionHash }),
        });

        const syncData = await syncResponse.json();
        if (!syncData.success) {
          throw new Error(syncData.error || "Sync failed");
        }

        dispatch({
          type: "SET_SYNC_STATUS",
          payload: "Waiting for token to appear in database...",
        });
        const maxAttempts = 15;
        let attempts = 0;

        while (attempts < maxAttempts) {
          const response = await fetch(
            `/api/tokens?chain=${selectedChain}&isActive=true`,
          );
          const data = await response.json();

          if (data.success && data.tokens && selectedToken) {
            const tokenFound = data.tokens.find(
              (t: { contractAddress: string }) => {
                if (selectedChain === "solana") {
                  return t.contractAddress === selectedToken.address;
                }
                return (
                  t.contractAddress.toLowerCase() ===
                  selectedToken.address.toLowerCase()
                );
              },
            );

            if (tokenFound) {
              dispatch({
                type: "SET_SYNC_STATUS",
                payload: "Token synced successfully!",
              });
              return;
            }
          }

          attempts++;
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }

        dispatch({
          type: "SET_SYNC_STATUS",
          payload: "Sync completed (token may already be registered)",
        });
      } catch (err) {
        console.error("Sync error:", err);
        dispatch({
          type: "SET_SYNC_STATUS",
          payload: "Sync in progress (will complete automatically)...",
        });
      }
    },
    [selectedChain, selectedToken],
  );

  // Register token on EVM chains (Base or BSC)
  const registerEvmToken = async (): Promise<string> => {
    if (!selectedToken || !poolInfo)
      throw new Error("Missing token or pool info");
    if (!evmAddress) throw new Error("No EVM wallet connected");
    if (!writeContractAsync) throw new Error("Wallet not connected");

    // Get the appropriate registration helper address for the selected chain
    const registrationHelperAddress =
      selectedChain === "bsc"
        ? process.env.NEXT_PUBLIC_BSC_REGISTRATION_HELPER_ADDRESS
        : process.env.NEXT_PUBLIC_REGISTRATION_HELPER_ADDRESS;

    if (!registrationHelperAddress) {
      throw new Error(
        `RegistrationHelper contract not configured for ${selectedChain}`,
      );
    }

    try {
      // Different fee for different chains (ETH for Base, BNB for BSC)
      const registrationFee =
        selectedChain === "bsc"
          ? parseEther("0.02") // 0.02 BNB (~$12)
          : parseEther("0.005"); // 0.005 ETH (~$15)

      const registrationAbi = [
        {
          name: "registerTokenWithPayment",
          type: "function",
          stateMutability: "payable",
          inputs: [
            { name: "tokenAddress", type: "address" },
            { name: "poolAddress", type: "address" },
          ],
          outputs: [{ name: "oracle", type: "address" }],
        },
      ] as const;

      // Type assertion needed as wagmi's writeContractAsync has complex generics
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hash = await (writeContractAsync as any)({
        address: registrationHelperAddress as `0x${string}`,
        abi: registrationAbi,
        functionName: "registerTokenWithPayment",
        args: [
          selectedToken.address as `0x${string}`,
          poolInfo.address as `0x${string}`,
        ],
        value: registrationFee,
      });

      console.log(
        `${selectedChain.toUpperCase()} token registration transaction sent:`,
        hash,
      );
      return hash;
    } catch (error) {
      console.error("Registration failed:", error);
      throw new Error(
        `Registration failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  };

  // Register token on Solana
  const registerSolanaToken = async () => {
    if (!selectedToken || !oracleInfo)
      throw new Error("Missing token or oracle info");
    if (!solanaAddress || !solanaWallet)
      throw new Error("No Solana wallet connected");

    try {
      // Import Solana dependencies
      const { Connection, PublicKey, SystemProgram } = await import(
        "@solana/web3.js"
      );
      const { AnchorProvider, Program } = await import("@coral-xyz/anchor");
      // Types are imported at module level

      // Get Solana program ID from environment
      const programId = process.env.NEXT_PUBLIC_SOLANA_PROGRAM_ID;
      if (!programId) {
        throw new Error("Solana program ID not configured");
      }

      // Get desk address from environment
      const deskAddress = process.env.NEXT_PUBLIC_SOLANA_DESK;
      if (!deskAddress) {
        throw new Error("Solana desk address not configured");
      }

      // Get RPC URL
      const rpcUrl =
        process.env.NEXT_PUBLIC_SOLANA_RPC ||
        "https://api.mainnet-beta.solana.com";
      const connection = new Connection(rpcUrl, "confirmed");

      // Create a proper wallet adapter for AnchorProvider
      // Type assertion needed as anchor's Wallet type has changed across versions
      const anchorWallet = {
        publicKey: new PublicKey(solanaAddress),
        signTransaction: solanaWallet.signTransaction,
        signAllTransactions: solanaWallet.signAllTransactions,
      } as AnchorWallet;

      // Create provider with the proper wallet adapter
      const provider = new AnchorProvider(connection, anchorWallet, {
        commitment: "confirmed",
      });

      // Load program IDL (in production, this would be loaded from the deployed program)
      // For now, we'll create a minimal interface based on the program structure
      // Type assertion needed as anchor IDL types vary between versions
      const minimalIdl = {
        version: "0.1.0",
        name: "otc",
        address: programId,
        instructions: [
          {
            name: "registerToken",
            accounts: [
              { name: "desk", writable: false, signer: false },
              { name: "payer", writable: true, signer: true },
              { name: "tokenMint", writable: false, signer: false },
              { name: "tokenRegistry", writable: true, signer: false },
              { name: "systemProgram", writable: false, signer: false },
            ],
            args: [
              { name: "priceFeedId", type: { array: ["u8", 32] } },
              { name: "poolAddress", type: "publicKey" },
              { name: "poolType", type: "u8" }, // 0=None, 1=Raydium, 2=Orca, 3=PumpSwap
            ],
          },
        ],
        accounts: [],
        types: [],
        events: [],
        errors: [],
        metadata: {
          address: programId,
        },
      } as unknown as AnchorIdl;
      const program = new Program(minimalIdl, provider);

      // Get price feed ID from oracle info
      let priceFeedId: number[] = new Array(32).fill(0);
      let poolAddressArg = new PublicKey("11111111111111111111111111111111"); // System program or null
      let poolType = 0; // 0=None, 1=Raydium, 2=Orca, 3=PumpSwap

      if (oracleInfo.type === "pyth" && oracleInfo.feedId) {
        // Convert Pyth feed ID to bytes
        const feedPubkey = new PublicKey(oracleInfo.feedId);
        priceFeedId = Array.from(feedPubkey.toBytes());
        poolType = 0; // No pool, using Pyth
      } else if (oracleInfo.type === "raydium" && oracleInfo.poolAddress) {
        // For Raydium, we pass the pool address
        poolAddressArg = new PublicKey(oracleInfo.poolAddress);
        poolType = 1; // Raydium
      } else if (oracleInfo.type === "orca" && oracleInfo.poolAddress) {
        // For Orca, we pass the pool address
        poolAddressArg = new PublicKey(oracleInfo.poolAddress);
        poolType = 2; // Orca
      } else if (oracleInfo.type === "pumpswap" && oracleInfo.poolAddress) {
        // For PumpSwap / Pump.fun bonding curve
        poolAddressArg = new PublicKey(oracleInfo.poolAddress);
        poolType = 3; // PumpSwap
      } else {
        // Fallback or error
        throw new Error(
          `Unsupported oracle type for registration: ${oracleInfo.type}`,
        );
      }

      // Create PDA for token registry
      const [tokenRegistryPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("token_registry"),
          new PublicKey(deskAddress).toBuffer(),
          new PublicKey(selectedToken.address).toBuffer(),
        ],
        new PublicKey(programId),
      );

      // Call the registerToken instruction with pool type
      const txHash = await program.methods
        .registerToken(priceFeedId, poolAddressArg, poolType)
        .accounts({
          desk: new PublicKey(deskAddress),
          payer: anchorWallet.publicKey,
          tokenMint: new PublicKey(selectedToken.address),
          tokenRegistry: tokenRegistryPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("Solana token registration successful:", {
        token: selectedToken.address,
        oracleType: oracleInfo.type,
        txHash,
      });

      return txHash;
    } catch (error) {
      console.error("Solana registration failed:", error);
      throw new Error(
        `Solana registration failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  };

  const getRegistrationCost = useCallback(() => {
    if (selectedChain === "base") {
      return "0.005 ETH (~$15)";
    } else if (selectedChain === "bsc") {
      return "0.02 BNB (~$12)";
    } else {
      const cost = getSolanaRegistrationCost();
      return `${cost.sol} SOL (~$${cost.usd})`;
    }
  }, [selectedChain]);

  // UI Helpers
  const setSelectedChain = useCallback((chain: Chain) => {
    dispatch({ type: "SET_CHAIN", payload: chain });
  }, []);

  const setStep = useCallback((newStep: Step) => {
    dispatch({ type: "SET_STEP", payload: newStep });
  }, []);

  return (
    <Dialog open={open} onClose={() => onOpenChange(false)} size="lg">
      <div className="rounded-2xl bg-white dark:bg-zinc-900 p-6 shadow-xl">
        <DialogTitle className="mb-4">Register New Token</DialogTitle>

        {/* Chain Selection */}
        {step === "scan" && (
          <DialogBody>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-2 block">
                  Select Chain
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => setSelectedChain("base")}
                    disabled={!evmAddress}
                    outline={selectedChain !== "base"}
                  >
                    Base {!evmAddress && "(Not Connected)"}
                  </Button>
                  <Button
                    onClick={() => setSelectedChain("bsc")}
                    disabled={!evmAddress}
                    outline={selectedChain !== "bsc"}
                  >
                    BSC {!evmAddress && "(Not Connected)"}
                  </Button>
                  <Button
                    onClick={() => setSelectedChain("solana")}
                    disabled={!solanaAddress}
                    outline={selectedChain !== "solana"}
                  >
                    Solana {!solanaAddress && "(Not Connected)"}
                  </Button>
                </div>
              </div>

              {error && (
                <div className="p-3 rounded bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-sm">
                  {error}
                </div>
              )}

              <Button
                onClick={handleScan}
                disabled={loading || !authenticated}
                className="w-full"
              >
                {loading ? "Scanning Wallet..." : "Scan My Wallet"}
              </Button>
            </div>
          </DialogBody>
        )}

        {/* Token Selection */}
        {step === "select" && (
          <DialogBody>
            <div className="space-y-4">
              {tokens.length > 0 ? (
                <>
                  <div className="text-sm font-medium mb-2">
                    Select a token to register:
                  </div>

                  <div className="space-y-2 max-h-[400px] overflow-y-auto">
                    {tokens
                      .filter((token) => !token.isRegistered)
                      .map((token) => (
                        <button
                          key={token.address}
                          onClick={() => handleSelectToken(token)}
                          disabled={loading}
                          className="w-full p-4 text-left border rounded-lg hover:border-orange-500 transition-colors disabled:opacity-50 dark:border-zinc-700"
                        >
                          <div className="flex justify-between items-start">
                            <div className="flex-1">
                              <div className="font-medium">{token.symbol}</div>
                              <div className="text-sm text-zinc-600 dark:text-zinc-400">
                                {token.name}
                              </div>
                              <div className="text-xs text-zinc-500 dark:text-zinc-500 mt-1">
                                Balance:{" "}
                                {(
                                  BigInt(token.balance) /
                                  BigInt(10 ** token.decimals)
                                ).toString()}
                              </div>
                              <div className="text-xs font-mono text-zinc-500 dark:text-zinc-500 mt-1">
                                {token.address.slice(0, 6)}...
                                {token.address.slice(-4)}
                              </div>
                            </div>
                            {token.logoUrl && (
                              <Image
                                src={token.logoUrl}
                                alt={token.symbol}
                                className="rounded-full ml-3"
                                width={48}
                                height={48}
                                unoptimized
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display =
                                    "none";
                                }}
                              />
                            )}
                          </div>
                        </button>
                      ))}
                  </div>

                  {tokens.filter((t) => t.isRegistered).length > 0 && (
                    <div className="pt-4 border-t dark:border-zinc-800">
                      <div className="text-sm text-zinc-600 dark:text-zinc-400 mb-2">
                        Already registered (
                        {tokens.filter((t) => t.isRegistered).length}):
                      </div>
                      <div className="space-y-1">
                        {tokens
                          .filter((token) => token.isRegistered)
                          .map((token) => (
                            <div
                              key={token.address}
                              className="p-2 text-sm bg-zinc-100 dark:bg-zinc-800 rounded flex items-center gap-2"
                            >
                              <span className="text-green-600 dark:text-green-400">
                                ✓
                              </span>
                              <span className="font-medium">
                                {token.symbol}
                              </span>
                              <span className="text-zinc-600 dark:text-zinc-400">
                                - {token.name}
                              </span>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-8 text-zinc-600 dark:text-zinc-400">
                  <p>No tokens found in your wallet</p>
                  <p className="text-sm mt-1">
                    You can still register a token manually below
                  </p>
                </div>
              )}

              <div className="pt-4 border-t dark:border-zinc-800 space-y-2">
                <div className="text-sm font-medium mb-2">
                  Or enter token address manually:
                </div>
                <input
                  type="text"
                  placeholder={`Paste ${selectedChain} token address...`}
                  className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-zinc-800 dark:border-zinc-700"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const address = (
                        e.target as HTMLInputElement
                      ).value.trim();
                      if (address) {
                        handleSelectToken({
                          address,
                          symbol: "UNKNOWN",
                          name: "Unknown Token",
                          balance: "0",
                          decimals: 18,
                          chain: selectedChain,
                          isRegistered: false,
                        });
                      }
                    }
                  }}
                />
                <p className="text-xs text-zinc-500 dark:text-zinc-500">
                  Press Enter after pasting the address
                </p>
              </div>

              <Button
                outline
                onClick={() => setStep("scan")}
                className="w-full"
              >
                Back
              </Button>
            </div>
          </DialogBody>
        )}

        {/* Oracle Discovery Loading */}
        {step === "oracle" && (
          <DialogBody>
            <div className="py-8 text-center space-y-4">
              <div className="animate-spin h-12 w-12 border-4 border-orange-500 border-t-transparent rounded-full mx-auto" />
              <div>
                <div className="font-medium">Finding Price Oracle...</div>
                <div className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
                  {selectedChain === "solana"
                    ? "Checking PumpSwap, Raydium, and other pools"
                    : selectedChain === "bsc"
                      ? "Searching PancakeSwap V3 pools"
                      : "Searching Uniswap V3 and Aerodrome pools"}
                </div>
              </div>
            </div>
          </DialogBody>
        )}

        {/* Confirmation */}
        {step === "confirm" && selectedToken && (
          <DialogBody>
            <div className="space-y-4">
              <div className="bg-zinc-100 dark:bg-zinc-800 p-4 rounded-lg space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm font-medium">Token:</span>
                  <span className="text-sm">{selectedToken.symbol}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm font-medium">Chain:</span>
                  <span className="text-sm capitalize">{selectedChain}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm font-medium">Oracle:</span>
                  <span className="text-sm">
                    {(selectedChain === "base" || selectedChain === "bsc") &&
                    poolInfo
                      ? formatPoolInfo(poolInfo)
                      : selectedChain === "solana" && solanaPoolInfo
                        ? `${solanaPoolInfo.protocol} Pool (${solanaPoolInfo.baseToken}) - TVL: $${Math.floor(solanaPoolInfo.tvlUsd).toLocaleString()}`
                        : oracleInfo
                          ? formatOracleInfo(oracleInfo)
                          : "N/A"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm font-medium">
                    Registration Cost:
                  </span>
                  <span className="text-sm font-mono">
                    {getRegistrationCost()}
                  </span>
                </div>
              </div>

              {warning && (
                <div className="p-3 rounded bg-yellow-500/10 border border-yellow-500/20 text-yellow-600 dark:text-yellow-400 text-sm">
                  ⚠️ {warning}
                </div>
              )}

              {error && (
                <div className="p-3 rounded bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-sm">
                  {error}
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  outline
                  onClick={() => setStep("select")}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleRegister}
                  disabled={loading}
                  className="flex-1"
                >
                  {loading ? "Registering..." : "Pay & Register"}
                </Button>
              </div>
            </div>
          </DialogBody>
        )}

        {/* Registration In Progress */}
        {step === "register" && (
          <DialogBody>
            <div className="py-8 text-center space-y-4">
              <div className="animate-spin h-12 w-12 border-4 border-orange-500 border-t-transparent rounded-full mx-auto" />
              <div>
                <div className="font-medium">Registering Token...</div>
                <div className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
                  Please confirm the transaction in your wallet
                </div>
              </div>
            </div>
          </DialogBody>
        )}

        {/* Syncing */}
        {step === "syncing" && (
          <DialogBody>
            <div className="text-center space-y-4 py-6">
              <div className="animate-spin text-orange-500 text-5xl">⟳</div>
              <div>
                <div className="font-medium text-lg">Syncing Token...</div>
                <div className="text-sm text-zinc-600 dark:text-zinc-400 mt-2">
                  {syncStatus || "Processing registration"}
                </div>
                {txHash && (
                  <div className="text-xs text-zinc-500 dark:text-zinc-500 mt-2 font-mono break-all">
                    TX: {txHash.slice(0, 10)}...{txHash.slice(-8)}
                  </div>
                )}
              </div>
              <div className="text-xs text-zinc-500 dark:text-zinc-500 mt-4">
                This usually takes a few seconds...
              </div>
            </div>
          </DialogBody>
        )}

        {/* Success */}
        {step === "success" && (
          <DialogBody>
            <div className="text-center space-y-4 py-6">
              <div className="text-green-500 text-5xl">✓</div>
              <div>
                <div className="font-medium text-lg">Token Registered!</div>
                <div className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
                  {selectedToken?.symbol} is now available for trading
                </div>
                {txHash && (
                  <div className="text-xs text-zinc-500 dark:text-zinc-500 mt-2 font-mono break-all">
                    TX: {txHash.slice(0, 10)}...{txHash.slice(-8)}
                  </div>
                )}
              </div>
              <Button onClick={() => onOpenChange(false)} className="w-full">
                Close
              </Button>
            </div>
          </DialogBody>
        )}
      </div>
    </Dialog>
  );
}
