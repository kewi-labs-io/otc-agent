"use client";

// Solana imports
import type { Wallet } from "@coral-xyz/anchor";
import * as anchor from "@coral-xyz/anchor";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import {
  Keypair,
  PublicKey as SolPubkey,
  SystemProgram as SolSystemProgram,
} from "@solana/web3.js";
import dynamic from "next/dynamic";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { TokenWithBalance } from "@/components/consignment-form/token-selection-step";
import { useMultiWallet } from "@/components/multiwallet";
import { WalletAvatar } from "@/components/wallet-avatar";
import { type Chain, SUPPORTED_CHAINS } from "@/config/chains";
import { useOTC } from "@/hooks/contracts/useOTC";
import { useRenderTracker } from "@/utils/render-tracker";

// Shared Solana OTC utilities - consolidated to avoid duplication
import {
  waitForSolanaTx as confirmTransactionPolling,
  createSolanaConnection,
  ensureTokenRegistered,
  ensureTreasuryExists,
  fetchSolanaIdl,
  getTokenProgramId,
  SOLANA_DESK,
  SOLANA_RPC,
} from "@/utils/solana-otc";

const TokenSelectionStep = dynamic(
  () =>
    import("@/components/consignment-form/token-selection-step").then(
      (m) => m.TokenSelectionStep,
    ),
  { ssr: false },
);
const FormStep = dynamic(
  () =>
    import("@/components/consignment-form/form-step").then((m) => m.FormStep),
  { ssr: false },
);
const ReviewStep = dynamic(
  () =>
    import("@/components/consignment-form/review-step").then(
      (m) => m.ReviewStep,
    ),
  { ssr: false },
);
const SubmissionStepComponent = dynamic(
  () =>
    import("@/components/consignment-form/submission-step").then(
      (m) => m.SubmissionStepComponent,
    ),
  { ssr: false },
);

function getRequiredChain(tokenId: string): "evm" | "solana" | null {
  if (!tokenId) return null;
  if (tokenId.includes("solana")) return "solana";
  if (
    tokenId.includes("ethereum") ||
    tokenId.includes("base") ||
    tokenId.includes("evm") ||
    tokenId.includes("bsc")
  )
    return "evm";
  return null;
}

const STEP_LABELS = ["Select", "Configure", "Review", "Submit"];

const INITIAL_FORM_DATA = {
  tokenId: "",
  amount: "",
  isNegotiable: true,
  fixedDiscountBps: 1000,
  fixedLockupDays: 180,
  minDiscountBps: 500,
  maxDiscountBps: 2000,
  minLockupDays: 7,
  maxLockupDays: 365,
  minDealAmount: "1", // No minimum - allow any size purchase
  maxDealAmount: "0", // Will be set to listing amount
  isFractionalized: true,
  isPrivate: false,
  maxPriceVolatilityBps: 1000,
  maxTimeToExecuteSeconds: 1800,
  selectedPoolAddress: "", // User-selected pool for token registration (EVM only)
};

// Extract chain and address from tokenId (format: token-{chain}-{address})
function getTokenInfo(tokenId: string) {
  if (!tokenId) {
    throw new Error("Token ID is required");
  }
  const parts = tokenId.split("-");
  if (parts.length < 3) {
    throw new Error(`Invalid token ID format: ${tokenId}`);
  }
  const chain = parts[1];
  const address = parts.slice(2).join("-");
  return { chain, address };
}

export default function ConsignPageClient() {
  useRenderTracker("ConsignPageClient");

  const {
    hasWallet,
    activeFamily,
    setActiveFamily,
    evmAddress,
    solanaPublicKey,
    solanaWallet,
    disconnect,
    connectWallet,
    privyAuthenticated,
    isFarcasterContext,
  } = useMultiWallet();
  const { login, ready: privyReady } = usePrivy();
  const { wallets } = useWallets();
  const { createConsignmentOnChain, approveToken, getRequiredGasDeposit } =
    useOTC();

  const [step, setStep] = useState(1);
  const [selectedToken, setSelectedToken] = useState<TokenWithBalance | null>(
    null,
  );
  const [formData, setFormData] = useState(INITIAL_FORM_DATA);
  const [gasDeposit, setGasDeposit] = useState<bigint | null>(null);

  const currentAddress =
    activeFamily === "solana" ? solanaPublicKey : evmAddress;
  const displayAddress = currentAddress
    ? `${currentAddress.slice(0, 6)}...${currentAddress.slice(-4)}`
    : null;

  const requiredChain = useMemo(
    () => getRequiredChain(formData.tokenId),
    [formData.tokenId],
  );
  const { chain: tokenChain, address: rawTokenAddress } = useMemo(() => {
    // Return empty values when tokenId is not yet set (initial state)
    if (!formData.tokenId) {
      return { chain: "", address: "" };
    }
    return getTokenInfo(formData.tokenId);
  }, [formData.tokenId]);

  const isConnectedToRequiredChain = useMemo(() => {
    if (!requiredChain) return hasWallet;
    return requiredChain === "solana"
      ? activeFamily === "solana" && hasWallet
      : activeFamily === "evm" && hasWallet;
  }, [requiredChain, activeFamily, hasWallet]);

  // Reset form when chain changes (prevents stale token selection)
  useEffect(() => {
    if (step > 1 && selectedToken) {
      const tokenChainType = selectedToken.chain;
      const isTokenOnCurrentChain =
        (tokenChainType === "solana" && activeFamily === "solana") ||
        (tokenChainType !== "solana" && activeFamily === "evm");

      if (!isTokenOnCurrentChain) {
        // Token is on different chain, reset to step 1
        setStep(1);
        setSelectedToken(null);
        setFormData(INITIAL_FORM_DATA);
      }
    }
  }, [activeFamily, step, selectedToken]);

  // Pre-fetch gas deposit when we have a token selected and reach review step
  useEffect(() => {
    if (step === 3 && activeFamily !== "solana" && rawTokenAddress) {
      // Use the token's chain for fetching gas deposit
      const chain = (
        tokenChain === "ethereum" ||
        tokenChain === "base" ||
        tokenChain === "bsc"
          ? tokenChain
          : "base"
      ) as Chain;
      console.log(`[ConsignPage] Fetching gas deposit for chain: ${chain}`);

      getRequiredGasDeposit(chain).then((deposit) => {
        console.log("[ConsignPage] Gas deposit fetched:", deposit.toString());
        setGasDeposit(deposit);
      });
    }
  }, [step, activeFamily, rawTokenAddress, tokenChain, getRequiredGasDeposit]);

  const updateFormData = useCallback((updates: Partial<typeof formData>) => {
    setFormData((prev) => {
      const newData = { ...prev, ...updates };

      // When amount changes, auto-set deal limits (hidden from user)
      if (updates.amount !== undefined) {
        // FAIL-FAST: Validate amount is a valid number
        const amount = parseFloat(updates.amount);
        if (isNaN(amount) || amount <= 0) {
          throw new Error(`Invalid amount value: ${updates.amount}`);
        }
        if (amount > 0) {
          // No min/max limits - allow any size purchase up to listing amount
          newData.minDealAmount = "1";
          newData.maxDealAmount = amount.toString();
        }
      }

      return newData;
    });
  }, []);

  const handleNext = useCallback(() => setStep((s) => Math.min(s + 1, 4)), []);
  const handleBack = useCallback(() => setStep((s) => Math.max(s - 1, 1)), []);

  const handleConnect = useCallback(
    (chain?: "evm" | "solana") => {
      if (chain) setActiveFamily(chain);
      if (privyAuthenticated) {
        connectWallet();
      } else {
        login();
      }
    },
    [setActiveFamily, privyAuthenticated, connectWallet, login],
  );

  const handleTokenSelect = useCallback((token: TokenWithBalance) => {
    setSelectedToken(token);
    // Reset amount when selecting new token
    // Deal limits auto-set when amount is entered
    setFormData((prev) => ({
      ...prev,
      amount: "",
    }));
  }, []);

  const getBlockExplorerUrl = useCallback(
    (txHash: string) => {
      if (tokenChain === "solana") {
        return `https://solscan.io/tx/${txHash}`;
      }
      if (tokenChain === "ethereum") {
        return `https://etherscan.io/tx/${txHash}`;
      }
      if (tokenChain === "bsc") {
        return `https://bscscan.com/tx/${txHash}`;
      }
      return `https://basescan.org/tx/${txHash}`;
    },
    [tokenChain],
  );

  const handleApproveToken = useCallback(async (): Promise<string> => {
    // Solana path - approve is done as part of the transaction
    if (activeFamily === "solana") {
      return "solana-approval-pending";
    }

    // EVM path
    if (!rawTokenAddress) {
      throw new Error("Token address not found");
    }
    if (!selectedToken) {
      throw new Error("Selected token is required");
    }
    // Token type requires decimals field - always exists
    const decimals = selectedToken.decimals;
    const rawAmount = BigInt(
      Math.floor(parseFloat(formData.amount) * 10 ** decimals),
    );

    // Pass the token's chain to ensure we use the correct OTC address
    // and switch to the correct chain if needed
    const chain = (
      tokenChain === "ethereum" || tokenChain === "base" || tokenChain === "bsc"
        ? tokenChain
        : "base"
    ) as Chain;
    console.log(`[ConsignPage] Approving token on chain: ${chain}`);

    const txHash = await approveToken(
      rawTokenAddress as `0x${string}`,
      rawAmount,
      chain,
    );

    // Wait for approval confirmation to prevent nonce race with deposit tx
    console.log(`[ConsignPage] Waiting for approval confirmation: ${txHash}`);
    // FAIL-FAST: chain must be valid Chain type, SUPPORTED_CHAINS guarantees ChainConfig exists
    if (!(chain in SUPPORTED_CHAINS)) {
      throw new Error(`Unsupported chain: ${chain}`);
    }
    const chainConfig = SUPPORTED_CHAINS[chain];
    // chainConfig.rpcUrl is required in ChainConfig type - always exists

    const { createPublicClient, http } = await import("viem");
    const { getViemChainForType } = await import("@/lib/getChain");
    const { waitForEvmTx } = await import("@/utils/tx-helpers");
    const viemChain = getViemChainForType(chain);
    // Use direct RPC for confirmation polling (proxy might have caching)
    const directRpc =
      chain === "base"
        ? "https://mainnet.base.org"
        : chain === "ethereum"
          ? "https://eth.merkle.io"
          : chain === "bsc"
            ? "https://bsc-dataseed1.binance.org"
            : chainConfig.rpcUrl;
    console.log(`[ConsignPage] Using RPC for confirmation: ${directRpc}`);
    const publicClient = createPublicClient({
      chain: viemChain,
      transport: http(directRpc),
    });
    const status = await waitForEvmTx(publicClient, txHash as `0x${string}`);
    if (!status) {
      throw new Error("Approval transaction failed - no status returned");
    }
    if (status === "reverted") {
      throw new Error("Approval transaction reverted");
    }
    console.log(`[ConsignPage] Approval tx status: ${status}`);
    console.log(
      `[ConsignPage] Approval confirmed, proceeding with consignment`,
    );

    return txHash as string;
  }, [
    activeFamily,
    rawTokenAddress,
    selectedToken,
    formData.amount,
    approveToken,
    tokenChain,
  ]);

  const handleCreateConsignment = useCallback(
    async (
      onTxSubmitted?: (txHash: string) => void,
    ): Promise<{
      txHash: string;
      consignmentId: string;
    }> => {
      // FAIL-FAST: Validate common required fields
      if (!selectedToken) {
        throw new Error("No token selected");
      }
      if (!rawTokenAddress) {
        throw new Error("Token address not found");
      }
      if (!formData.amount) {
        throw new Error("Consignment amount is required");
      }
      const amountValue = parseFloat(formData.amount);
      if (isNaN(amountValue) || amountValue <= 0) {
        throw new Error("Consignment amount must be greater than 0");
      }

      // Token type requires decimals field - always exists
      const decimals = selectedToken.decimals;

      // Solana path
      if (activeFamily === "solana") {
        // FAIL-FAST: Validate Solana-specific requirements
        if (!SOLANA_DESK) {
          throw new Error(
            "SOLANA_DESK address not configured. Check environment variables.",
          );
        }
        if (!SOLANA_RPC) {
          throw new Error(
            "SOLANA_RPC URL not configured. Check environment variables.",
          );
        }
        if (!solanaPublicKey) {
          throw new Error(
            "Solana wallet not connected. Please connect your wallet.",
          );
        }

        // FAIL-FAST: Validate Solana address format
        if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(rawTokenAddress)) {
          throw new Error(
            `Invalid Solana token address format: ${rawTokenAddress}`,
          );
        }

        // Use HTTP-only connection (no WebSocket) since we're using a proxy
        const connection = createSolanaConnection();

        // Get wallet signing capabilities - either from adapter or directly from Privy
        type SignableTransaction = anchor.web3.Transaction;

        if (!solanaWallet) {
          throw new Error("Solana wallet not connected");
        }
        if (!solanaWallet.signTransaction) {
          throw new Error(
            `Solana wallet is not ready for signing. Wallet exists but signTransaction is missing. Public key: ${solanaPublicKey || "none"}`,
          );
        }

        console.log("[ConsignPage] Using Solana wallet adapter for signing");
        const signTransaction = solanaWallet.signTransaction as (
          tx: SignableTransaction,
        ) => Promise<SignableTransaction>;
        const signAllTransactions = solanaWallet.signAllTransactions as (
          txs: SignableTransaction[],
        ) => Promise<SignableTransaction[]>;

        // Adapt to Anchor's Wallet interface (browser wallets don't have payer keypair)
        const anchorWallet = {
          publicKey: new SolPubkey(solanaPublicKey),
          signTransaction: signTransaction as Wallet["signTransaction"],
          signAllTransactions:
            signAllTransactions as Wallet["signAllTransactions"],
        } as Wallet;

        const provider = new anchor.AnchorProvider(connection, anchorWallet, {
          commitment: "confirmed",
        });

        console.log("[ConsignPage] Fetching Solana IDL...");
        const idl = await fetchSolanaIdl();
        console.log("[ConsignPage] IDL loaded, creating program...");
        const program = new anchor.Program(idl, provider);

        const desk = new SolPubkey(SOLANA_DESK);
        const tokenMintPk = new SolPubkey(rawTokenAddress);
        const consignerPk = new SolPubkey(solanaPublicKey);

        // Detect token program (Token or Token-2022)
        const tokenProgramId = await getTokenProgramId(connection, tokenMintPk);
        console.log(
          `[ConsignPage] Using token program: ${tokenProgramId.toString()}`,
        );

        // Get consigner's token ATA
        const consignerTokenAta = await getAssociatedTokenAddress(
          tokenMintPk,
          consignerPk,
          false,
          tokenProgramId,
        );

        // Ensure token is registered using shared utility
        console.log("[ConsignPage] Checking token registration...");
        const signTx = signTransaction as <T extends anchor.web3.Transaction>(
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
          console.log(`[ConsignPage] Token registered: ${regResult.signature}`);
        } else {
          console.log("[ConsignPage] Token already registered");
        }

        // Ensure desk token treasury exists using shared utility
        console.log("[ConsignPage] Checking desk treasury...");
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
          console.log(
            `[ConsignPage] Desk treasury created: ${treasuryResult.signature}`,
          );
        }

        // Generate consignment keypair (required as signer in the program)
        const consignmentKeypair = Keypair.generate();

        // Convert amounts to raw values
        const rawAmount = new anchor.BN(
          Math.floor(parseFloat(formData.amount) * 10 ** decimals).toString(),
        );
        const rawMinDeal = new anchor.BN(
          Math.floor(
            parseFloat(formData.minDealAmount) * 10 ** decimals,
          ).toString(),
        );
        const rawMaxDeal = new anchor.BN(
          Math.floor(
            parseFloat(formData.maxDealAmount) * 10 ** decimals,
          ).toString(),
        );

        // Call createConsignment instruction - build tx manually to avoid WebSocket confirmation
        // Build the transaction (don't use .rpc() as it uses WebSocket confirmation)
        const tx = await program.methods
          .createConsignment(
            rawAmount,
            formData.isNegotiable,
            formData.fixedDiscountBps,
            formData.fixedLockupDays,
            formData.minDiscountBps,
            formData.maxDiscountBps,
            formData.minLockupDays,
            formData.maxLockupDays,
            rawMinDeal,
            rawMaxDeal,
            formData.isFractionalized,
            formData.isPrivate,
            formData.maxPriceVolatilityBps,
            new anchor.BN(formData.maxTimeToExecuteSeconds),
          )
          .accounts({
            desk: desk,
            consigner: consignerPk,
            tokenMint: tokenMintPk,
            consignerTokenAta: consignerTokenAta,
            deskTokenTreasury: deskTokenTreasury,
            consignment: consignmentKeypair.publicKey,
            tokenProgram: tokenProgramId, // Token or Token-2022
            systemProgram: SolSystemProgram.programId,
          })
          .transaction();

        // Set recent blockhash and fee payer
        const { blockhash } = await connection.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
        tx.feePayer = consignerPk;

        // Sign with consignment keypair first
        tx.partialSign(consignmentKeypair);

        // Sign with wallet
        const signedTx = await signTransaction(tx);

        // Send raw transaction (skipPreflight=false for better error messages)
        const txSignature = await connection.sendRawTransaction(
          signedTx.serialize(),
          {
            skipPreflight: false,
            preflightCommitment: "confirmed",
          },
        );

        // Confirm using polling (avoids WebSocket)
        await confirmTransactionPolling(connection, txSignature, "confirmed");

        // Notify that tx was submitted (Solana confirms fast so this is immediate)
        if (onTxSubmitted) {
          onTxSubmitted(txSignature);
        }

        return {
          txHash: txSignature,
          consignmentId: consignmentKeypair.publicKey.toString(),
        };
      }

      // EVM path
      // FAIL-FAST: Validate EVM-specific requirements
      if (!rawTokenAddress) {
        throw new Error("Token address not found for EVM consignment");
      }
      if (!/^0x[a-fA-F0-9]{40}$/.test(rawTokenAddress)) {
        throw new Error(`Invalid EVM token address format: ${rawTokenAddress}`);
      }

      // FAIL-FAST: Validate chain is a valid EVM chain
      if (
        tokenChain !== "ethereum" &&
        tokenChain !== "base" &&
        tokenChain !== "bsc"
      ) {
        throw new Error(
          `Invalid EVM chain: ${tokenChain}. Must be ethereum, base, or bsc`,
        );
      }
      const chain = tokenChain as Chain;

      // FAIL-FAST: Validate tokenId
      if (!formData.tokenId) {
        throw new Error("Token ID is required for EVM consignment");
      }

      // FAIL-FAST: Validate selectedToken
      if (!selectedToken) {
        throw new Error("Selected token is required for EVM consignment");
      }
      if (!selectedToken.symbol) {
        throw new Error("Token symbol is required for EVM consignment");
      }

      let currentGasDeposit = gasDeposit;
      if (!currentGasDeposit) {
        console.log(
          `[ConsignPage] Gas deposit not cached, fetching for chain: ${chain}...`,
        );
        currentGasDeposit = await getRequiredGasDeposit(chain);
        console.log(
          "[ConsignPage] Gas deposit fetched:",
          currentGasDeposit.toString(),
        );
      }
      if (!currentGasDeposit) {
        throw new Error("Gas deposit is required but not available");
      }

      // Convert human-readable amounts to raw amounts with decimals
      const rawAmount = BigInt(
        Math.floor(parseFloat(formData.amount) * 10 ** decimals),
      );
      const rawMinDeal = BigInt(
        Math.floor(parseFloat(formData.minDealAmount) * 10 ** decimals),
      );
      const rawMaxDeal = BigInt(
        Math.floor(parseFloat(formData.maxDealAmount) * 10 ** decimals),
      );

      // FAIL-FAST: Validate amounts are positive
      if (rawAmount <= 0n) {
        throw new Error("Consignment amount must be greater than 0");
      }
      if (rawMinDeal <= 0n) {
        throw new Error("Minimum deal amount must be greater than 0");
      }
      if (rawMaxDeal < rawMinDeal) {
        throw new Error("Maximum deal amount must be >= minimum deal amount");
      }

      console.log(`[ConsignPage] Creating consignment on chain: ${chain}`);

      const result = await createConsignmentOnChain(
        {
          tokenId: formData.tokenId,
          tokenSymbol: selectedToken.symbol,
          tokenAddress: rawTokenAddress,
          amount: rawAmount,
          isNegotiable: formData.isNegotiable,
          fixedDiscountBps: formData.fixedDiscountBps,
          fixedLockupDays: formData.fixedLockupDays,
          minDiscountBps: formData.minDiscountBps,
          maxDiscountBps: formData.maxDiscountBps,
          minLockupDays: formData.minLockupDays,
          maxLockupDays: formData.maxLockupDays,
          minDealAmount: rawMinDeal,
          maxDealAmount: rawMaxDeal,
          isFractionalized: formData.isFractionalized,
          isPrivate: formData.isPrivate,
          maxPriceVolatilityBps: formData.maxPriceVolatilityBps,
          maxTimeToExecute: formData.maxTimeToExecuteSeconds,
          gasDeposit: currentGasDeposit,
          selectedPoolAddress: formData.selectedPoolAddress,
          chain: chain,
        },
        onTxSubmitted,
      );

      return {
        txHash: result.txHash,
        consignmentId: result.consignmentId.toString(),
      };
    },
    [
      activeFamily,
      solanaWallet,
      solanaPublicKey,
      rawTokenAddress,
      selectedToken,
      formData,
      gasDeposit,
      createConsignmentOnChain,
      getRequiredGasDeposit,
      tokenChain,
    ],
  );

  return (
    <main className="flex-1 px-3 sm:px-4 md:px-6 py-4 sm:py-6 md:py-8 overflow-y-auto">
      <div className="max-w-3xl mx-auto pb-8">
        {/* Header with wallet info */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold">List Your Tokens</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Sell at a discount with a lockup period
            </p>
          </div>
          {hasWallet && currentAddress && (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800">
                <WalletAvatar address={currentAddress} size={20} />
                <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  {displayAddress}
                </span>
              </div>
              {!isFarcasterContext && (
                <button
                  onClick={disconnect}
                  className="w-8 h-8 flex items-center justify-center text-lg font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-full transition-colors"
                >
                  ×
                </button>
              )}
            </div>
          )}
        </div>

        {/* Progress indicator */}
        <div className="mb-6">
          <div className="flex gap-2 mb-2">
            {[1, 2, 3, 4].map((s) => (
              <div
                key={s}
                className={`flex-1 h-1.5 rounded-full transition-colors ${
                  s <= step ? "bg-brand-500" : "bg-zinc-200 dark:bg-zinc-800"
                }`}
              />
            ))}
          </div>
          <div className="flex justify-between text-xs text-zinc-500">
            {STEP_LABELS.map((label, idx) => (
              <span
                key={label}
                className={step === idx + 1 ? "text-brand-500 font-medium" : ""}
              >
                {label}
              </span>
            ))}
          </div>
        </div>

        {/* Form steps - no scroll container, content flows naturally */}
        <div>
          {step === 1 && (
            <TokenSelectionStep
              formData={formData}
              updateFormData={updateFormData}
              onNext={handleNext}
              onTokenSelect={handleTokenSelect}
            />
          )}
          {step === 2 && (
            <FormStep
              formData={formData}
              updateFormData={updateFormData}
              onNext={handleNext}
              onBack={handleBack}
              selectedTokenBalance={selectedToken?.balance}
              selectedTokenDecimals={selectedToken?.decimals}
              selectedTokenSymbol={selectedToken?.symbol}
              selectedTokenLogoUrl={selectedToken?.logoUrl}
            />
          )}
          {step === 3 && (
            <ReviewStep
              formData={formData}
              onBack={handleBack}
              onNext={handleNext}
              requiredChain={requiredChain}
              isConnectedToRequiredChain={isConnectedToRequiredChain}
              onConnect={() => handleConnect(requiredChain || undefined)}
              privyReady={privyReady}
              selectedTokenSymbol={selectedToken?.symbol}
              selectedTokenDecimals={selectedToken?.decimals}
              selectedTokenLogoUrl={selectedToken?.logoUrl}
            />
          )}
          {step === 4 &&
            (() => {
              // FAIL-FAST: selectedToken required for submission
              if (!selectedToken) {
                return null;
              }
              // Token type requires decimals, symbol, and name - always exist when selectedToken exists
              const decimals = selectedToken.decimals;
              const symbol = selectedToken.symbol;
              return (
                <SubmissionStepComponent
                  formData={formData}
                  consignerAddress={(() => {
                    // FAIL-FAST: Consigner address is required for consignment creation
                    if (activeFamily === "solana") {
                      if (!solanaPublicKey) {
                        throw new Error(
                          "Solana wallet address is required for consignment creation",
                        );
                      }
                      return solanaPublicKey;
                    } else {
                      if (!evmAddress) {
                        throw new Error(
                          "EVM wallet address is required for consignment creation",
                        );
                      }
                      return evmAddress;
                    }
                  })()}
                  chain={
                    tokenChain ||
                    (activeFamily === "solana" ? "solana" : "base")
                  }
                  activeFamily={activeFamily}
                  selectedTokenDecimals={decimals}
                  selectedTokenSymbol={symbol}
                  selectedTokenName={selectedToken.name}
                  selectedTokenAddress={selectedToken.contractAddress}
                  selectedTokenLogoUrl={selectedToken.logoUrl}
                  onApproveToken={handleApproveToken}
                  onCreateConsignment={handleCreateConsignment}
                  getBlockExplorerUrl={getBlockExplorerUrl}
                  onBack={handleBack}
                />
              );
            })()}
        </div>
      </div>
    </main>
  );
}
