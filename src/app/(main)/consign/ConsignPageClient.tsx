"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useMultiWallet } from "@/components/multiwallet";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useOTC } from "@/hooks/contracts/useOTC";
import { useRenderTracker } from "@/utils/render-tracker";
import { WalletAvatar } from "@/components/wallet-avatar";
import type { TokenWithBalance } from "@/components/consignment-form/token-selection-step";
import type { Chain } from "@/config/chains";

// Solana imports
import type { Idl, Wallet } from "@coral-xyz/anchor";
import * as anchor from "@coral-xyz/anchor";
import { 
  getAssociatedTokenAddress, 
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey as SolPubkey,
  SystemProgram as SolSystemProgram,
} from "@solana/web3.js";
import { SUPPORTED_CHAINS } from "@/config/chains";

// Solana config
const SOLANA_RPC = SUPPORTED_CHAINS.solana.rpcUrl;
const SOLANA_DESK = SUPPORTED_CHAINS.solana.contracts.otc;

// Default gas deposit fallback (0.001 ETH) - used when RPC fetch fails
const DEFAULT_GAS_DEPOSIT = BigInt(1000000000000000);

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

async function fetchSolanaIdl(): Promise<Idl> {
  const res = await fetch("/api/solana/idl");
  if (!res.ok) throw new Error("Failed to load Solana IDL");
  return (await res.json()) as Idl;
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
  minDealAmount: "1000",
  maxDealAmount: "100000",
  isFractionalized: true,
  isPrivate: false,
  maxPriceVolatilityBps: 1000,
  maxTimeToExecuteSeconds: 1800,
};

// Extract chain and address from tokenId (format: token-{chain}-{address})
function getTokenInfo(tokenId: string) {
  const parts = tokenId?.split("-") || [];
  const chain = parts[1] || "";
  const address = parts.slice(2).join("-") || "";
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
    networkLabel,
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
  const { chain: tokenChain, address: rawTokenAddress } = useMemo(
    () => getTokenInfo(formData.tokenId),
    [formData.tokenId],
  );

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
      const chain = (tokenChain === "ethereum" || tokenChain === "base" || tokenChain === "bsc" ? tokenChain : "base") as Chain;
      console.log(`[ConsignPage] Fetching gas deposit for chain: ${chain}`);
      
      getRequiredGasDeposit(chain)
        .then((deposit) => {
          console.log(
            "[ConsignPage] Gas deposit fetched:",
            deposit?.toString(),
          );
          setGasDeposit(deposit);
        })
        .catch((err) => {
          console.error("[ConsignPage] Failed to fetch gas deposit:", err);
          setGasDeposit(DEFAULT_GAS_DEPOSIT);
        });
    }
  }, [step, activeFamily, rawTokenAddress, tokenChain, getRequiredGasDeposit]);

  const updateFormData = useCallback((updates: Partial<typeof formData>) => {
    setFormData((prev) => ({ ...prev, ...updates }));
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
    // Auto-set deal amounts based on token balance
    const humanBalance =
      Number(BigInt(token.balance)) / Math.pow(10, token.decimals);
    const minDeal = Math.max(1, Math.floor(humanBalance * 0.01));
    const maxDeal = Math.floor(humanBalance);
    setFormData((prev) => ({
      ...prev,
      minDealAmount: minDeal.toString(),
      maxDealAmount: maxDeal.toString(),
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
    if (!rawTokenAddress) throw new Error("Token address not found");
    const decimals = selectedToken?.decimals ?? 18;
    const rawAmount = BigInt(
      Math.floor(parseFloat(formData.amount) * Math.pow(10, decimals)),
    );
    
    // Pass the token's chain to ensure we use the correct OTC address
    // and switch to the correct chain if needed
    const chain = (tokenChain === "ethereum" || tokenChain === "base" || tokenChain === "bsc" ? tokenChain : "base") as Chain;
    console.log(`[ConsignPage] Approving token on chain: ${chain}`);
    
    const txHash = await approveToken(
      rawTokenAddress as `0x${string}`,
      rawAmount,
      chain,
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
      const decimals = selectedToken?.decimals ?? 18;

      // Solana path
      if (activeFamily === "solana") {
        if (!SOLANA_DESK) {
          throw new Error("SOLANA_DESK address not configured in environment.");
        }
        if (!solanaPublicKey) {
          throw new Error("Connect a Solana wallet to continue.");
        }
        if (!rawTokenAddress) {
          throw new Error("Token address not found");
        }

        const connection = new Connection(SOLANA_RPC, "confirmed");

        // Get wallet signing capabilities - either from adapter or directly from Privy
        type SignableTransaction = anchor.web3.Transaction;

        if (!solanaWallet?.signTransaction) {
          console.log("[ConsignPage] Solana wallet adapter not ready:", {
            solanaPublicKey,
            hasSolanaWallet: !!solanaWallet,
            hasSignTransaction: !!solanaWallet?.signTransaction,
          });
          throw new Error("Solana wallet is not ready for signing. Please ensure your wallet is connected and try again.");
        }

        console.log("[ConsignPage] Using Solana wallet adapter for signing");
        const signTransaction = solanaWallet.signTransaction as (tx: SignableTransaction) => Promise<SignableTransaction>;
        const signAllTransactions = solanaWallet.signAllTransactions as (txs: SignableTransaction[]) => Promise<SignableTransaction[]>;

        // Adapt to Anchor's Wallet interface
        const anchorWallet: Wallet = {
          publicKey: new SolPubkey(solanaPublicKey),
          signTransaction: signTransaction as Wallet["signTransaction"],
          signAllTransactions: signAllTransactions as Wallet["signAllTransactions"],
          payer: Keypair.generate(), // Not used for signing, just satisfies type
        };

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

        // Get consigner's token ATA
        const consignerTokenAta = await getAssociatedTokenAddress(
          tokenMintPk,
          consignerPk,
          false,
        );

        // Get desk's token treasury
        const deskTokenTreasury = await getAssociatedTokenAddress(
          tokenMintPk,
          desk,
          true, // allowOwnerOffCurve - desk is a PDA
        );

        // Derive the TokenRegistry PDA
        const [tokenRegistryPda] = SolPubkey.findProgramAddressSync(
          [Buffer.from("registry"), desk.toBuffer(), tokenMintPk.toBuffer()],
          program.programId,
        );

        // Check if token is registered, register if not
        const tokenRegistryInfo = await connection.getAccountInfo(tokenRegistryPda);
        if (!tokenRegistryInfo) {
          console.log("[ConsignPage] Token not registered, registering...");
          try {
            // Register with empty price feed (will use pool price or manual updates)
            const emptyPriceFeedId = new Array(32).fill(0) as number[];
            const noPoolAddress = SolPubkey.default;
            const poolTypeNone = 0;
            
            const registerTx = await program.methods
              .registerToken(emptyPriceFeedId, noPoolAddress, poolTypeNone)
              .accounts({
                desk: desk,
                payer: consignerPk,
                tokenMint: tokenMintPk,
                tokenRegistry: tokenRegistryPda,
                systemProgram: SolSystemProgram.programId,
              })
              .transaction();

            registerTx.feePayer = consignerPk;
            registerTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
            
            const signedRegisterTx = await signTransaction(registerTx);
            const registerSig = await connection.sendRawTransaction(signedRegisterTx.serialize());
            await connection.confirmTransaction(registerSig, "confirmed");
            console.log("[ConsignPage] Token registered:", registerSig);
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            if (errMsg.includes("rejected") || errMsg.includes("denied")) {
              throw new Error("Token registration was rejected. Please approve the transaction to continue.");
            }
            if (errMsg.includes("insufficient")) {
              throw new Error("Insufficient SOL to register token. Please add more SOL to your wallet.");
            }
            throw new Error(`Failed to register token: ${errMsg}`);
          }
        } else {
          console.log("[ConsignPage] Token already registered");
        }

        // Check if desk token treasury exists, create if not
        const treasuryAccountInfo = await connection.getAccountInfo(deskTokenTreasury);
        if (!treasuryAccountInfo) {
          console.log("[ConsignPage] Creating desk token treasury ATA...");
          try {
            const createAtaIx = createAssociatedTokenAccountInstruction(
              consignerPk,           // payer
              deskTokenTreasury,     // associatedToken
              desk,                  // owner
              tokenMintPk,           // mint
              TOKEN_PROGRAM_ID,
              ASSOCIATED_TOKEN_PROGRAM_ID,
            );
            
            const createAtaTx = new anchor.web3.Transaction().add(createAtaIx);
            createAtaTx.feePayer = consignerPk;
            createAtaTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
            
            const signedTx = await signTransaction(createAtaTx);
            const createAtaSig = await connection.sendRawTransaction(signedTx.serialize());
            await connection.confirmTransaction(createAtaSig, "confirmed");
            console.log("[ConsignPage] Desk token treasury created:", createAtaSig);
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            if (errMsg.includes("rejected") || errMsg.includes("denied")) {
              throw new Error("Token account creation was rejected. Please approve the transaction to continue.");
            }
            if (errMsg.includes("insufficient")) {
              throw new Error("Insufficient SOL to create token account. Please add more SOL to your wallet.");
            }
            throw new Error(`Failed to create token account: ${errMsg}`);
          }
        }

        // Generate consignment keypair (required as signer in the program)
        const consignmentKeypair = Keypair.generate();

        // Convert amounts to raw values
        const rawAmount = new anchor.BN(
          Math.floor(
            parseFloat(formData.amount) * Math.pow(10, decimals),
          ).toString(),
        );
        const rawMinDeal = new anchor.BN(
          Math.floor(
            parseFloat(formData.minDealAmount) * Math.pow(10, decimals),
          ).toString(),
        );
        const rawMaxDeal = new anchor.BN(
          Math.floor(
            parseFloat(formData.maxDealAmount) * Math.pow(10, decimals),
          ).toString(),
        );

        // Call createConsignment instruction
        let txSignature: string;
        try {
          txSignature = await program.methods
            .createConsignment(
              rawAmount,
              formData.isNegotiable,
              formData.fixedDiscountBps ?? 0,
              formData.fixedLockupDays ?? 0,
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
              tokenProgram: TOKEN_PROGRAM_ID,
              systemProgram: SolSystemProgram.programId,
            })
            .signers([consignmentKeypair])
            .rpc();
        } catch (err) {
          // Provide more helpful error messages for Solana failures
          const errMsg = err instanceof Error ? err.message : String(err);
          
          if (errMsg.includes("0x1")) {
            throw new Error("Insufficient token balance. Please ensure you have enough tokens to create this listing.");
          }
          if (errMsg.includes("insufficient lamports") || errMsg.includes("insufficient funds")) {
            throw new Error("Insufficient SOL for transaction fees. Please add more SOL to your wallet.");
          }
          if (errMsg.includes("rejected") || errMsg.includes("denied") || errMsg.includes("User rejected")) {
            throw new Error("Transaction was rejected in your wallet.");
          }
          if (errMsg.includes("blockhash") || errMsg.includes("expired")) {
            throw new Error("Transaction expired. Please try again.");
          }
          if (errMsg.includes("simulation failed")) {
            throw new Error("Transaction simulation failed. Please check your token balance and try again.");
          }
          
          // Re-throw with original message for unknown errors
          throw new Error(`Solana transaction failed: ${errMsg}`);
        }

        // Notify that tx was submitted (Solana confirms fast so this is immediate)
        if (onTxSubmitted) {
          onTxSubmitted(txSignature);
        }

        return {
          txHash: txSignature,
          consignmentId: consignmentKeypair.publicKey.toString(),
        };
      }

      // EVM path - use cached gas deposit or fetch with retry
      // Use the token's chain for fetching gas deposit
      const chain = (tokenChain === "ethereum" || tokenChain === "base" || tokenChain === "bsc" ? tokenChain : "base") as Chain;
      
      let currentGasDeposit = gasDeposit;
      if (!currentGasDeposit) {
        console.log(`[ConsignPage] Gas deposit not cached, fetching for chain: ${chain}...`);
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            currentGasDeposit = await getRequiredGasDeposit(chain);
            if (currentGasDeposit) {
              console.log(
                "[ConsignPage] Gas deposit fetched:",
                currentGasDeposit.toString(),
              );
              break;
            }
          } catch (err) {
            console.error("[ConsignPage] Gas deposit fetch failed:", err);
          }
          if (attempt < 2) {
            await new Promise((resolve) =>
              setTimeout(resolve, Math.pow(2, attempt) * 1000),
            );
          }
        }
        currentGasDeposit ??= DEFAULT_GAS_DEPOSIT;
      }

      // Convert human-readable amounts to raw amounts with decimals
      const rawAmount = BigInt(
        Math.floor(parseFloat(formData.amount) * Math.pow(10, decimals)),
      );
      const rawMinDeal = BigInt(
        Math.floor(parseFloat(formData.minDealAmount) * Math.pow(10, decimals)),
      );
      const rawMaxDeal = BigInt(
        Math.floor(parseFloat(formData.maxDealAmount) * Math.pow(10, decimals)),
      );

      console.log(`[ConsignPage] Creating consignment on chain: ${chain}`);

      const result = await createConsignmentOnChain(
        {
          tokenId: formData.tokenId,
          tokenSymbol: selectedToken?.symbol ?? "TOKEN",
          tokenAddress: rawTokenAddress ?? "",
          amount: rawAmount,
          isNegotiable: formData.isNegotiable,
          fixedDiscountBps: formData.fixedDiscountBps ?? 0,
          fixedLockupDays: formData.fixedLockupDays ?? 0,
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
      wallets,
      connectWallet,
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
          {step === 4 && (
            <SubmissionStepComponent
              formData={formData}
              consignerAddress={
                activeFamily === "solana"
                  ? solanaPublicKey || ""
                  : evmAddress || ""
              }
              chain={
                tokenChain || (activeFamily === "solana" ? "solana" : "base")
              }
              activeFamily={activeFamily}
              selectedTokenDecimals={selectedToken?.decimals ?? 18}
              selectedTokenSymbol={selectedToken?.symbol ?? "TOKEN"}
              selectedTokenName={selectedToken?.name}
              selectedTokenAddress={selectedToken?.contractAddress}
              selectedTokenLogoUrl={selectedToken?.logoUrl}
              onApproveToken={handleApproveToken}
              onCreateConsignment={handleCreateConsignment}
              getBlockExplorerUrl={getBlockExplorerUrl}
              onBack={handleBack}
            />
          )}
        </div>
      </div>
    </main>
  );
}
