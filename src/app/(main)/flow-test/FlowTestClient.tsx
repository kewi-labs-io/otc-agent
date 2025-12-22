"use client";

import * as anchor from "@coral-xyz/anchor";
import { usePrivy } from "@privy-io/react-auth";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import {
  Keypair,
  PublicKey as SolPubkey,
  SystemProgram as SolSystemProgram,
} from "@solana/web3.js";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Abi, Address } from "viem";
import { createPublicClient, http } from "viem";
import { base, baseSepolia, bsc, bscTestnet, mainnet, sepolia } from "viem/chains";
import { Button } from "@/components/button";
import { type Chain, SUPPORTED_CHAINS } from "@/config/chains";
import { getCurrentNetwork } from "@/config/contracts";
import { useChain, useWalletActions, useWalletConnection } from "@/contexts";
import { useOTC } from "@/hooks/contracts/useOTC";
import { safeReadContract } from "@/lib/viem-utils";
import type {
  AnchorWallet,
  ChainFamily,
  DeskAccount,
  PhantomProvider,
  PhantomWindow,
  PriceUpdateResponse,
  SolanaTransaction,
  Step,
  StepStatus,
  TestState,
  TokenRegistryAccount,
  WalletSigner,
} from "@/types";
import { getExplorerTxUrl } from "@/utils/format";

// Shared Solana OTC utilities
import {
  calculateRequiredTokenAmount,
  createDummyAnchorWallet,
  createSolanaConnection,
  deriveTokenRegistryPda,
  ensureTokenRegistered,
  ensureTreasuryExists,
  fetchSolanaIdl,
  getTokenProgramId,
  SOLANA_DESK,
  waitForSolanaTx,
} from "@/utils/solana-otc";

// Use ChainFamily from @/types instead of local alias

// Constants
const ELIZAOS_TOKEN_CONFIG = {
  evm: {
    base: {
      address: "0xea17Df5Cf6D172224892B5477A16ACb111182478", // elizaOS on Base mainnet
      symbol: "ELIZAOS",
      decimals: 9, // ELIZAOS uses 9 decimals, not 18
    },
  },
  solana: {
    mainnet: {
      address: "DuMbhu7mvQvqQHGcnikDgb4XegXJRyhUBfdU22uELiZA", // elizaOS on Solana mainnet
      symbol: "ELIZAOS",
      decimals: 9, // Confirmed from on-chain registry
    },
  },
};

const SOLANA_DISCOUNT_BPS = 1000; // 10%
const SOLANA_AGENT_COMMISSION_BPS = 25; // 0.25%
const SOLANA_PAYMENT_CURRENCY = 0; // 0 = SOL, 1 = USDC

// ERC20 ABI for token interactions
const erc20Abi = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const satisfies Abi;

// Alias for backward compatibility
const confirmTransactionPolling = waitForSolanaTx;

// Phantom provider accessor
function getPhantomProvider(): PhantomProvider | null {
  if (typeof window === "undefined") return null;
  const win = window as PhantomWindow;
  const provider = win.phantom?.solana || win.solana;
  if (provider?.isPhantom) {
    return provider;
  }
  return null;
}

function extractPriceUsd(data: PriceUpdateResponse): number | null {
  if (typeof data.newPrice === "number") return data.newPrice;
  if (typeof data.price === "number") return data.price;
  if (typeof data.oldPrice === "number") return data.oldPrice;
  return null;
}

// Create Anchor wallet from a signer (Phantom or Privy)
function createSignerAnchorWallet(publicKey: string, signer: WalletSigner): AnchorWallet {
  return {
    publicKey: new SolPubkey(publicKey),
    signTransaction: async <T extends anchor.web3.Transaction | anchor.web3.VersionedTransaction>(
      tx: T,
    ): Promise<T> => {
      // WalletSigner.signTransaction accepts SolanaTransaction which is compatible
      const signed = await signer.signTransaction(tx as SolanaTransaction);
      return signed as T;
    },
    signAllTransactions: async <
      T extends anchor.web3.Transaction | anchor.web3.VersionedTransaction,
    >(
      txs: T[],
    ): Promise<T[]> => {
      const signed = await signer.signAllTransactions(txs as SolanaTransaction[]);
      return signed as T[];
    },
  };
}

// Get viem chain config
function getViemChain(chain: Chain) {
  const network = getCurrentNetwork();
  const isMainnet = network === "mainnet";
  switch (chain) {
    case "ethereum":
      return isMainnet ? mainnet : sepolia;
    case "base":
      return isMainnet ? base : baseSepolia;
    case "bsc":
      return isMainnet ? bsc : bscTestnet;
    default:
      return base;
  }
}

export default function FlowTestClient() {
  const { activeFamily, setActiveFamily } = useChain();
  const { evmAddress, solanaPublicKey, solanaWallet, solanaCanSign, privyAuthenticated } =
    useWalletConnection();
  const { connectWallet, connectSolanaWallet } = useWalletActions();
  const { login } = usePrivy();
  const {
    approveToken,
    createConsignmentOnChain,
    getRequiredGasDeposit,
    createOfferFromConsignment,
    withdrawConsignment,
  } = useOTC();

  const [testState, setTestState] = useState<TestState>({
    chain: "evm" as ChainFamily,
    steps: [],
    logs: [],
  });

  const [phantomSigner, setPhantomSigner] = useState<WalletSigner | null>(null);
  const [phantomPublicKey, setPhantomPublicKey] = useState<string | null>(null);
  const [phantomCanSign, setPhantomCanSign] = useState(false);
  const [requiredSolanaTokens, setRequiredSolanaTokens] = useState<bigint | null>(null);
  const [solanaPriceUsd, setSolanaPriceUsd] = useState<number | null>(null);
  const [solanaMinUsd, setSolanaMinUsd] = useState<number | null>(null);
  const [solanaDepositAmount, setSolanaDepositAmount] = useState<bigint | null>(null);
  const [availableBalanceWei, setAvailableBalanceWei] = useState<bigint | null>(null);
  // Use ref to store balance for reliable access in callbacks (avoids stale closure issues)
  const availableBalanceRef = useRef<bigint | null>(null);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const stepResultsRef = useRef<Record<string, StepStatus>>({});

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Add log entry
  const addLog = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setTestState((prev) => ({
      ...prev,
      logs: [...prev.logs, `[${timestamp}] ${message}`],
    }));
    console.log(`[FlowTest] ${message}`);
  }, []);

  // Update step status
  const updateStep = useCallback((stepId: string, updates: Partial<Step>) => {
    // Update ref for immediate access in loops
    if (updates.status) {
      stepResultsRef.current[stepId] = updates.status;
    }
    setTestState((prev) => ({
      ...prev,
      steps: prev.steps.map((s) => (s.id === stepId ? { ...s, ...updates } : s)),
    }));
  }, []);

  const getActiveSolanaContext = useCallback(() => {
    const walletSigner =
      solanaWallet && solanaPublicKey
        ? {
            publicKey: solanaPublicKey,
            signTransaction: solanaWallet.signTransaction,
            signAllTransactions: solanaWallet.signAllTransactions,
          }
        : phantomSigner;

    let publicKey: string | null = null;
    if (solanaPublicKey) {
      publicKey = solanaPublicKey;
    } else if (phantomPublicKey) {
      publicKey = phantomPublicKey;
    } else if (walletSigner?.publicKey) {
      publicKey = walletSigner.publicKey;
    }

    // Return null values instead of throwing - caller should check
    return {
      signer: walletSigner,
      publicKey,
    };
  }, [phantomPublicKey, phantomSigner, solanaPublicKey, solanaWallet]);

  const fetchSolanaRequirements = useCallback(async () => {
    const tokenConfig = ELIZAOS_TOKEN_CONFIG.solana.mainnet;
    if (!SOLANA_DESK) {
      throw new Error("SOLANA_DESK not configured in SUPPORTED_CHAINS.solana.contracts.otc");
    }

    const connection = createSolanaConnection();

    // Ensure price is up to date
    const priceRes = await fetch("/api/solana/update-price", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tokenMint: tokenConfig.address,
        forceUpdate: true,
      }),
    });

    const priceJson: PriceUpdateResponse = (await priceRes.json()) as PriceUpdateResponse;
    const apiPriceUsd = extractPriceUsd(priceJson);

    const idl = await fetchSolanaIdl();
    const dummyWallet = createDummyAnchorWallet();
    const provider = new anchor.AnchorProvider(connection, dummyWallet, {
      commitment: "confirmed",
    });
    const program = new anchor.Program(idl, provider);

    const deskPk = new SolPubkey(SOLANA_DESK);
    const tokenMintPk = new SolPubkey(tokenConfig.address);
    const tokenRegistryPda = deriveTokenRegistryPda(deskPk, tokenMintPk, program.programId);

    interface ProgramAccounts {
      desk: {
        // DeskAccount already has nextOfferId as optional, no need to intersect
        fetch: (addr: SolPubkey) => Promise<DeskAccount>;
      };
      tokenRegistry: {
        fetch: (addr: SolPubkey) => Promise<TokenRegistryAccount>;
      };
    }

    const accounts = program.account as ProgramAccounts;
    const deskAccount = await accounts.desk.fetch(deskPk);

    const registryInfo = await connection.getAccountInfo(tokenRegistryPda);
    if (!registryInfo) {
      throw new Error("Token registry not found");
    }
    const registryAccount = await accounts.tokenRegistry.fetch(tokenRegistryPda);

    if (deskAccount.minUsdAmount8D === undefined) {
      throw new Error("Desk minUsdAmount8D is not set");
    }
    const minUsdAmount8d = BigInt(
      typeof deskAccount.minUsdAmount8D === "bigint"
        ? deskAccount.minUsdAmount8D.toString()
        : deskAccount.minUsdAmount8D.toString(),
    );

    if (registryAccount.tokenUsdPrice8D === undefined) {
      throw new Error("Token price is not set in registry");
    }
    let price8d = BigInt(
      typeof registryAccount.tokenUsdPrice8D === "bigint"
        ? registryAccount.tokenUsdPrice8D.toString()
        : registryAccount.tokenUsdPrice8D.toString(),
    );

    if (price8d === 0n) {
      if (!apiPriceUsd) {
        throw new Error(
          "Token price is zero and API price not available - update price before continuing",
        );
      }
      if (apiPriceUsd <= 0) {
        throw new Error(
          "Token price is zero and API price is invalid - update price before continuing",
        );
      }
      price8d = BigInt(Math.round(apiPriceUsd * 1e8));
    }

    if (price8d === 0n) {
      throw new Error("Token price is zero - update price before continuing");
    }

    if (minUsdAmount8d === 0n) {
      throw new Error("Desk minUsdAmount8d is zero - must be configured");
    }
    const minUsdForCalc = minUsdAmount8d;

    const requiredTokensRaw = calculateRequiredTokenAmount(
      minUsdForCalc,
      price8d,
      tokenConfig.decimals,
      SOLANA_DISCOUNT_BPS,
    );
    // Add one smallest unit as buffer to avoid rounding under MinUsd floor
    const requiredTokens = requiredTokensRaw + 1n;

    const priceUsd = Number(price8d) / 1e8;
    const minUsd = Number(minUsdForCalc) / 1e8;

    return {
      requiredTokens,
      priceUsd,
      minUsd,
    };
  }, []);

  // Initialize steps for a chain
  const initializeSteps = useCallback((chain: ChainFamily): Step[] => {
    return [
      {
        id: "login",
        name: `1. Login with ${chain.toUpperCase()} wallet`,
        status: "pending",
      },
      {
        id: "check-balance",
        name: "2. Check token balance",
        status: "pending",
      },
      { id: "approve", name: "3. Approve tokens", status: "pending" },
      {
        id: "deposit",
        name: "4. Deposit 100 tokens (Create Consignment)",
        status: "pending",
      },
      { id: "buy", name: "5. Buy 50 tokens at discount", status: "pending" },
      {
        id: "withdraw",
        name: "6. Withdraw remaining tokens",
        status: "pending",
      },
    ];
  }, []);

  // Start test for a specific chain
  const startTest = useCallback(
    async (chain: ChainFamily) => {
      // Reset step results tracking
      stepResultsRef.current = {};
      setWalletConfirmed(false);
      setPhantomSigner(null);
      setPhantomPublicKey(null);
      setPhantomCanSign(false);
      setRequiredSolanaTokens(null);
      setSolanaPriceUsd(null);
      setSolanaMinUsd(null);
      setSolanaDepositAmount(null);
      setAvailableBalanceWei(null);
      availableBalanceRef.current = null;

      setTestState({
        chain,
        steps: initializeSteps(chain),
        logs: [],
      });
      addLog(`Starting ${chain.toUpperCase()} flow test...`);

      // Set active family
      setActiveFamily(chain === "solana" ? "solana" : "evm");
    },
    [initializeSteps, addLog, setActiveFamily],
  );

  // Track if user has confirmed their wallet choice (state setter used in callbacks)
  const [, setWalletConfirmed] = useState(false);

  // Execute step 1: Login - verifies wallet is connected AND can sign
  const executeLogin = useCallback(async () => {
    updateStep("login", { status: "running" });

    const targetFamily = testState.chain === "solana" ? "solana" : "evm";
    const address = testState.chain === "solana" ? solanaPublicKey : evmAddress;

    addLog(`Checking ${targetFamily} wallet connection...`);
    addLog(`  privyAuthenticated: ${privyAuthenticated}`);
    addLog(`  activeFamily: ${activeFamily}`);
    addLog(`  address: ${address || "none"}`);
    if (testState.chain === "solana") {
      addLog(`  solanaCanSign: ${solanaCanSign}`);
      addLog(`  solanaWallet: ${solanaWallet ? "exists" : "null"}`);
      const phantomProvider = getPhantomProvider();
      if (phantomProvider?.isPhantom) {
        const phantomPubkey = phantomProvider.publicKey?.toBase58();
        addLog(
          `  Phantom: installed, connected=${phantomProvider.isConnected}, pubkey=${phantomPubkey || "none"}`,
        );
      } else {
        addLog(`  Phantom: not detected`);
      }
    }

    // Ensure correct family is active
    if (activeFamily !== targetFamily) {
      addLog(`Switching active family to ${targetFamily}...`);
      setActiveFamily(targetFamily);
    }

    // For Solana, we need BOTH address AND signTransaction capability
    if (testState.chain === "solana") {
      const { signer: activeSigner, publicKey: activePublicKey } = getActiveSolanaContext();

      // Check if wallet is ready for signing
      if (activeSigner && activePublicKey) {
        // Wallet is ready - proceed
        addLog(
          `Solana wallet ready: ${activePublicKey.slice(0, 8)}...${activePublicKey.slice(-6)}`,
        );
        updateStep("login", {
          status: "success",
          details: `${activePublicKey} (can sign)`,
        });
        setWalletConfirmed(true);
        return;
      }

      // Have address (linked) but no signer - try to connect Phantom directly
      const phantom = getPhantomProvider();
      if (phantom?.isPhantom) {
        addLog("Phantom detected - attempting direct connection...");
        // TypeScript narrowing: phantom is non-null at this point
        const phantomProvider = phantom;
        const resp = await phantomProvider.connect();
        // FAIL-FAST: Phantom must return public key
        if (!resp.publicKey) {
          throw new Error("Phantom connect() returned no public key");
        }
        const phantomAddress = resp.publicKey.toBase58();
        addLog(`Phantom connected: ${phantomAddress}`);

        setPhantomPublicKey(phantomAddress);
        setPhantomCanSign(true);
        // FAIL-FAST: Phantom must have signTransaction methods
        if (!phantomProvider.signTransaction || !phantomProvider.signAllTransactions) {
          throw new Error("Phantom provider missing signTransaction methods");
        }
        setPhantomSigner({
          publicKey: phantomAddress,
          signTransaction: phantomProvider.signTransaction.bind(phantomProvider),
          signAllTransactions: phantomProvider.signAllTransactions.bind(phantomProvider),
        });

        if (address && phantomAddress !== address) {
          addLog(
            `Warning: Phantom address (${phantomAddress}) differs from linked address (${address})`,
          );
        }

        updateStep("login", {
          status: "success",
          details: `${phantomAddress} (Phantom signer connected)`,
        });
        setWalletConfirmed(true);
        return;
      } else {
        addLog("Phantom not detected. Opening Privy wallet dialog...");
        connectSolanaWallet();
      }

      updateStep("login", {
        status: "pending",
        details: "Wallet connection attempted. Click Execute again to verify.",
      });
      return;
    } else {
      // EVM - check if we have an address
      if (address) {
        addLog(`EVM wallet found: ${address}`);
        addLog("Opening wallet selector so you can confirm or change wallet...");
        connectWallet();
        updateStep("login", {
          status: "success",
          details: `${address} - Click "Change Wallet" below to use a different one`,
        });
        setWalletConfirmed(true);
        return;
      }
    }

    // Not authenticated - need to login
    if (!privyAuthenticated) {
      addLog("Not authenticated. Opening Privy login...");
      login();
      updateStep("login", {
        status: "pending",
        details: "Complete login in Privy modal, then click Execute again",
      });
      return;
    }

    // Authenticated but no address yet - open wallet connector
    addLog("Opening wallet connection dialog...");
    connectWallet();
    updateStep("login", {
      status: "pending",
      details: `Connect your ${targetFamily.toUpperCase()} wallet in the dialog, then click Execute again.`,
    });
  }, [
    testState.chain,
    activeFamily,
    evmAddress,
    solanaPublicKey,
    solanaCanSign,
    solanaWallet,
    getActiveSolanaContext,
    privyAuthenticated,
    login,
    connectWallet,
    connectSolanaWallet,
    setActiveFamily,
    addLog,
    updateStep,
  ]);

  // Allow user to change wallet
  const changeWallet = useCallback(() => {
    setWalletConfirmed(false);
    // Reset login step status so user can re-execute
    updateStep("login", {
      status: "pending",
      details: "Change wallet and click Execute",
      error: undefined,
    });
    connectWallet();
    addLog("Opening wallet selector to change wallet...");
    addLog(`Current evmAddress from context: ${evmAddress || "none"}`);
  }, [connectWallet, addLog, evmAddress, updateStep]);

  // Execute step 2: Check balance
  const executeCheckBalance = useCallback(async () => {
    updateStep("check-balance", { status: "running" });
    addLog("Checking token balance...");

    if (testState.chain === "evm") {
      const tokenConfig = ELIZAOS_TOKEN_CONFIG.evm.base;
      const chainConfig = SUPPORTED_CHAINS.base;
      const viemChain = getViemChain("base");

      addLog(`Token: ${tokenConfig.symbol} at ${tokenConfig.address}`);
      addLog(`RPC: ${chainConfig.rpcUrl}`);
      addLog(`Wallet: ${evmAddress}`);

      const publicClient = createPublicClient({
        chain: viemChain,
        transport: http(chainConfig.rpcUrl),
      });

      const balance = await safeReadContract<bigint>(publicClient, {
        address: tokenConfig.address as Address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [evmAddress as Address],
      });

      const formattedBalance = Number(balance) / 10 ** tokenConfig.decimals;
      addLog(`Balance: ${formattedBalance.toFixed(4)} ${tokenConfig.symbol}`);

      if (formattedBalance <= 0) {
        throw new Error(
          `No ${tokenConfig.symbol} balance found. You need some tokens to test the flow.`,
        );
      }

      // Store the available balance for use in later steps
      setAvailableBalanceWei(balance);
      availableBalanceRef.current = balance; // Also store in ref for reliable access
      addLog(`Will use available balance: ${formattedBalance.toFixed(6)} ${tokenConfig.symbol}`);

      setTestState((prev) => ({
        ...prev,
        tokenAddress: tokenConfig.address,
        tokenSymbol: tokenConfig.symbol,
      }));

      updateStep("check-balance", {
        status: "success",
        details: `${formattedBalance.toFixed(6)} ${tokenConfig.symbol} available`,
      });
    } else {
      // Solana balance check
      const tokenConfig = ELIZAOS_TOKEN_CONFIG.solana.mainnet;

      const connection = createSolanaConnection();

      const { publicKey: activePublicKey } = getActiveSolanaContext();
      if (!activePublicKey) {
        throw new Error("No Solana public key - login step may not have completed");
      }

      const { requiredTokens, priceUsd, minUsd } = await fetchSolanaRequirements();
      setRequiredSolanaTokens(requiredTokens);
      setSolanaPriceUsd(priceUsd);
      setSolanaMinUsd(minUsd);

      const tokenMint = new SolPubkey(tokenConfig.address);
      const walletPubkey = new SolPubkey(activePublicKey);

      const tokenProgramId = await getTokenProgramId(connection, tokenMint);
      const ata = await getAssociatedTokenAddress(tokenMint, walletPubkey, false, tokenProgramId);

      const accountInfo = await connection.getTokenAccountBalance(ata);
      const balance = Number(accountInfo.value.amount) / 10 ** tokenConfig.decimals;
      const requiredTokensWithFloor = requiredTokens > BigInt(100) ? requiredTokens : BigInt(100);
      const requiredReadable = Number(requiredTokensWithFloor) / 10 ** tokenConfig.decimals;

      if (!minUsd) {
        throw new Error("Minimum USD amount not available");
      }
      if (!priceUsd) {
        throw new Error("Price not available");
      }
      addLog(
        `Minimum order: $${minUsd.toFixed(4)} at $${priceUsd.toFixed(6)} requires ${requiredReadable.toFixed(4)} ${tokenConfig.symbol}`,
      );

      addLog(`Balance: ${balance.toFixed(4)} ${tokenConfig.symbol}`);

      if (balance < requiredReadable) {
        throw new Error(
          `Insufficient balance. Need ${requiredReadable.toFixed(4)} ${tokenConfig.symbol}, have ${balance.toFixed(4)}`,
        );
      }

      setTestState((prev) => ({
        ...prev,
        tokenAddress: tokenConfig.address,
        tokenSymbol: tokenConfig.symbol,
      }));

      updateStep("check-balance", {
        status: "success",
        details: `${balance.toFixed(4)} ${tokenConfig.symbol}`,
      });
    }
  }, [
    testState.chain,
    evmAddress,
    getActiveSolanaContext,
    fetchSolanaRequirements,
    addLog,
    updateStep,
  ]);

  // Execute step 3: Approve tokens (EVM only)
  const executeApprove = useCallback(async () => {
    if (testState.chain === "solana") {
      addLog("Skipping approval (Solana uses direct transfers)");
      updateStep("approve", {
        status: "skipped",
        details: "Not needed for Solana",
      });
      return;
    }

    updateStep("approve", { status: "running" });
    addLog("Approving tokens for OTC contract...");

    const tokenConfig = ELIZAOS_TOKEN_CONFIG.evm.base;

    // Use ref for reliable access (avoids stale closure)
    const balanceToUse = availableBalanceRef.current || availableBalanceWei;
    if (!balanceToUse) {
      throw new Error("No balance available - run balance check first");
    }
    if (balanceToUse <= 0n) {
      throw new Error("Balance is zero - run balance check first");
    }

    // Approve 100 tokens
    const approveAmount = BigInt(100) * BigInt(10 ** tokenConfig.decimals);
    const amountToApprove = approveAmount > balanceToUse ? balanceToUse : approveAmount;

    const formattedAmount = Number(amountToApprove) / 10 ** tokenConfig.decimals;
    addLog(`Approving ${formattedAmount.toFixed(6)} ${tokenConfig.symbol}...`);

    const txHash = await approveToken(tokenConfig.address as Address, amountToApprove, "base");

    addLog(`Approval tx submitted: ${txHash}`);
    addLog("Waiting for approval confirmation...");

    // Wait for approval tx to be mined before proceeding
    const { waitForEvmTx } = await import("@/utils/tx-helpers");
    const chainConfig = SUPPORTED_CHAINS.base;
    const viemChain = getViemChain("base");
    const publicClient = createPublicClient({
      chain: viemChain,
      transport: http(chainConfig.rpcUrl),
    });
    const status = await waitForEvmTx(publicClient, txHash as `0x${string}`);
    if (!status) {
      throw new Error("Approval transaction failed - no status returned");
    }
    if (status === "reverted") {
      throw new Error("Approval transaction reverted");
    }
    addLog(`Approval ${status}`);

    updateStep("approve", { status: "success", txHash: txHash as string });
  }, [testState.chain, availableBalanceWei, approveToken, addLog, updateStep]);

  // Execute step 4: Create consignment (deposit)
  const executeDeposit = useCallback(async () => {
    updateStep("deposit", { status: "running" });

    if (testState.chain === "evm") {
      const tokenConfig = ELIZAOS_TOKEN_CONFIG.evm.base;

      // Use ref for reliable access (avoids stale closure)
      const balanceToUse = availableBalanceRef.current || availableBalanceWei;
      if (!balanceToUse) {
        throw new Error("No balance available - run balance check first");
      }
      if (balanceToUse <= 0n) {
        throw new Error("Balance is zero - run balance check first");
      }

      // Deposit 100 tokens
      const depositAmount = BigInt(100) * BigInt(10 ** tokenConfig.decimals);
      const amount = depositAmount > balanceToUse ? balanceToUse : depositAmount;
      const formattedAmount = Number(amount) / 10 ** tokenConfig.decimals;
      addLog(`Creating consignment (depositing ${formattedAmount.toFixed(6)} tokens)...`);

      // Get gas deposit
      const gasDeposit = await getRequiredGasDeposit("base");
      addLog(`Gas deposit: ${Number(gasDeposit) / 1e18} ETH`);

      const tokenId = `token-base-${tokenConfig.address}`;

      addLog("Submitting consignment transaction...");
      addLog(`Note: If token is not registered, this will attempt auto-registration (gas only)`);

      const result = await createConsignmentOnChain(
        {
          tokenId,
          tokenSymbol: tokenConfig.symbol,
          tokenAddress: tokenConfig.address,
          amount,
          isNegotiable: true,
          fixedDiscountBps: 1000, // 10%
          fixedLockupDays: 180,
          minDiscountBps: 500,
          maxDiscountBps: 2000,
          minLockupDays: 7,
          maxLockupDays: 365,
          minDealAmount: BigInt(1) * BigInt(10 ** tokenConfig.decimals),
          maxDealAmount: amount,
          isFractionalized: true,
          isPrivate: false,
          maxPriceVolatilityBps: 1000,
          maxTimeToExecute: 1800,
          gasDeposit,
          chain: "base",
        },
        (txHash) => addLog(`Transaction submitted: ${txHash}`),
      );

      addLog(`Consignment created. ID: ${result.consignmentId}`);
      setTestState((prev) => ({
        ...prev,
        consignmentId: result.consignmentId.toString(),
      }));

      updateStep("deposit", {
        status: "success",
        txHash: result.txHash,
        details: `Consignment ID: ${result.consignmentId}`,
      });
    } else {
      // Solana consignment
      const tokenConfig = ELIZAOS_TOKEN_CONFIG.solana.mainnet;

      addLog(`Solana deposit check:`);
      addLog(`  SOLANA_DESK: ${SOLANA_DESK || "NOT SET"}`);
      addLog(`  solanaPublicKey: ${solanaPublicKey || "NOT SET"}`);
      addLog(`  phantomPublicKey: ${phantomPublicKey || "NOT SET"}`);
      addLog(`  solanaCanSign: ${solanaCanSign || phantomCanSign}`);

      if (!SOLANA_DESK) {
        throw new Error("SOLANA_DESK not configured in SUPPORTED_CHAINS.solana.contracts.otc");
      }
      const { signer: activeSigner, publicKey: activePublicKey } = getActiveSolanaContext();
      if (!activeSigner) {
        throw new Error(
          "Solana wallet signer not available - go back to Login step and connect your wallet",
        );
      }
      if (!activeSigner.signTransaction) {
        throw new Error(
          "Solana wallet signTransaction method not available - go back to Login step and connect your wallet",
        );
      }
      if (!activePublicKey) {
        throw new Error(
          "Solana public key not available - go back to Login step and connect your wallet",
        );
      }

      addLog("Fetching Solana pricing requirements...");
      const pricing = await fetchSolanaRequirements();
      addLog(
        `Got pricing: requiredTokens=${pricing.requiredTokens}, priceUsd=${pricing.priceUsd}, minUsd=${pricing.minUsd}`,
      );
      setRequiredSolanaTokens(pricing.requiredTokens);
      setSolanaPriceUsd(pricing.priceUsd);
      setSolanaMinUsd(pricing.minUsd);

      addLog("Creating Solana connection...");
      const connection = createSolanaConnection();
      addLog("Connection created");

      addLog("Building anchor wallet adapter...");
      const anchorWallet = createSignerAnchorWallet(activePublicKey, activeSigner);

      addLog("Creating Anchor provider...");
      const provider = new anchor.AnchorProvider(connection, anchorWallet, {
        commitment: "confirmed",
      });

      addLog("Fetching IDL...");
      const idl = await fetchSolanaIdl();
      addLog("Creating Anchor program...");
      const program = new anchor.Program(idl, provider);

      addLog("Setting up public keys...");
      const desk = new SolPubkey(SOLANA_DESK);
      const tokenMintPk = new SolPubkey(tokenConfig.address);
      const consignerPk = new SolPubkey(activePublicKey);
      addLog(
        `Desk: ${desk.toBase58()}, Token: ${tokenMintPk.toBase58()}, Consigner: ${consignerPk.toBase58()}`,
      );

      addLog("Getting token program ID...");
      const tokenProgramId = await getTokenProgramId(connection, tokenMintPk);
      addLog(`Token program ID: ${tokenProgramId.toBase58()}`);

      addLog("Computing consigner ATA...");
      const consignerTokenAta = await getAssociatedTokenAddress(
        tokenMintPk,
        consignerPk,
        false,
        tokenProgramId,
      );
      addLog(`Consigner ATA: ${consignerTokenAta.toBase58()}`);

      // Ensure token is registered using shared utility
      addLog("Checking token registration...");
      const signTx = activeSigner.signTransaction as <T extends anchor.web3.Transaction>(
        tx: T,
      ) => Promise<T>;
      const regResult = await ensureTokenRegistered(
        connection,
        program,
        desk,
        tokenMintPk,
        consignerPk,
        signTx,
      );
      if (regResult.signature) {
        addLog(`Token registered: ${regResult.signature}`);
      } else {
        addLog("Token already registered");
      }

      // Ensure desk treasury exists using shared utility
      addLog("Checking desk treasury...");
      const treasuryResult = await ensureTreasuryExists(
        connection,
        desk,
        tokenMintPk,
        tokenProgramId,
        consignerPk,
        signTx,
      );
      const deskTokenTreasury = treasuryResult.address;
      if (treasuryResult.signature) {
        addLog(`Treasury ATA created: ${treasuryResult.signature}`);
      } else {
        addLog("Desk treasury already exists");
      }

      // Create consignment
      // NOTE: pricing.requiredTokens is ALREADY in lamports (smallest unit)!
      const consignmentKeypair = Keypair.generate();
      const minTokensLamports = BigInt(100) * BigInt(10) ** BigInt(tokenConfig.decimals); // 100 tokens in lamports
      const tokenAmountLamports =
        pricing.requiredTokens > minTokensLamports ? pricing.requiredTokens : minTokensLamports;
      const depositAmountLamports = tokenAmountLamports + tokenAmountLamports / 10n; // 10% buffer
      const minDealLamports = BigInt(1) * BigInt(10) ** BigInt(tokenConfig.decimals); // 1 token minimum deal
      const amount = new anchor.BN(depositAmountLamports.toString());
      const minDeal = new anchor.BN(minDealLamports.toString());
      setSolanaDepositAmount(depositAmountLamports);
      addLog(
        `Depositing ${Number(depositAmountLamports) / 10 ** tokenConfig.decimals} ${tokenConfig.symbol} to satisfy minimum order`,
      );

      addLog(
        `Creating consignment with amount=${amount.toString()}, minDeal=${minDeal.toString()}`,
      );
      addLog(`Consignment keypair: ${consignmentKeypair.publicKey.toBase58()}`);

      addLog("Building createConsignment transaction...");
      const tx = await program.methods
        .createConsignment(
          amount,
          true, // negotiable
          1000, // 10% discount
          180, // 180 days lockup
          500, // min discount
          2000, // max discount
          7, // min lockup
          365, // max lockup
          minDeal,
          amount, // max deal
          true, // fractionalized
          false, // not private
          1000, // volatility
          new anchor.BN(1800), // max time
        )
        .accounts({
          desk,
          consigner: consignerPk,
          tokenMint: tokenMintPk,
          consignerTokenAta,
          deskTokenTreasury,
          consignment: consignmentKeypair.publicKey,
          tokenProgram: tokenProgramId,
          systemProgram: SolSystemProgram.programId,
        })
        .transaction();

      addLog("Transaction built, setting fee payer and blockhash...");
      tx.feePayer = consignerPk;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      tx.partialSign(consignmentKeypair);

      addLog("Requesting wallet signature...");
      const signedTx = await activeSigner.signTransaction(tx);
      addLog("Sending transaction...");
      const sig = await connection.sendRawTransaction(signedTx.serialize());
      addLog(`Transaction sent: ${sig}, waiting for confirmation...`);
      await confirmTransactionPolling(connection, sig, "confirmed");

      addLog(`Consignment created: ${sig}`);
      setTestState((prev) => ({
        ...prev,
        consignmentId: consignmentKeypair.publicKey.toString(),
      }));

      updateStep("deposit", {
        status: "success",
        txHash: sig,
        details: `Consignment: ${consignmentKeypair.publicKey.toString().slice(0, 8)}...`,
      });
    }
  }, [
    testState.chain,
    solanaPublicKey,
    solanaCanSign,
    phantomPublicKey,
    phantomCanSign,
    getActiveSolanaContext,
    fetchSolanaRequirements,
    createConsignmentOnChain,
    getRequiredGasDeposit,
    availableBalanceWei,
    addLog,
    updateStep,
  ]);

  // Execute step 5: Buy tokens
  const executeBuy = useCallback(async () => {
    updateStep("buy", { status: "running" });
    addLog("Buying tokens at 10% discount...");

    if (!testState.consignmentId) {
      throw new Error("No consignment ID - deposit step must complete first");
    }

    if (testState.chain === "evm") {
      const tokenConfig = ELIZAOS_TOKEN_CONFIG.evm.base;
      const chainConfig = SUPPORTED_CHAINS.base;
      const viemChain = getViemChain("base");

      // Buy 50 tokens
      const tokenAmountWei = BigInt(50) * BigInt(10 ** tokenConfig.decimals);
      const lockupSeconds = BigInt(180 * 24 * 60 * 60); // 180 days

      // Get next offer ID from contract before creating
      const publicClient = createPublicClient({
        chain: viemChain,
        transport: http(chainConfig.rpcUrl),
      });

      const otcAddress = chainConfig.contracts.otc as Address;
      const nextOfferId = await safeReadContract<bigint>(publicClient, {
        address: otcAddress,
        abi: [
          {
            type: "function",
            name: "nextOfferId",
            stateMutability: "view",
            inputs: [],
            outputs: [{ name: "", type: "uint256" }],
          },
        ] as const,
        functionName: "nextOfferId",
      });

      addLog(`Next offer ID will be: ${nextOfferId.toString()}`);
      addLog(`Creating offer for 50 tokens from consignment ${testState.consignmentId}...`);

      const txHash = await createOfferFromConsignment({
        consignmentId: BigInt(testState.consignmentId),
        tokenAmountWei,
        discountBps: 1000, // 10%
        paymentCurrency: 0, // ETH
        lockupSeconds,
        agentCommissionBps: 25, // Minimum 25 bps (0.25%) for negotiable consignments
        chain: "base",
      });

      addLog(`Offer created: ${txHash}`);

      // Now trigger backend approval with actual offer ID
      addLog(`Requesting backend approval for offer ${nextOfferId.toString()}...`);
      const approveRes = await fetch("/api/otc/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offerId: nextOfferId.toString(),
          txHash,
          chain: "base",
        }),
      });

      if (!approveRes.ok) {
        const errorText = await approveRes.text();
        throw new Error(`Approval failed: ${errorText}`);
      }

      const approveData = await approveRes.json();
      // FAIL-FAST: Approval response must have transaction hash
      // Use fulfillTx if available, otherwise fall back to approvalTx
      const approvalTxHash = approveData.fulfillTx || approveData.approvalTx;
      if (!approvalTxHash || typeof approvalTxHash !== "string") {
        throw new Error("Approval response missing transaction hash");
      }
      addLog(`Offer approved and fulfilled: ${approvalTxHash}`);

      updateStep("buy", {
        status: "success",
        txHash: txHash as string,
        details: "50 tokens purchased at 10% discount",
      });
    } else {
      // Solana buy flow
      const tokenConfig = ELIZAOS_TOKEN_CONFIG.solana.mainnet;

      if (!SOLANA_DESK) throw new Error("SOLANA_DESK not configured");
      const { signer: activeSigner, publicKey: activePublicKey } = getActiveSolanaContext();
      if (!activeSigner) {
        throw new Error("Solana wallet signer not available");
      }
      if (!activeSigner.signTransaction) {
        throw new Error("Solana wallet signTransaction method not available");
      }
      if (!activePublicKey) {
        throw new Error("Solana public key not available");
      }

      const connection = createSolanaConnection();
      const anchorWallet = createSignerAnchorWallet(activePublicKey, activeSigner);
      const provider = new anchor.AnchorProvider(connection, anchorWallet, {
        commitment: "confirmed",
      });
      const idl = await fetchSolanaIdl();
      const program = new anchor.Program(idl, provider);
      const desk = new SolPubkey(SOLANA_DESK);
      const tokenMintPk = new SolPubkey(tokenConfig.address);

      // Ensure price is set
      addLog("Updating token price...");
      const priceRes = await fetch("/api/solana/update-price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokenMint: tokenConfig.address,
          forceUpdate: true,
        }),
      });
      const priceData: PriceUpdateResponse = (await priceRes.json()) as PriceUpdateResponse;
      if (!priceRes.ok) {
        // FAIL-FAST: Error response should include error message
        const errorMessage =
          typeof priceData.error === "string" && priceData.error.trim() !== ""
            ? priceData.error
            : "Price update failed";
        throw new Error(errorMessage);
      }
      const priceUsd = extractPriceUsd(priceData);
      if (priceUsd) {
        setSolanaPriceUsd(priceUsd);
      }

      const pricing =
        requiredSolanaTokens && solanaMinUsd && solanaPriceUsd
          ? {
              requiredTokens: requiredSolanaTokens,
              minUsd: solanaMinUsd,
              priceUsd: solanaPriceUsd,
            }
          : await fetchSolanaRequirements();

      setRequiredSolanaTokens(pricing.requiredTokens);
      setSolanaMinUsd(pricing.minUsd);
      if (pricing.priceUsd) {
        setSolanaPriceUsd(pricing.priceUsd);
      }

      // Derive token registry PDA using shared utility
      const tokenRegistryPda = deriveTokenRegistryPda(desk, tokenMintPk, program.programId);

      const deskTokenTreasury = await getAssociatedTokenAddress(tokenMintPk, desk, true);

      // Fetch desk account for offer ID and limits
      interface DeskAccountWithLimits extends DeskAccount {
        nextOfferId: anchor.BN;
        defaultUnlockDelaySecs?: anchor.BN;
        maxLockupSecs?: anchor.BN;
      }

      interface DeskAccountProgram {
        desk: {
          fetch: (addr: SolPubkey) => Promise<DeskAccountWithLimits>;
        };
      }

      const deskAccount = await (program.account as DeskAccountProgram).desk.fetch(desk);
      const nextOfferId = new anchor.BN(deskAccount.nextOfferId.toString());

      addLog(`Next offer ID: ${nextOfferId.toString()}`);

      // Buy 50 tokens - must be within consignment's min/max deal limits
      const buyAmountTokens = 50n;
      const buyAmountLamports = buyAmountTokens * BigInt(10 ** tokenConfig.decimals);
      const buyAmountReadable = Number(buyAmountLamports) / 10 ** tokenConfig.decimals;

      addLog(
        `Token amount for offer: ${buyAmountReadable} tokens (${buyAmountLamports.toString()} lamports)`,
      );

      // Verify deposit covers buy amount
      if (!solanaDepositAmount) {
        throw new Error("Solana deposit amount not available");
      }
      if (solanaDepositAmount < buyAmountLamports) {
        throw new Error(
          `Deposit (${Number(solanaDepositAmount) / 10 ** tokenConfig.decimals} tokens) is less than buy amount (${buyAmountReadable} tokens)`,
        );
      }

      const offerKeypair = Keypair.generate();
      const tokenAmountWei = new anchor.BN(buyAmountLamports.toString());

      // Calculate lockup: clamp between desk default and max
      const desiredLockupSecs = 180n * 24n * 60n * 60n; // 180 days
      if (!deskAccount.defaultUnlockDelaySecs) {
        throw new Error("Desk defaultUnlockDelaySecs is not set");
      }
      const minLockup = BigInt(deskAccount.defaultUnlockDelaySecs.toString());
      if (!deskAccount.maxLockupSecs) {
        throw new Error("Desk maxLockupSecs is not set");
      }
      const maxLockup = BigInt(deskAccount.maxLockupSecs.toString());
      const lockupSeconds = new anchor.BN(
        Math.max(
          Number(minLockup),
          Math.min(Number(desiredLockupSecs), Number(maxLockup)),
        ).toString(),
      );

      // Get the consignment ID from the consignment account
      const consignmentPubkey = new SolPubkey(testState.consignmentId);
      interface ConsignmentAccountProgram {
        consignment: {
          fetch: (addr: SolPubkey) => Promise<{ id: anchor.BN }>;
        };
      }
      const consignmentAccount = await (
        program.account as ConsignmentAccountProgram
      ).consignment.fetch(consignmentPubkey);
      const consignmentId = new anchor.BN(consignmentAccount.id.toString());
      addLog(
        `Using consignment ID: ${consignmentId.toString()} from ${testState.consignmentId.slice(0, 8)}...`,
      );

      const tx = await program.methods
        .createOfferFromConsignment(
          consignmentId, // consignment_id
          tokenAmountWei, // token_amount
          SOLANA_DISCOUNT_BPS, // discount_bps
          SOLANA_PAYMENT_CURRENCY, // currency (0 = SOL, 1 = USDC)
          lockupSeconds, // lockup_secs
          SOLANA_AGENT_COMMISSION_BPS, // agent_commission_bps
        )
        .accounts({
          desk,
          consignment: consignmentPubkey,
          tokenRegistry: tokenRegistryPda,
          deskTokenTreasury,
          beneficiary: new SolPubkey(activePublicKey),
          offer: offerKeypair.publicKey,
          systemProgram: SolSystemProgram.programId,
        })
        .transaction();

      tx.feePayer = new SolPubkey(activePublicKey);
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      tx.partialSign(offerKeypair);

      const signedTx = await activeSigner.signTransaction(tx);
      const sig = await connection.sendRawTransaction(signedTx.serialize());
      await confirmTransactionPolling(connection, sig, "confirmed");

      addLog(`Offer created: ${sig}`);

      // Request backend approval and fulfillment
      addLog("Requesting backend approval...");
      const approveRes = await fetch("/api/otc/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offerId: nextOfferId.toString(),
          chain: "solana",
          offerAddress: offerKeypair.publicKey.toString(),
          consignmentAddress: testState.consignmentId, // Consignment public key stored from deposit step
        }),
      });

      if (!approveRes.ok) {
        const errorText = await approveRes.text();
        throw new Error(`Approval failed: ${errorText}`);
      }

      const approveData = await approveRes.json();
      addLog(`Offer approved: ${approveData.approvalTx}`);
      if (approveData.fulfillTx) {
        addLog(`Offer fulfilled: ${approveData.fulfillTx}`);
      }

      setTestState((prev) => ({ ...prev, offerId: nextOfferId.toString() }));

      updateStep("buy", {
        status: "success",
        txHash: sig,
        details: `${buyAmountReadable} tokens purchased at ${SOLANA_DISCOUNT_BPS / 100}% discount`,
      });
    }
  }, [
    testState.chain,
    testState.consignmentId,
    getActiveSolanaContext,
    fetchSolanaRequirements,
    requiredSolanaTokens,
    solanaMinUsd,
    solanaPriceUsd,
    solanaDepositAmount,
    createOfferFromConsignment,
    addLog,
    updateStep,
  ]);

  // Execute step 6: Withdraw remaining tokens
  const executeWithdraw = useCallback(async () => {
    updateStep("withdraw", { status: "running" });
    addLog("Withdrawing remaining tokens...");

    if (!testState.consignmentId) {
      throw new Error("No consignment ID - deposit step must complete first");
    }

    if (testState.chain === "evm") {
      addLog(`Withdrawing from consignment ${testState.consignmentId}...`);

      const txHash = await withdrawConsignment(BigInt(testState.consignmentId));

      addLog(`Withdrawal complete: ${txHash}`);
      updateStep("withdraw", {
        status: "success",
        txHash: txHash as string,
        details: "Remaining tokens withdrawn",
      });
    } else {
      // Solana withdrawal
      const tokenConfig = ELIZAOS_TOKEN_CONFIG.solana.mainnet;

      if (!SOLANA_DESK) throw new Error("SOLANA_DESK not configured");
      const { signer: activeSigner, publicKey: activePublicKey } = getActiveSolanaContext();
      if (!activeSigner) {
        throw new Error("Solana wallet signer not available");
      }
      if (!activeSigner.signTransaction) {
        throw new Error("Solana wallet signTransaction method not available");
      }
      if (!activePublicKey) {
        throw new Error("Solana public key not available");
      }

      const connection = createSolanaConnection();
      const anchorWallet = createSignerAnchorWallet(activePublicKey, activeSigner);
      const provider = new anchor.AnchorProvider(connection, anchorWallet, {
        commitment: "confirmed",
      });
      const idl = await fetchSolanaIdl();
      const program = new anchor.Program(idl, provider);
      const desk = new SolPubkey(SOLANA_DESK);
      const tokenMintPk = new SolPubkey(tokenConfig.address);
      const consignerPk = new SolPubkey(activePublicKey);

      addLog(`Consignment address from state: ${testState.consignmentId}`);
      const consignmentPk = new SolPubkey(testState.consignmentId);
      addLog(`Consignment pubkey: ${consignmentPk.toBase58()}`);

      const tokenProgramId = await getTokenProgramId(connection, tokenMintPk);

      const consignerTokenAta = await getAssociatedTokenAddress(
        tokenMintPk,
        consignerPk,
        false,
        tokenProgramId,
      );

      const deskTokenTreasury = await getAssociatedTokenAddress(
        tokenMintPk,
        desk,
        true,
        tokenProgramId,
      );

      // Get consignment ID from the account
      interface ConsignmentWithRemainingProgram {
        consignment: {
          fetch: (addr: SolPubkey) => Promise<{ id: anchor.BN; remainingAmount: anchor.BN }>;
        };
      }
      const consignmentAccount = await (
        program.account as ConsignmentWithRemainingProgram
      ).consignment.fetch(consignmentPk);
      const consignmentId = new anchor.BN(consignmentAccount.id.toString());
      addLog(
        `Withdrawing from consignment ID ${consignmentId.toString()}, remaining: ${Number(consignmentAccount.remainingAmount) / 1e9} tokens`,
      );

      if (consignmentAccount.remainingAmount.toNumber() === 0) {
        addLog("No remaining tokens to withdraw");
        updateStep("withdraw", {
          status: "success",
          details: "Consignment already empty - nothing to withdraw",
        });
        return;
      }

      // Build withdrawal transaction - backend will add desk signature
      const tx = await program.methods
        .withdrawConsignment(consignmentId)
        .accounts({
          consignment: consignmentPk,
          desk,
          tokenMint: tokenMintPk,
          deskSigner: desk, // Will be replaced by backend with actual desk signer
          consigner: consignerPk,
          deskTokenTreasury,
          consignerTokenAta,
          tokenProgram: tokenProgramId,
        })
        .transaction();

      tx.feePayer = consignerPk;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

      // Sign with wallet first
      addLog("Requesting wallet signature...");
      const signedTx = await activeSigner.signTransaction(tx);

      // Send to backend for desk signature
      addLog("Sending to backend for desk signature...");
      // Use requireAllSignatures: false since desk hasn't signed yet
      const serializedTx = signedTx.serialize({
        requireAllSignatures: false,
      });
      const withdrawRes = await fetch("/api/solana/withdraw-consignment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          consignmentAddress: testState.consignmentId,
          consignerAddress: activePublicKey,
          signedTransaction: Buffer.from(serializedTx).toString("base64"),
        }),
      });

      if (!withdrawRes.ok) {
        const errorData = await withdrawRes.json();
        // Error message is optional in error response - provide fallback
        const errorMessage =
          typeof errorData.error === "string" && errorData.error.trim() !== ""
            ? errorData.error
            : "Withdrawal failed";
        throw new Error(errorMessage);
      }

      const withdrawData = await withdrawRes.json();
      addLog(`Withdrawal complete: ${withdrawData.signature}`);

      updateStep("withdraw", {
        status: "success",
        txHash: withdrawData.signature,
        details: "Remaining tokens withdrawn",
      });
    }
  }, [
    testState.chain,
    testState.consignmentId,
    getActiveSolanaContext,
    withdrawConsignment,
    addLog,
    updateStep,
  ]);

  // Check if wallet is connected for current chain
  const { signer: activeSigner, publicKey: activePublicKey } = getActiveSolanaContext();
  const isWalletReady =
    testState.chain === "solana"
      ? Boolean(activePublicKey && activeSigner && activeSigner.signTransaction)
      : Boolean(evmAddress);

  // getExplorerUrl uses centralized getExplorerTxUrl from @/utils/format
  const getExplorerUrl = (txHash: string) => {
    if (testState.chain === "solana") {
      return getExplorerTxUrl(txHash, "solana");
    }
    const network = getCurrentNetwork();
    return getExplorerTxUrl(txHash, "base", network !== "mainnet");
  };

  return (
    <main className="flex-1 px-4 py-8 overflow-y-auto">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">OTC Flow Test</h1>
        <p className="text-zinc-500 mb-6">Step-by-step verification of the complete OTC flow</p>

        {/* Chain Selection */}
        <div className="flex gap-4 mb-8">
          <Button
            onClick={() => startTest("evm")}
            color={
              (testState.chain === "evm" && testState.steps.length > 0 ? "brand" : "dark") as
                | "brand"
                | "dark"
            }
            className="flex-1"
            data-testid="start-evm-test"
          >
            <div className="py-2">Test EVM Flow (Base)</div>
          </Button>
          <Button
            onClick={() => startTest("solana")}
            color={
              (testState.chain === "solana" && testState.steps.length > 0 ? "brand" : "dark") as
                | "brand"
                | "dark"
            }
            className="flex-1"
            data-testid="start-solana-test"
          >
            <div className="py-2">Test Solana Flow</div>
          </Button>
        </div>

        {testState.steps.length > 0 && (
          <div className="grid md:grid-cols-2 gap-6">
            {/* Steps Panel */}
            <div className="bg-zinc-900 rounded-xl p-6 ring-1 ring-white/10">
              <h2 className="text-lg font-semibold mb-4">
                Test Steps ({testState.chain.toUpperCase()})
              </h2>

              <div className="space-y-3" data-testid="steps-container">
                {testState.steps.map((step, idx) => (
                  <div
                    key={step.id}
                    data-testid={`step-${step.id}`}
                    data-step-status={step.status}
                    className={`p-4 rounded-lg border ${
                      step.status === "success"
                        ? "border-green-500/30 bg-green-500/10"
                        : step.status === "error"
                          ? "border-red-500/30 bg-red-500/10"
                          : step.status === "running"
                            ? "border-brand-500/30 bg-brand-500/10"
                            : step.status === "skipped"
                              ? "border-zinc-500/30 bg-zinc-500/10"
                              : "border-zinc-700 bg-zinc-800/50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{step.name}</span>
                      <span
                        className={`text-xs px-2 py-1 rounded ${
                          step.status === "success"
                            ? "bg-green-500/20 text-green-400"
                            : step.status === "error"
                              ? "bg-red-500/20 text-red-400"
                              : step.status === "running"
                                ? "bg-brand-500/20 text-brand-400"
                                : step.status === "skipped"
                                  ? "bg-zinc-500/20 text-zinc-400"
                                  : "bg-zinc-700 text-zinc-400"
                        }`}
                      >
                        {step.status === "running" && (
                          <span className="inline-block animate-spin mr-1">⟳</span>
                        )}
                        {step.status}
                      </span>
                    </div>

                    {step.error && <p className="text-sm text-red-400 mt-2">{step.error}</p>}

                    {step.details && <p className="text-sm text-zinc-400 mt-2">{step.details}</p>}

                    {step.txHash && (
                      <a
                        href={getExplorerUrl(step.txHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-brand-400 hover:text-brand-300 mt-2 inline-block"
                      >
                        View transaction ↗
                      </a>
                    )}

                    {/* Step Action Button */}
                    {step.status !== "success" && step.status !== "skipped" && (
                      <div className="mt-3">
                        <Button
                          onClick={() => {
                            switch (step.id) {
                              case "login":
                                executeLogin();
                                break;
                              case "check-balance":
                                executeCheckBalance();
                                break;
                              case "approve":
                                executeApprove();
                                break;
                              case "deposit":
                                executeDeposit();
                                break;
                              case "buy":
                                executeBuy();
                                break;
                              case "withdraw":
                                executeWithdraw();
                                break;
                            }
                          }}
                          color="brand"
                          disabled={
                            step.status === "running" ||
                            (idx > 0 &&
                              testState.steps[idx - 1].status !== "success" &&
                              testState.steps[idx - 1].status !== "skipped")
                          }
                          className="w-full"
                          data-testid={`step-${step.id}-execute`}
                        >
                          <div className="py-1 text-sm">
                            {step.status === "running"
                              ? "Running..."
                              : step.status === "error"
                                ? "Retry"
                                : "Execute"}
                          </div>
                        </Button>
                      </div>
                    )}

                    {/* Change Wallet Button - only for login step when successful */}
                    {step.id === "login" && step.status === "success" && (
                      <div className="mt-2">
                        <Button onClick={changeWallet} color="dark" className="w-full">
                          <div className="py-1 text-sm">Change Wallet</div>
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Run All Button */}
              <div className="mt-6">
                <Button
                  onClick={async () => {
                    // Reset results ref
                    stepResultsRef.current = {};

                    const stepOrder = [
                      "login",
                      "check-balance",
                      "approve",
                      "deposit",
                      "buy",
                      "withdraw",
                    ];

                    for (const stepId of stepOrder) {
                      const step = testState.steps.find((s) => s.id === stepId);
                      if (!step) continue;

                      // Skip already completed steps
                      if (step.status === "success" || step.status === "skipped") {
                        stepResultsRef.current[stepId] = step.status;
                        continue;
                      }

                      switch (stepId) {
                        case "login":
                          await executeLogin();
                          break;
                        case "check-balance":
                          await executeCheckBalance();
                          break;
                        case "approve":
                          await executeApprove();
                          break;
                        case "deposit":
                          await executeDeposit();
                          break;
                        case "buy":
                          await executeBuy();
                          break;
                        case "withdraw":
                          await executeWithdraw();
                          break;
                      }

                      // Wait a bit between steps
                      await new Promise((r) => setTimeout(r, 1500));

                      // Check result using ref (updated by updateStep)
                      const result = stepResultsRef.current[stepId];
                      if (result === "error") {
                        addLog(`Stopping - ${stepId} step failed`);
                        break;
                      }
                      if (result === "pending") {
                        addLog(`Stopping - ${stepId} step requires user action`);
                        break;
                      }
                    }
                  }}
                  color="brand"
                  className="w-full"
                  data-testid="run-all-steps"
                >
                  <div className="py-2">Run All Steps</div>
                </Button>
              </div>
            </div>

            {/* Logs Panel */}
            <div className="bg-zinc-900 rounded-xl p-6 ring-1 ring-white/10">
              <h2 className="text-lg font-semibold mb-4">Execution Log</h2>

              <div className="h-[500px] overflow-y-auto bg-zinc-950 rounded-lg p-4 font-mono text-xs">
                {testState.logs.length === 0 ? (
                  <p className="text-zinc-500">Logs will appear here when you run tests...</p>
                ) : (
                  testState.logs.map((log, idx) => (
                    <div
                      key={`${log.slice(0, 50)}-${idx}`}
                      className={`py-1 ${
                        log.includes("failed") || log.includes("error")
                          ? "text-red-400"
                          : log.includes("success") || log.includes("complete")
                            ? "text-green-400"
                            : "text-zinc-300"
                      }`}
                    >
                      {log}
                    </div>
                  ))
                )}
                <div ref={logsEndRef} />
              </div>

              {/* Clear Logs */}
              <div className="mt-4">
                <Button
                  onClick={() => setTestState((prev) => ({ ...prev, logs: [] }))}
                  color="dark"
                  className="w-full"
                >
                  <div className="py-1 text-sm">Clear Logs</div>
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Status Summary */}
        {testState.steps.length > 0 && (
          <div className="mt-6 p-4 bg-zinc-900 rounded-xl ring-1 ring-white/10">
            <h3 className="font-semibold mb-2">Current State</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-zinc-500">Chain:</span>{" "}
                <span className="font-medium">{testState.chain.toUpperCase()}</span>
              </div>
              <div>
                <span className="text-zinc-500">Wallet:</span>{" "}
                <span className="font-medium">{isWalletReady ? "Connected" : "Not connected"}</span>
              </div>
              <div>
                <span className="text-zinc-500">Consignment:</span>{" "}
                <span className="font-medium">
                  {testState.consignmentId ? `${testState.consignmentId.slice(0, 8)}...` : "None"}
                </span>
              </div>
              <div>
                <span className="text-zinc-500">Token:</span>{" "}
                <span className="font-medium">{testState.tokenSymbol || "Not set"}</span>
              </div>
            </div>

            {/* Manual Consignment ID Override */}
            <div className="mt-4 pt-4 border-t border-zinc-800">
              <label htmlFor="manual-consignment-id" className="text-sm text-zinc-500">
                Manual Consignment ID (for resuming tests):
              </label>
              <div className="flex gap-2 mt-1">
                <input
                  type="text"
                  placeholder="e.g. 5"
                  className="flex-1 px-3 py-2 bg-zinc-950 rounded border border-zinc-700 text-sm"
                  id="manual-consignment-id"
                />
                <Button
                  onClick={() => {
                    const input = document.getElementById(
                      "manual-consignment-id",
                    ) as HTMLInputElement | null;
                    if (!input) {
                      throw new Error("Manual consignment ID input element not found");
                    }
                    const value = input.value.trim();
                    if (value) {
                      setTestState((prev) => ({
                        ...prev,
                        consignmentId: value,
                      }));
                      addLog(`Manually set consignment ID to: ${value}`);
                      // Mark deposit step as success to allow buy
                      updateStep("deposit", {
                        status: "success",
                        details: `Manually set consignment ID: ${value}`,
                      });
                    }
                  }}
                  color="dark"
                >
                  <div className="py-1 text-sm">Set ID</div>
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
