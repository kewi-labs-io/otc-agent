"use client";

import { useState } from "react";
import { useMultiWallet } from "../multiwallet";
import { Button } from "../button";
import { Copy, Check, ArrowLeft, AlertCircle } from "lucide-react";
import { useOTC } from "@/hooks/contracts/useOTC";
import { useAccount } from "wagmi";
import { SubmissionModal } from "./submission-modal";
// Solana imports
import type { Idl, Wallet } from "@coral-xyz/anchor";
import * as anchor from "@coral-xyz/anchor";
import {
  getAssociatedTokenAddress,
  createApproveInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey as SolPubkey,
  SystemProgram as SolSystemProgram,
  Transaction,
} from "@solana/web3.js";
import { SUPPORTED_CHAINS } from "@/config/chains";

// Solana config from chains.ts (falls back to deployment config)
const SOLANA_RPC = SUPPORTED_CHAINS.solana.rpcUrl;
const SOLANA_DESK = SUPPORTED_CHAINS.solana.contracts.otc;

interface ReviewStepProps {
  formData: {
    tokenId: string;
    amount: string;
    isNegotiable: boolean;
    fixedDiscountBps: number;
    fixedLockupDays: number;
    minDiscountBps: number;
    maxDiscountBps: number;
    minLockupDays: number;
    maxLockupDays: number;
    minDealAmount: string;
    maxDealAmount: string;
    isFractionalized: boolean;
    isPrivate: boolean;
    maxPriceVolatilityBps: number;
    maxTimeToExecuteSeconds: number;
  };
  onBack: () => void;
  requiredChain?: "evm" | "solana" | null;
  isConnectedToRequiredChain?: boolean;
  onConnect?: () => void;
  privyReady?: boolean;
  selectedTokenSymbol?: string;
  selectedTokenDecimals?: number;
}

async function fetchSolanaIdl(): Promise<Idl> {
  const res = await fetch("/api/solana/idl");
  if (!res.ok) throw new Error("Failed to load Solana IDL");
  return (await res.json()) as Idl;
}

export function ReviewStep({
  formData,
  onBack,
  requiredChain,
  isConnectedToRequiredChain,
  onConnect,
  privyReady = true,
  selectedTokenSymbol = "TOKEN",
  selectedTokenDecimals = 18,
}: ReviewStepProps) {
  const { activeFamily, evmAddress, solanaPublicKey, solanaWallet } =
    useMultiWallet();
  const { address } = useAccount();
  const { createConsignmentOnChain, approveToken, getRequiredGasDeposit } =
    useOTC();
  const [copied, setCopied] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [tokenAddress, setTokenAddress] = useState<string | null>(null);
  const [gasDeposit, setGasDeposit] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Extract chain and address from tokenId (format: token-{chain}-{address})
  const getTokenInfo = (tokenId: string) => {
    const parts = tokenId?.split("-") || [];
    const chain = parts[1] || "";
    const address = parts.slice(2).join("-") || "";
    return { chain, address };
  };

  const { chain: tokenChain, address: rawTokenAddress } = getTokenInfo(
    formData.tokenId,
  );

  const getDisplayAddress = (addr: string) => {
    if (!addr || addr.length <= 12) return addr;
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const handleCopyToken = async () => {
    await navigator.clipboard.writeText(rawTokenAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getBlockExplorerUrl = (txHash: string) => {
    if (tokenChain === "solana") {
      return `https://solscan.io/tx/${txHash}`;
    }
    if (tokenChain === "bsc") {
      return `https://bscscan.com/tx/${txHash}`;
    }
    return `https://basescan.org/tx/${txHash}`;
  };

  const handleOpenModal = async () => {
    setError(null);
    const consignerAddress =
      activeFamily === "solana" ? solanaPublicKey : evmAddress;

    if (!consignerAddress) {
      setError("Please connect your wallet before creating a consignment");
      console.error("[ReviewStep] No consigner address - wallet not connected");
      return;
    }

    if (!formData.tokenId) {
      setError("Please select a token first");
      console.error("[ReviewStep] No tokenId selected");
      return;
    }

    if (!formData.amount) {
      setError("Please enter an amount");
      console.error("[ReviewStep] No amount entered");
      return;
    }

    if (activeFamily === "evm" && !address) {
      setError("Please connect your EVM wallet");
      console.error("[ReviewStep] EVM wallet not connected");
      return;
    }

    if (activeFamily === "solana" && !solanaPublicKey) {
      setError("Please connect your Solana wallet");
      console.error("[ReviewStep] Solana wallet not connected");
      return;
    }

    // Pre-fetch token information for EVM chains
    if (activeFamily !== "solana") {
      // Token address comes directly from tokenId (format: token-{chain}-{address})
      if (!rawTokenAddress) {
        setError("Token address not found in tokenId");
        console.error(
          "[ReviewStep] No token address in tokenId:",
          formData.tokenId,
        );
        return;
      }

      setIsLoading(true);
      try {
        console.log(
          "[ReviewStep] Using token address from tokenId:",
          rawTokenAddress,
        );
        setTokenAddress(rawTokenAddress);

        console.log("[ReviewStep] Fetching gas deposit requirement...");
        const fetchedGasDeposit = await getRequiredGasDeposit();
        console.log("[ReviewStep] Gas deposit:", fetchedGasDeposit?.toString());

        setGasDeposit(fetchedGasDeposit);
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Unknown error";
        console.error(
          "[ReviewStep] Failed to fetch gas deposit:",
          errorMessage,
        );
        // Use a default gas deposit if the RPC call fails
        console.log("[ReviewStep] Using default gas deposit of 0.001 ETH");
        setGasDeposit(BigInt(1000000000000000)); // 0.001 ETH default
      }
      setIsLoading(false);
    }

    setIsModalOpen(true);
  };

  const handleApproveToken = async (): Promise<string> => {
    // Solana path - approve is done as part of the transaction
    if (activeFamily === "solana") {
      // For Solana, we'll handle approval in the createConsignment call
      // Return a placeholder since Solana uses delegated authority differently
      return "solana-approval-pending";
    }

    // EVM path
    if (!tokenAddress) throw new Error("Token address not found");
    // Convert human-readable amount to raw amount with decimals
    const rawAmount = BigInt(
      Math.floor(
        parseFloat(formData.amount) * Math.pow(10, selectedTokenDecimals),
      ),
    );
    const txHash = await approveToken(tokenAddress as `0x${string}`, rawAmount);
    return txHash as string;
  };

  const handleCreateConsignment = async (): Promise<{
    txHash: string;
    consignmentId: string;
  }> => {
    // Solana path
    if (activeFamily === "solana") {
      if (!SOLANA_DESK) {
        throw new Error("SOLANA_DESK address not configured in environment.");
      }
      if (!solanaWallet || !solanaWallet.publicKey) {
        throw new Error("Connect a Solana wallet to continue.");
      }
      if (!rawTokenAddress) {
        throw new Error("Token address not found");
      }

      const connection = new Connection(SOLANA_RPC, "confirmed");

      // Adapt our wallet adapter to Anchor's Wallet interface
      const anchorWallet = {
        publicKey: new SolPubkey(solanaWallet.publicKey.toBase58()),
        signTransaction: solanaWallet.signTransaction,
        signAllTransactions: solanaWallet.signAllTransactions,
      } as Wallet;

      const provider = new anchor.AnchorProvider(connection, anchorWallet, {
        commitment: "confirmed",
      });

      console.log("[ReviewStep] Fetching Solana IDL...");
      const idl = await fetchSolanaIdl();
      console.log("[ReviewStep] IDL loaded, creating program...");
      const program = new anchor.Program(idl, provider);

      const desk = new SolPubkey(SOLANA_DESK);
      const tokenMintPk = new SolPubkey(rawTokenAddress);
      const consignerPk = new SolPubkey(solanaWallet.publicKey.toBase58());

      console.log("[ReviewStep] Token mint:", tokenMintPk.toString());
      console.log("[ReviewStep] Desk:", desk.toString());
      console.log("[ReviewStep] Consigner:", consignerPk.toString());

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
        true, // allowOwnerOffCurve for PDA
      );

      console.log("[ReviewStep] Consigner ATA:", consignerTokenAta.toString());
      console.log("[ReviewStep] Desk Treasury:", deskTokenTreasury.toString());

      // Generate consignment keypair (required as signer in the program)
      const consignmentKeypair = Keypair.generate();
      console.log(
        "[ReviewStep] Consignment keypair:",
        consignmentKeypair.publicKey.toString(),
      );

      // Convert amounts to raw values
      const rawAmount = new anchor.BN(
        Math.floor(
          parseFloat(formData.amount) * Math.pow(10, selectedTokenDecimals),
        ).toString(),
      );
      const rawMinDeal = new anchor.BN(
        Math.floor(
          parseFloat(formData.minDealAmount) *
            Math.pow(10, selectedTokenDecimals),
        ).toString(),
      );
      const rawMaxDeal = new anchor.BN(
        Math.floor(
          parseFloat(formData.maxDealAmount) *
            Math.pow(10, selectedTokenDecimals),
        ).toString(),
      );

      console.log("[ReviewStep] Creating consignment on Solana...");
      console.log("[ReviewStep] Amount:", rawAmount.toString());
      console.log("[ReviewStep] Min deal:", rawMinDeal.toString());
      console.log("[ReviewStep] Max deal:", rawMaxDeal.toString());

      // Call createConsignment instruction
      const txSignature = await program.methods
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

      console.log("[ReviewStep] Solana transaction signature:", txSignature);

      // The consignment ID is the public key of the consignment account
      return {
        txHash: txSignature,
        consignmentId: consignmentKeypair.publicKey.toString(),
      };
    }

    // EVM path
    if (!gasDeposit) throw new Error("Gas deposit not calculated");

    // Convert human-readable amounts to raw amounts with decimals
    const rawAmount = BigInt(
      Math.floor(
        parseFloat(formData.amount) * Math.pow(10, selectedTokenDecimals),
      ),
    );
    const rawMinDeal = BigInt(
      Math.floor(
        parseFloat(formData.minDealAmount) *
          Math.pow(10, selectedTokenDecimals),
      ),
    );
    const rawMaxDeal = BigInt(
      Math.floor(
        parseFloat(formData.maxDealAmount) *
          Math.pow(10, selectedTokenDecimals),
      ),
    );

    const result: { txHash: `0x${string}`; consignmentId: bigint } =
      await createConsignmentOnChain({
        tokenId: formData.tokenId,
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
        gasDeposit,
      });

    return {
      txHash: result.txHash,
      consignmentId: result.consignmentId.toString(),
    };
  };

  const formatAmount = (amount: string) => {
    const num = parseFloat(amount) || 0;
    return num.toLocaleString();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center pb-4 border-b border-zinc-200 dark:border-zinc-700">
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Review Your Listing
        </h3>
        <p className="text-sm text-zinc-500">
          Confirm the details before creating
        </p>
      </div>

      {/* Token Info */}
      <div className="flex items-center gap-3 p-4 rounded-xl bg-gradient-to-br from-orange-500/10 to-amber-500/10 border border-orange-500/20">
        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-orange-400 to-amber-500 flex items-center justify-center">
          <span className="text-white font-bold text-lg">
            {selectedTokenSymbol.charAt(0)}
          </span>
        </div>
        <div className="flex-1">
          <p className="font-semibold text-lg text-zinc-900 dark:text-zinc-100">
            {formatAmount(formData.amount)} {selectedTokenSymbol}
          </p>
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500 font-mono">
              {getDisplayAddress(rawTokenAddress)}
            </span>
            <button
              onClick={handleCopyToken}
              className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors"
              title="Copy token address"
            >
              {copied ? (
                <Check className="w-3 h-3 text-green-600" />
              ) : (
                <Copy className="w-3 h-3 text-zinc-400" />
              )}
            </button>
          </div>
        </div>
        <div className="px-2 py-1 rounded-full bg-zinc-200 dark:bg-zinc-700 text-xs font-medium text-zinc-600 dark:text-zinc-400 uppercase">
          {tokenChain}
        </div>
      </div>

      {/* Details Grid */}
      <div className="grid gap-3">
        <div className="flex justify-between items-center p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50">
          <span className="text-zinc-600 dark:text-zinc-400">Pricing Type</span>
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            {formData.isNegotiable ? "Negotiable" : "Fixed Price"}
          </span>
        </div>

        {formData.isNegotiable ? (
          <>
            <div className="flex justify-between items-center p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50">
              <span className="text-zinc-600 dark:text-zinc-400">
                Discount Range
              </span>
              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                {formData.minDiscountBps / 100}% –{" "}
                {formData.maxDiscountBps / 100}%
              </span>
            </div>
            <div className="flex justify-between items-center p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50">
              <span className="text-zinc-600 dark:text-zinc-400">
                Lockup Range
              </span>
              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                {formData.minLockupDays} – {formData.maxLockupDays} days
              </span>
            </div>
          </>
        ) : (
          <>
            <div className="flex justify-between items-center p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50">
              <span className="text-zinc-600 dark:text-zinc-400">Discount</span>
              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                {formData.fixedDiscountBps / 100}%
              </span>
            </div>
            <div className="flex justify-between items-center p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50">
              <span className="text-zinc-600 dark:text-zinc-400">Lockup</span>
              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                {formData.fixedLockupDays} days
              </span>
            </div>
          </>
        )}

        {formData.isFractionalized && (
          <div className="flex justify-between items-center p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50">
            <span className="text-zinc-600 dark:text-zinc-400">Deal Size</span>
            <span className="font-medium text-zinc-900 dark:text-zinc-100">
              {formatAmount(formData.minDealAmount)} –{" "}
              {formatAmount(formData.maxDealAmount)} {selectedTokenSymbol}
            </span>
          </div>
        )}

        <div className="flex justify-between items-center p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50">
          <span className="text-zinc-600 dark:text-zinc-400">
            Fractionalized
          </span>
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            {formData.isFractionalized ? "Yes" : "No"}
          </span>
        </div>

        <div className="flex justify-between items-center p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50">
          <span className="text-zinc-600 dark:text-zinc-400">Visibility</span>
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            {formData.isPrivate ? "Private" : "Public"}
          </span>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-4">
        <Button
          onClick={onBack}
          className="flex items-center gap-2 px-6 py-3 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-xl transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>
        {formData.tokenId && requiredChain && !isConnectedToRequiredChain ? (
          <Button
            onClick={onConnect}
            disabled={!privyReady}
            className={`flex-1 py-3 text-white font-medium rounded-xl ${
              requiredChain === "solana"
                ? "bg-gradient-to-br from-[#9945FF] to-[#14F195] hover:opacity-90"
                : "bg-gradient-to-br from-blue-600 to-blue-800 hover:opacity-90"
            }`}
          >
            {privyReady
              ? `Connect ${requiredChain === "solana" ? "Solana" : "EVM"} Wallet`
              : "Loading..."}
          </Button>
        ) : (
          <Button
            onClick={handleOpenModal}
            disabled={isLoading}
            className="flex-1 py-3 bg-orange-500 hover:bg-orange-600 disabled:bg-orange-400 disabled:cursor-wait text-white font-medium rounded-xl transition-colors"
          >
            {isLoading ? "Loading..." : "Create Listing"}
          </Button>
        )}
      </div>

      {/* Submission Modal */}
      <SubmissionModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        formData={formData}
        consignerAddress={
          activeFamily === "solana" ? solanaPublicKey || "" : evmAddress || ""
        }
        chain={tokenChain || (activeFamily === "solana" ? "solana" : "base")}
        activeFamily={activeFamily}
        selectedTokenDecimals={selectedTokenDecimals}
        onApproveToken={handleApproveToken}
        onCreateConsignment={handleCreateConsignment}
        getBlockExplorerUrl={getBlockExplorerUrl}
      />
    </div>
  );
}
