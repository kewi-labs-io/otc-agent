"use client";

// Solana imports
import type { Wallet } from "@coral-xyz/anchor";
import * as anchor from "@coral-xyz/anchor";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { PublicKey as SolPubkey, type Transaction } from "@solana/web3.js";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { useAccount, useChainId } from "wagmi";
import { type Chain, isSolanaChain, SUPPORTED_CHAINS } from "@/config/chains";
import { useOTC } from "@/hooks/contracts/useOTC";
import {
  useSolanaWithdrawConsignment,
  useWithdrawConsignment,
} from "@/hooks/mutations";
import { useToken } from "@/hooks/useToken";
import type { OTCConsignment } from "@/services/database";
// Shared Solana OTC utilities
import { formatRawTokenAmount } from "@/utils/format";
import {
  createSolanaConnection,
  fetchSolanaIdl,
  getTokenProgramId,
  SOLANA_DESK,
  SOLANA_RPC,
} from "@/utils/solana-otc";
import { Button } from "./button";
import { useMultiWallet } from "./multiwallet";

interface ConsignmentRowProps {
  consignment: OTCConsignment;
  onUpdate?: () => void;
}

export function ConsignmentRow({ consignment, onUpdate }: ConsignmentRowProps) {
  // Use React Query for token data - automatic caching and deduplication
  const { token, isLoading: isLoadingToken } = useToken(consignment.tokenId);

  const [dealCount, setDealCount] = useState<number>(0);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [withdrawTxHash, setWithdrawTxHash] = useState<string | null>(null);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [isWithdrawn, setIsWithdrawn] = useState(
    consignment.status === "withdrawn",
  );
  const { withdrawConsignment, switchToChain } = useOTC();
  const { address } = useAccount();
  const chainId = useChainId();
  const { solanaPublicKey, solanaWallet } = useMultiWallet();

  // Mutation hooks for withdrawal operations
  const solanaWithdrawMutation = useSolanaWithdrawConsignment();
  const evmWithdrawMutation = useWithdrawConsignment();

  // Check chain compatibility for withdrawal
  const consignmentChain = consignment.chain as Chain;
  const isSolana = isSolanaChain(consignmentChain);

  // FAIL-FAST: chain must be valid Chain type, SUPPORTED_CHAINS guarantees ChainConfig exists
  if (!(consignmentChain in SUPPORTED_CHAINS)) {
    throw new Error(`Unsupported chain: ${consignmentChain}`);
  }
  const chainConfig = SUPPORTED_CHAINS[consignmentChain];

  // For EVM chains, check if wallet is on the correct chain
  const isOnCorrectChain = useMemo(() => {
    if (isSolana) return false;
    // FAIL-FAST: EVM chains must have chainId (optional in interface but required for EVM)
    if (chainConfig.chainId == null) {
      throw new Error(
        `Chain config missing chainId for EVM chain: ${consignmentChain}`,
      );
    }
    return chainId === chainConfig.chainId;
  }, [isSolana, chainConfig, chainId, consignmentChain]);

  // Only truly blocking reasons disable the button
  const withdrawDisabledReason = useMemo(() => {
    if (isSolana) {
      if (!solanaPublicKey) return "Connect Solana wallet";
      if (!solanaWallet) return "Solana wallet not connected";
      if (!solanaWallet.signTransaction) return "Solana wallet not ready";
      if (!consignment.contractConsignmentId) return "Not deployed on-chain";
      return null;
    }
    if (!address) return "Connect wallet";
    if (!consignment.contractConsignmentId) return "Not deployed on-chain";
    return null;
  }, [
    isSolana,
    solanaPublicKey,
    solanaWallet,
    address,
    consignment.contractConsignmentId,
  ]);

  // Calculate deal count based on sold amount (memoized)
  const calculatedDealCount = useMemo(() => {
    const totalAmount = BigInt(consignment.totalAmount);
    const remainingAmount = BigInt(consignment.remainingAmount);
    const soldAmount = totalAmount - remainingAmount;
    if (soldAmount > 0n && consignment.isFractionalized) {
      const avgDealSize =
        BigInt(consignment.minDealAmount) + BigInt(consignment.maxDealAmount);
      const estimatedDeals = Number(soldAmount / (avgDealSize / 2n));
      return Math.max(1, estimatedDeals);
    }
    return 0;
  }, [
    consignment.totalAmount,
    consignment.remainingAmount,
    consignment.isFractionalized,
    consignment.minDealAmount,
    consignment.maxDealAmount,
  ]);

  // Update dealCount when calculation changes
  useEffect(() => {
    setDealCount(calculatedDealCount);
  }, [calculatedDealCount]);

  const isWithdrawnStatus = isWithdrawn || consignment.status === "withdrawn";

  // Handle missing token gracefully - especially for withdrawn consignments
  // where the token may have been removed from the registry
  // Extract fallback info from tokenId (format: token-{chain}-{address})
  const tokenIdParts = consignment.tokenId.split("-");
  const fallbackSymbol =
    tokenIdParts.length >= 3
      ? `${tokenIdParts[2].slice(0, 6)}...` // Show truncated address
      : "UNKNOWN";

  // Use token data if available, otherwise use fallbacks
  const tokenSymbol = token?.symbol || fallbackSymbol;
  const tokenDecimals = token?.decimals ?? 18; // Default to 18 decimals
  const tokenName = token?.name || "Unknown Token";
  const tokenLogoUrl = token?.logoUrl;

  // formatAmount uses centralized formatRawTokenAmount from @/utils/format
  const formatAmount = (amount: string) =>
    formatRawTokenAmount(amount, tokenDecimals);

  const percentRemaining =
    (Number(consignment.remainingAmount) / Number(consignment.totalAmount)) *
    100;

  const handleWithdraw = async () => {
    setWithdrawError(null);
    setWithdrawTxHash(null);

    if (isSolana) {
      // FAIL-FAST: Validate all requirements for Solana withdrawal
      if (!solanaPublicKey) {
        setWithdrawError("Solana wallet not connected");
        return;
      }
      // FAIL-FAST: solanaWallet must exist and have signTransaction if we're attempting withdrawal
      if (!solanaWallet) {
        throw new Error(
          "Solana wallet adapter is null - component should not render withdrawal button without wallet",
        );
      }
      if (!solanaWallet.signTransaction) {
        throw new Error(
          "Solana wallet missing signTransaction method - invalid wallet adapter state",
        );
      }
      if (!consignment.contractConsignmentId) {
        setWithdrawError(
          "Consignment not deployed on-chain (missing contractConsignmentId)",
        );
        return;
      }
      if (!SOLANA_DESK) {
        setWithdrawError("SOLANA_DESK not configured in environment");
        return;
      }
      if (!SOLANA_RPC) {
        setWithdrawError("SOLANA_RPC not configured in environment");
        return;
      }

      if (
        !confirm(
          `Withdraw ${formatAmount(consignment.remainingAmount)} ${tokenSymbol} from the smart contract?\n\nYou will pay the transaction fee.`,
        )
      )
        return;

      setIsWithdrawing(true);

      // Use HTTP-only connection (no WebSocket) since we're using a proxy
      const connection = createSolanaConnection();

      // Fetch IDL and create program
      const idl = await fetchSolanaIdl();
      const desk = new SolPubkey(SOLANA_DESK);
      const consignmentPubkey = new SolPubkey(
        consignment.contractConsignmentId,
      );
      const consignerPk = new SolPubkey(solanaPublicKey);

      // Adapt wallet to Anchor's Wallet interface
      type SignableTransaction = Transaction;
      const signTransaction = solanaWallet.signTransaction as (
        tx: SignableTransaction,
      ) => Promise<SignableTransaction>;

      const anchorWallet = {
        publicKey: consignerPk,
        signTransaction: signTransaction as Wallet["signTransaction"],
        signAllTransactions:
          solanaWallet.signAllTransactions as Wallet["signAllTransactions"],
      } as Wallet;

      const provider = new anchor.AnchorProvider(connection, anchorWallet, {
        commitment: "confirmed",
      });

      const program = new anchor.Program(idl, provider);

      interface ConsignmentAccountProgram {
        consignment: {
          fetch: (pubkey: SolPubkey) => Promise<{
            consigner: SolPubkey;
            desk: SolPubkey;
            isActive: boolean;
            remainingAmount: { toString(): string };
            tokenMint: SolPubkey;
            id: { toString(): string };
          }>;
        };
      }

      const programAccounts = program.account as ConsignmentAccountProgram;
      const consignmentData =
        await programAccounts.consignment.fetch(consignmentPubkey);

      if (!consignmentData) {
        throw new Error("Consignment not found on-chain");
      }

      // Verify consignment belongs to expected desk
      if (consignmentData.desk.toString() !== desk.toString()) {
        throw new Error("Consignment does not belong to the expected desk");
      }

      // Verify consigner matches
      if (consignmentData.consigner.toString() !== solanaPublicKey) {
        throw new Error("You are not the consigner of this consignment");
      }

      // Verify consignment is active and has remaining amount
      if (!consignmentData.isActive) {
        throw new Error("Consignment is not active");
      }

      // consignmentData.remainingAmount is a BN, convert to string for comparison
      const remainingAmountStr = consignmentData.remainingAmount.toString();
      if (remainingAmountStr === "0") {
        throw new Error("Nothing to withdraw");
      }

      const tokenMintPk = new SolPubkey(consignmentData.tokenMint);

      // Detect token program (Token or Token-2022)
      const tokenProgramId = await getTokenProgramId(connection, tokenMintPk);
      console.log(
        `[ConsignmentRow] Using token program: ${tokenProgramId.toString()}`,
      );

      // Get consigner's token ATA (must exist to receive tokens)
      const consignerTokenAta = await getAssociatedTokenAddress(
        tokenMintPk,
        consignerPk,
        false,
        tokenProgramId,
      );

      // Verify consigner ATA exists (SPL Token program requires it for transfers)
      const consignerAtaInfo =
        await connection.getAccountInfo(consignerTokenAta);
      if (!consignerAtaInfo) {
        throw new Error(
          "Your token account does not exist. You need to have a token account for this token to receive the withdrawal.",
        );
      }

      // Get desk's token treasury
      const deskTokenTreasury = await getAssociatedTokenAddress(
        tokenMintPk,
        desk,
        true, // allowOwnerOffCurve - desk is a PDA
        tokenProgramId,
      );

      // Build withdrawal transaction
      // Note: The consignmentId argument is for logging/verification, the actual consignment is identified by the account
      const consignmentId = new anchor.BN(consignmentData.id.toString());

      console.log("[ConsignmentRow] Building withdrawal transaction:", {
        consignment: consignmentPubkey.toString(),
        consignmentId: consignmentId.toString(),
        consigner: consignerPk.toString(),
        desk: desk.toString(),
        tokenMint: tokenMintPk.toString(),
        remainingAmount: remainingAmountStr,
      });

      const tx = await program.methods
        .withdrawConsignment(consignmentId)
        .accounts({
          consignment: consignmentPubkey,
          desk: desk,
          tokenMint: tokenMintPk, // Required for TransferChecked
          deskSigner: desk, // Desk public key - API will add signature via partialSign
          consigner: consignerPk,
          deskTokenTreasury: deskTokenTreasury,
          consignerTokenAta: consignerTokenAta,
          tokenProgram: tokenProgramId, // Token or Token-2022
        })
        .transaction();

      // Set recent blockhash and fee payer
      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash;
      tx.feePayer = consignerPk;

      // Sign with user wallet (consigner signature)
      console.log(
        "[ConsignmentRow] Signing transaction with consigner wallet...",
      );
      const signedTx = await signTransaction(tx);
      console.log("[ConsignmentRow] Transaction signed by consigner");

      // Send to API to add desk signature and submit
      const signedTxBase64 = signedTx
        .serialize({ requireAllSignatures: false })
        .toString("base64");

      // Use mutation for API call - handles cache invalidation automatically
      const apiResult = await solanaWithdrawMutation.mutateAsync({
        consignmentAddress: consignment.contractConsignmentId,
        consignerAddress: solanaPublicKey,
        signedTransaction: signedTxBase64,
      });

      setWithdrawTxHash(apiResult.signature);

      // Update database status after successful on-chain withdrawal
      // Uses mutation for automatic cache invalidation
      await evmWithdrawMutation.mutateAsync({
        consignmentId: consignment.id,
        callerAddress: solanaPublicKey,
      });

      setIsWithdrawn(true);
      setTimeout(() => {
        if (onUpdate) onUpdate();
      }, 500);
      setIsWithdrawing(false);
    } else {
      // EVM withdrawal path
      // FAIL-FAST: Validate all requirements for EVM withdrawal
      if (!address) {
        setWithdrawError("EVM wallet not connected");
        return;
      }
      if (!consignment.contractConsignmentId) {
        setWithdrawError(
          "Consignment not deployed on-chain (missing contractConsignmentId)",
        );
        return;
      }

      if (
        !confirm(
          `Withdraw ${formatAmount(consignment.remainingAmount)} ${tokenSymbol} from the smart contract?\n\nYou will pay the gas fee for this transaction.`,
        )
      )
        return;

      setIsWithdrawing(true);

      // Switch chain if needed - wallet handles the prompt
      if (!isOnCorrectChain) {
        await switchToChain(consignmentChain);
      }

      const contractConsignmentId = BigInt(consignment.contractConsignmentId);

      // Execute on-chain withdrawal (user pays gas)
      const txHash = await withdrawConsignment(contractConsignmentId);
      setWithdrawTxHash(txHash as string);

      // Update database status after successful on-chain withdrawal
      // Uses mutation for automatic cache invalidation
      await evmWithdrawMutation.mutateAsync({
        consignmentId: consignment.id,
        callerAddress: address,
      });

      setIsWithdrawn(true);
      setTimeout(() => {
        if (onUpdate) onUpdate();
      }, 500);
      setIsWithdrawing(false);
    }
  };

  // Show skeleton while loading token data
  if (isLoadingToken) {
    return (
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 sm:p-6 animate-pulse">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="w-10 h-10 rounded-full bg-zinc-200 dark:bg-zinc-700 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="h-5 bg-zinc-200 dark:bg-zinc-700 rounded w-24 mb-2" />
              <div className="h-4 bg-zinc-200 dark:bg-zinc-700 rounded w-32" />
            </div>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <div className="h-6 bg-zinc-200 dark:bg-zinc-700 rounded-full w-20" />
            <div className="h-6 bg-zinc-200 dark:bg-zinc-700 rounded-full w-16" />
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i}>
              <div className="h-4 bg-zinc-200 dark:bg-zinc-700 rounded w-16 mb-1" />
              <div className="h-5 bg-zinc-200 dark:bg-zinc-700 rounded w-20" />
            </div>
          ))}
        </div>
        <div className="bg-zinc-200 dark:bg-zinc-700 rounded-full h-2" />
      </div>
    );
  }

  return (
    <div
      className={`rounded-lg border p-4 sm:p-6 ${isWithdrawnStatus ? "border-zinc-300 dark:border-zinc-700 opacity-60" : "border-zinc-200 dark:border-zinc-800"}`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {tokenLogoUrl ? (
            <Image
              src={tokenLogoUrl}
              alt={tokenSymbol}
              width={40}
              height={40}
              className="w-10 h-10 rounded-full flex-shrink-0"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-sm font-bold flex-shrink-0">
              {tokenSymbol.slice(0, 2)}
            </div>
          )}
          <div className="min-w-0">
            <h3 className="font-semibold truncate">{tokenSymbol}</h3>
            <p className="text-sm text-zinc-500 truncate">{tokenName}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 items-center flex-shrink-0 sm:ml-auto">
          {/* Chain badge */}
          <span
            className={`inline-flex items-center rounded-full px-2 sm:px-3 py-1 text-xs font-medium ${
              isSolana
                ? "bg-purple-500/10 text-purple-700 dark:text-purple-400"
                : "bg-blue-500/10 text-blue-700 dark:text-blue-400"
            }`}
          >
            {chainConfig ? chainConfig.name : consignmentChain}
          </span>
          {consignment.isNegotiable ? (
            <span className="inline-flex items-center rounded-full bg-blue-600/15 text-blue-700 dark:text-blue-400 px-2 sm:px-3 py-1 text-xs font-medium">
              Negotiable
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-zinc-500/10 text-zinc-700 dark:text-zinc-300 px-2 sm:px-3 py-1 text-xs font-medium">
              Fixed
            </span>
          )}
          <span
            className={`inline-flex items-center rounded-full px-2 sm:px-3 py-1 text-xs font-medium ${
              isWithdrawnStatus
                ? "bg-zinc-500/10 text-zinc-500"
                : consignment.status === "active"
                  ? "bg-brand-500/15 text-brand-600 dark:text-brand-400"
                  : "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300"
            }`}
          >
            {isWithdrawnStatus ? "Withdrawn" : consignment.status}
          </span>
          {!isWithdrawnStatus && (
            <Button
              color="red"
              onClick={handleWithdraw}
              disabled={isWithdrawing || !!withdrawDisabledReason}
              className="!py-2 !px-3 sm:!px-4 !text-xs"
              title={withdrawDisabledReason || "Withdraw remaining tokens"}
            >
              {isWithdrawing
                ? "Withdrawing..."
                : withdrawDisabledReason || "Withdraw"}
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <div>
          <div className="text-sm text-zinc-600 dark:text-zinc-400">Total</div>
          <div className="font-medium">
            {formatAmount(consignment.totalAmount)}
          </div>
        </div>
        <div>
          <div className="text-sm text-zinc-600 dark:text-zinc-400">
            Remaining
          </div>
          <div className="font-medium">
            {formatAmount(consignment.remainingAmount)}
          </div>
        </div>
        <div>
          <div className="text-sm text-zinc-600 dark:text-zinc-400">Deals</div>
          <div className="font-medium">{dealCount}</div>
        </div>
        <div>
          <div className="text-sm text-zinc-600 dark:text-zinc-400">% Sold</div>
          <div className="font-medium">
            {(100 - percentRemaining).toFixed(1)}%
          </div>
        </div>
      </div>

      {/* Withdrawal Status */}
      {(withdrawTxHash || withdrawError) && (
        <div className="mb-3">
          {withdrawTxHash && !withdrawError && (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
              <div className="flex items-center gap-2 text-green-800 dark:text-green-200">
                <svg
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                <span className="text-sm font-medium">
                  Withdrawal Successful
                </span>
              </div>
              <p className="text-xs text-green-700 dark:text-green-300 mt-1 break-all">
                Tx: {withdrawTxHash}
              </p>
            </div>
          )}
          {withdrawError && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <svg
                  className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <p className="text-sm text-red-800 dark:text-red-200">
                  {withdrawError}
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="bg-zinc-100 dark:bg-zinc-900 rounded-full h-2">
        <div
          className="bg-brand-500 rounded-full h-2"
          style={{ width: `${100 - percentRemaining}%` }}
        />
      </div>
    </div>
  );
}
