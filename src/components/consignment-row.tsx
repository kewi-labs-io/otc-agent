"use client";

import { useEffect, useState, useMemo } from "react";
import Image from "next/image";
import type { OTCConsignment } from "@/services/database";
import { Button } from "./button";
import { useOTC } from "@/hooks/contracts/useOTC";
import { useAccount, useChainId } from "wagmi";
import { useTokenCache } from "@/hooks/useTokenCache";
import { SUPPORTED_CHAINS, isSolanaChain, type Chain } from "@/config/chains";
import { useMultiWallet } from "./multiwallet";

// Solana imports
import type { Idl, Wallet } from "@coral-xyz/anchor";
import * as anchor from "@coral-xyz/anchor";
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  Connection,
  PublicKey as SolPubkey,
  Transaction,
  Keypair,
} from "@solana/web3.js";

// Solana config
const SOLANA_RPC = SUPPORTED_CHAINS.solana.rpcUrl;
const SOLANA_DESK = SUPPORTED_CHAINS.solana.contracts.otc;

async function fetchSolanaIdl(): Promise<Idl> {
  const res = await fetch("/api/solana/idl");
  if (!res.ok) throw new Error("Failed to load Solana IDL");
  return (await res.json()) as Idl;
}

interface ConsignmentRowProps {
  consignment: OTCConsignment;
  onUpdate?: () => void;
}

export function ConsignmentRow({ consignment, onUpdate }: ConsignmentRowProps) {
  // Use shared token cache - deduplicates requests across components
  const { token, isLoading: isLoadingToken } = useTokenCache(consignment.tokenId);
  
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

  // Check chain compatibility for withdrawal
  const consignmentChain = consignment.chain as Chain;
  const isSolana = isSolanaChain(consignmentChain);
  const chainConfig = SUPPORTED_CHAINS[consignmentChain];
  
  // For EVM chains, check if wallet is on the correct chain
  const isOnCorrectChain = useMemo(() => {
    if (isSolana) return false;
    if (!chainConfig?.chainId) return false;
    return chainId === chainConfig.chainId;
  }, [isSolana, chainConfig, chainId]);

  // Only truly blocking reasons disable the button
  const withdrawDisabledReason = useMemo(() => {
    if (isSolana) {
      if (!solanaPublicKey) return "Connect Solana wallet";
      if (!solanaWallet?.signTransaction) return "Solana wallet not ready";
      if (!consignment.contractConsignmentId) return "Not deployed on-chain";
      return null;
    }
    if (!address) return "Connect wallet";
    if (!consignment.contractConsignmentId) return "Not deployed on-chain";
    return null;
  }, [isSolana, solanaPublicKey, solanaWallet, address, consignment.contractConsignmentId]);

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

  // Extract token info from tokenId as fallback (format: token-{chain}-{address})
  // Don't show the contract address as symbol - that's confusing
  const tokenSymbol = token?.symbol || "TOKEN";
  const tokenDecimals = token?.decimals ?? 18;

  const formatAmount = (amount: string) => {
    const num = Number(amount) / Math.pow(10, tokenDecimals);
    if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(2)}K`;
    return num.toFixed(2);
  };

  const percentRemaining =
    (Number(consignment.remainingAmount) / Number(consignment.totalAmount)) *
    100;

  const handleWithdraw = async () => {
    setWithdrawError(null);
    setWithdrawTxHash(null);

    if (isSolana) {
      // Solana withdrawal path
      if (!solanaPublicKey || !solanaWallet?.signTransaction || !consignment.contractConsignmentId) {
        setWithdrawError("Solana wallet not connected or ready");
        return;
      }

      if (
        !confirm(
          `Withdraw ${formatAmount(consignment.remainingAmount)} ${tokenSymbol} from the smart contract?\n\nYou will pay the transaction fee.`,
        )
      )
        return;

      setIsWithdrawing(true);

      try {
        const connection = new Connection(SOLANA_RPC, "confirmed");
        
        if (!SOLANA_DESK) {
          throw new Error("SOLANA_DESK not configured");
        }

        // Fetch IDL and create program
        const idl = await fetchSolanaIdl();
        const desk = new SolPubkey(SOLANA_DESK);
        const consignmentPubkey = new SolPubkey(consignment.contractConsignmentId);
        const consignerPk = new SolPubkey(solanaPublicKey);

        // Adapt wallet to Anchor's Wallet interface
        type SignableTransaction = Transaction;
        const signTransaction = solanaWallet.signTransaction as (
          tx: SignableTransaction,
        ) => Promise<SignableTransaction>;

        const anchorWallet: Wallet = {
          publicKey: consignerPk,
          signTransaction: signTransaction as Wallet["signTransaction"],
          signAllTransactions: solanaWallet.signAllTransactions as Wallet["signAllTransactions"],
          payer: Keypair.generate(), // Not used for signing, just satisfies type
        };

        const provider = new anchor.AnchorProvider(connection, anchorWallet, {
          commitment: "confirmed",
        });

        const program = new anchor.Program(idl, provider);

        // Fetch consignment to get token mint
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const programAccounts = program.account as any;
        const consignmentData = await programAccounts.consignment.fetch(
          consignmentPubkey,
        );

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

        // Get consigner's token ATA (must exist to receive tokens)
        const consignerTokenAta = await getAssociatedTokenAddress(
          tokenMintPk,
          consignerPk,
          false,
        );

        // Verify consigner ATA exists (SPL Token program requires it for transfers)
        const consignerAtaInfo = await connection.getAccountInfo(consignerTokenAta);
        if (!consignerAtaInfo) {
          throw new Error("Your token account does not exist. You need to have a token account for this token to receive the withdrawal.");
        }

        // Get desk's token treasury
        const deskTokenTreasury = await getAssociatedTokenAddress(
          tokenMintPk,
          desk,
          true, // allowOwnerOffCurve - desk is a PDA
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
            deskSigner: desk, // Desk public key - API will add signature via partialSign
            consigner: consignerPk,
            deskTokenTreasury: deskTokenTreasury,
            consignerTokenAta: consignerTokenAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .transaction();

        // Set recent blockhash and fee payer
        const { blockhash } = await connection.getLatestBlockhash("confirmed");
        tx.recentBlockhash = blockhash;
        tx.feePayer = consignerPk;

        // Sign with user wallet (consigner signature)
        console.log("[ConsignmentRow] Signing transaction with consigner wallet...");
        const signedTx = await signTransaction(tx);
        console.log("[ConsignmentRow] Transaction signed by consigner");

        // Send to API to add desk signature and submit
        const signedTxBase64 = signedTx.serialize({ requireAllSignatures: false }).toString("base64");

        const apiResponse = await fetch("/api/solana/withdraw-consignment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            consignmentAddress: consignment.contractConsignmentId,
            consignerAddress: solanaPublicKey,
            signedTransaction: signedTxBase64,
          }),
        });

        if (!apiResponse.ok) {
          const errorData = await apiResponse.json();
          throw new Error(errorData.error || "Withdrawal failed");
        }

        const { signature } = await apiResponse.json();
        setWithdrawTxHash(signature);

        // Update database status after successful on-chain withdrawal
        const response = await fetch(
          `/api/consignments/${consignment.id}?callerAddress=${encodeURIComponent(solanaPublicKey)}`,
          {
            method: "DELETE",
          },
        );

        if (!response.ok) {
          console.warn(
            "[ConsignmentRow] Failed to update database, but withdrawal succeeded on-chain",
          );
          setIsWithdrawn(true);
          setWithdrawError(
            "Withdrawal successful on-chain, but database update failed. Your tokens are in your wallet.",
          );
        } else {
          setIsWithdrawn(true);
        }

        setTimeout(() => {
          if (onUpdate) onUpdate();
        }, 500);
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";

        if (
          errorMessage.includes("rejected") ||
          errorMessage.includes("denied") ||
          errorMessage.includes("User rejected")
        ) {
          setWithdrawError("Transaction was rejected.");
        } else {
          setWithdrawError(`Withdrawal failed: ${errorMessage}`);
        }
      } finally {
        setIsWithdrawing(false);
      }
    } else {
      // EVM withdrawal path
      if (!address || !consignment.contractConsignmentId) return;

      if (
        !confirm(
          `Withdraw ${formatAmount(consignment.remainingAmount)} ${tokenSymbol} from the smart contract?\n\nYou will pay the gas fee for this transaction.`,
        )
      )
        return;

      setIsWithdrawing(true);

      try {
        // Switch chain if needed - wallet handles the prompt
        if (!isOnCorrectChain) {
          await switchToChain(consignmentChain);
        }

        const contractConsignmentId = BigInt(consignment.contractConsignmentId);

        // Execute on-chain withdrawal (user pays gas)
        const txHash = await withdrawConsignment(contractConsignmentId);
        setWithdrawTxHash(txHash as string);

        // Update database status after successful on-chain withdrawal
        const response = await fetch(
          `/api/consignments/${consignment.id}?callerAddress=${encodeURIComponent(address)}`,
          {
            method: "DELETE",
          },
        );

        if (!response.ok) {
          console.warn(
            "[ConsignmentRow] Failed to update database, but withdrawal succeeded on-chain",
          );
          setIsWithdrawn(true);
          setWithdrawError(
            "Withdrawal successful on-chain, but database update failed. Your tokens are in your wallet.",
          );
        } else {
          setIsWithdrawn(true);
        }

        setTimeout(() => {
          if (onUpdate) onUpdate();
        }, 500);
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";

        if (
          errorMessage.includes("rejected") ||
          errorMessage.includes("denied")
        ) {
          setWithdrawError("Transaction was rejected.");
        } else {
          setWithdrawError(`Withdrawal failed: ${errorMessage}`);
        }
      } finally {
        setIsWithdrawing(false);
      }
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
          {token?.logoUrl ? (
            <Image
              src={token.logoUrl}
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
            <p className="text-sm text-zinc-500 truncate">
              {token?.name || "Token"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 items-center flex-shrink-0 sm:ml-auto">
          {/* Chain badge */}
          <span className={`inline-flex items-center rounded-full px-2 sm:px-3 py-1 text-xs font-medium ${
            isSolana 
              ? "bg-purple-500/10 text-purple-700 dark:text-purple-400"
              : "bg-blue-500/10 text-blue-700 dark:text-blue-400"
          }`}>
            {chainConfig?.name || consignmentChain}
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
              {isWithdrawing ? "Withdrawing..." : withdrawDisabledReason || "Withdraw"}
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
