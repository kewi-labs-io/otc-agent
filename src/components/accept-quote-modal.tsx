"use client";

import { Button } from "@/components/button";
import { Dialog } from "@/components/dialog";
import { useMultiWallet } from "@/components/multiwallet";
import { NetworkConnectButton } from "@/components/network-connect";
import otcArtifact from "@/contracts/artifacts/contracts/OTC.sol/OTC.json";
import { useOTC } from "@/hooks/contracts/useOTC";
import type { OTCQuote } from "@/utils/xml-parser";
import type { Idl } from "@coral-xyz/anchor";
import * as anchor from "@coral-xyz/anchor";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey as SolPubkey,
  SystemProgram as SolSystemProgram,
} from "@solana/web3.js";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { Abi } from "viem";
import { createPublicClient, http } from "viem";
import { base, hardhat } from "viem/chains";
import { useAccount, useBalance, useChainId, useSignMessage } from "wagmi";

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

const ONE_MILLION = 1_000_000; // Token cap
const MIN_TOKENS = 100; // UX minimum

export function AcceptQuoteModal({
  isOpen,
  onClose,
  initialQuote,
  onComplete,
}: AcceptQuoteModalProps) {
  const { isConnected, address } = useAccount();
  const { activeFamily, isConnected: unifiedConnected } = useMultiWallet();
  const chainId = useChainId();
  const router = useRouter();
  const {
    otcAddress,
    createOffer,
    defaultUnlockDelaySeconds,
    usdcAddress,
    maxTokenPerOrder,
    fulfillOffer,
    approveUsdc,
    getRequiredPayment,
  } = useOTC();

  const { signMessageAsync } = useSignMessage();

  const abi = useMemo(() => otcArtifact.abi as Abi, []);
  const rpcUrl =
    (process.env.NEXT_PUBLIC_RPC_URL as string | undefined) ||
    "http://127.0.0.1:8545";
  const chain = chainId === hardhat.id ? hardhat : base;
  const publicClient = useMemo(
    () => createPublicClient({ chain, transport: http(rpcUrl) }),
    [chain, rpcUrl],
  );

  // Local UI state
  const [tokenAmount, setTokenAmount] = useState<number>(
    Math.min(
      ONE_MILLION,
      Math.max(
        MIN_TOKENS,
        initialQuote?.tokenAmount ? Number(initialQuote.tokenAmount) : 1000,
      ),
    ),
  );
  const [currency, setCurrency] = useState<"ETH" | "USDC" | "SOL">(
    activeFamily === "solana" ? "SOL" : "ETH",
  );
  const [step, setStep] = useState<StepState>("amount");
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requireApprover, setRequireApprover] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_lastSignedMessage, setLastSignedMessage] = useState<
    string | undefined
  >(undefined);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_lastSignature, setLastSignature] = useState<
    `0x${string}` | undefined
  >(undefined);
  const isSolanaActive = activeFamily === "solana";
  const SOLANA_RPC =
    (process.env.NEXT_PUBLIC_SOLANA_RPC_URL as string | undefined) ||
    "http://127.0.0.1:8899";
  const SOLANA_PROGRAM_ID =
    (process.env.NEXT_PUBLIC_SOLANA_PROGRAM_ID as string | undefined) ||
    "8X2wDShtcJ5mFrcsJPjK8tQCD16zBqzsUGwhSCM4ggko";
  const SOLANA_DESK = process.env.NEXT_PUBLIC_SOLANA_DESK as string | undefined;
  const SOLANA_DESK_OWNER = process.env.NEXT_PUBLIC_SOLANA_DESK_OWNER as string | undefined;
  const SOLANA_TOKEN_MINT = process.env.NEXT_PUBLIC_SOLANA_TOKEN_MINT as string | undefined;
  const SOLANA_USDC_MINT = process.env.NEXT_PUBLIC_SOLANA_USDC_MINT as string | undefined;

  // Wallet balances for display and MAX calculation
  const ethBalance = useBalance({ address });
  const usdcBalance = useBalance({ address, token: usdcAddress as any });

  useEffect(() => {
    if (!isOpen) {
      setStep("amount");
      setIsProcessing(false);
      setError(null);
      setCurrency(activeFamily === "solana" ? "SOL" : "ETH");
      setTokenAmount(
        Math.min(
          ONE_MILLION,
          Math.max(
            MIN_TOKENS,
            initialQuote?.tokenAmount ? Number(initialQuote.tokenAmount) : 1000,
          ),
        ),
      );
    }
  }, [isOpen, initialQuote, activeFamily]);

  // Prefer EVM when both are connected and modal opens
  useEffect(() => {
    try {
      const isOpenNow = isOpen;
      if (!isOpenNow) return;
      // If both connected, prefer EVM
      if (activeFamily === "solana") {
        // Keep currency coherent with active family
        setCurrency("SOL");
      }
    } catch {}
  }, [isOpen, activeFamily]);

  // Read approver-only mode flag
  useEffect(() => {
    (async () => {
      try {
        if (!isOpen || !otcAddress) return;
        const flag = (await publicClient.readContract({
          address: otcAddress as `0x${string}`,
          abi,
          functionName: "requireApproverToFulfill",
          args: [],
        } as any)) as boolean;
        setRequireApprover(Boolean(flag));
      } catch {}
    })();
  }, [isOpen, otcAddress, publicClient, abi]);

  const discountBps = useMemo(() => {
    const fromQuote = initialQuote?.discountBps;
    if (typeof fromQuote === "number" && !Number.isNaN(fromQuote)) {
      return fromQuote;
    }
    // Fallback 10% discount
    return 1000;
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
    try {
      const v = maxTokenPerOrder
        ? Number(maxTokenPerOrder / 10n ** 18n)
        : ONE_MILLION;
      return Math.max(MIN_TOKENS, Math.min(ONE_MILLION, v));
    } catch {
      return ONE_MILLION;
    }
  }, [maxTokenPerOrder]);

  const clampAmount = (value: number) =>
    Math.min(contractMaxTokens, Math.max(MIN_TOKENS, Math.floor(value)));

  async function fetchSolanaIdl(): Promise<Idl> {
    const res = await fetch("/api/solana/idl");
    if (!res.ok) throw new Error("Failed to load Solana IDL");
    return (await res.json()) as Idl;
  }

  async function readNextOfferId(): Promise<bigint> {
    if (!otcAddress) throw new Error("Missing OTC address");
    const id = (await publicClient.readContract({
      address: otcAddress as `0x${string}`,
      abi,
      functionName: "nextOfferId",
      args: [],
    } as any)) as bigint;
    return id;
  }

  async function readOffer(offerId: bigint): Promise<any> {
    if (!otcAddress) throw new Error("Missing OTC address");
    return (await publicClient.readContract({
      address: otcAddress as `0x${string}`,
      abi,
      functionName: "offers",
      args: [offerId],
    } as any)) as any;
  }

  async function wait(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function fulfillWithRetry(
    offerId: bigint,
  ): Promise<`0x${string}` | undefined> {
    // Check if already fulfilled
    const offer = await readOffer(offerId);
    const isPaid = offer[9];
    const isFulfilled = offer[10];

    if (isPaid || isFulfilled) {
      console.log("[AcceptQuote] Offer already fulfilled");
      return undefined;
    }

    // Get required payment amount from contract
    const isEth = currency === "ETH";
    const requiredAmount = await getRequiredPayment(
      offerId,
      isEth ? "ETH" : "USDC",
    );

    if (!requiredAmount) {
      throw new Error("Could not determine required payment amount");
    }

    console.log(
      `[AcceptQuote] Required payment: ${requiredAmount} ${currency}`,
    );

    try {
      let txHash: `0x${string}` | undefined;

      if (isEth) {
        // Pay with ETH (direct from user wallet via MetaMask)
        console.log("[AcceptQuote] Fulfilling with ETH...");
        txHash = (await fulfillOffer(offerId, requiredAmount)) as `0x${string}`;
      } else {
        // Pay with USDC (need to approve first)
        console.log("[AcceptQuote] Approving USDC allowance...");
        await approveUsdc(requiredAmount);

        console.log("[AcceptQuote] Fulfilling with USDC...");
        txHash = (await fulfillOffer(offerId)) as `0x${string}`;
      }

      // Wait for transaction to be mined
      if (txHash) {
        console.log(
          "[AcceptQuote] Waiting for transaction to be mined:",
          txHash,
        );
        await publicClient.waitForTransactionReceipt({ hash: txHash });
        console.log("[AcceptQuote] Transaction mined");
      } else {
        // Fallback: wait and check
        await wait(3000);
      }

      // Verify fulfillment
      const finalOffer = await readOffer(offerId);
      // Offer tuple: [beneficiary, tokenAmount, discountBps, createdAt, unlockTime, priceUsdPerToken, ethUsdPrice, currency, approved, paid, fulfilled, cancelled, payer, amountPaid]
      const isPaid = finalOffer[9]; // paid flag is at index 9
      const isFulfilled = finalOffer[10]; // fulfilled flag is at index 10

      if (!(isPaid || isFulfilled)) {
        throw new Error(
          "Payment transaction completed but offer state not updated. Please refresh and try again.",
        );
      }

      console.log("[AcceptQuote] ✅ Offer fulfilled successfully");
      return txHash;
    } catch (error: any) {
      console.error("[AcceptQuote] Fulfillment error:", error);
      throw new Error(
        `Payment failed: ${error.message || "Unknown error"}. Please ensure you have sufficient balance.`,
      );
    }
  }

  const handleConfirm = async () => {
    if (!unifiedConnected) return;
    setError(null);
    setIsProcessing(true);
    setStep("creating");

    /**
     * TRANSACTION FLOW (Optimized for Security)
     * 
     * OLD FLOW (3 separate steps with risk):
     * 1. User creates offer → 2. Approver approves → 3. User pays
     * Problem: Offer can be approved but never paid (wasted approval, stuck state)
     * 
     * NEW FLOW (2 user transactions, approval happens between):
     * 1. User creates offer
     * 2. User pre-authorizes payment (USDC: approve allowance; ETH: verify funds)
     * 3. Backend approves offer (approver wallet)
     * 4. User payment executes IMMEDIATELY (minimized window)
     * 
     * Benefits:
     * - User commits to payment BEFORE approval happens
     * - Payment executes immediately after approval (atomic-like)
     * - Reduces risk of approved-but-unpaid offers
     * - Clear error messages if payment fails after approval
     * 
     * Contract constraint: fulfillOffer() requires o.approved == true
     * So we cannot pay before approval, but we CAN prepare payment first.
     */

    try {
      // Solana path
      if (isSolanaActive) {
        // Basic config checks
        if (!SOLANA_DESK || !SOLANA_TOKEN_MINT || !SOLANA_USDC_MINT) {
          throw new Error(
            "Solana OTC configuration is incomplete. Please check your environment variables.",
          );
        }

        const connection = new Connection(SOLANA_RPC, "confirmed");
        // @ts-ignore - wallet adapter injects window.solana
        const wallet = (globalThis as any).solana;
        if (!wallet?.publicKey) {
          throw new Error("Connect a Solana wallet to continue.");
        }

        const provider = new anchor.AnchorProvider(
          connection,
          // Anchor expects an object with signTransaction / signAllTransactions
          wallet,
          { commitment: "confirmed" },
        );
        const programId = new SolPubkey(SOLANA_PROGRAM_ID);
        const idl = await fetchSolanaIdl();
        const program = new (anchor as any).Program(
          idl as Idl,
          programId,
          provider,
        ) as any;

        // Use desk address from environment
        if (!SOLANA_DESK) {
          throw new Error("SOLANA_DESK address not configured in environment.");
        }
        const desk = new SolPubkey(SOLANA_DESK);
        const tokenMintPk = new SolPubkey(SOLANA_TOKEN_MINT);
        const usdcMintPk = SOLANA_USDC_MINT
          ? new SolPubkey(SOLANA_USDC_MINT)
          : undefined;
        const deskTokenTreasury = await getAssociatedTokenAddress(
          tokenMintPk,
          desk,
          true,
        );
        const deskUsdcTreasury = usdcMintPk
          ? await getAssociatedTokenAddress(usdcMintPk, desk, true)
          : undefined;

        // Read nextOfferId from desk account
        const deskAccount: any = await (program.account as any).desk.fetch(
          desk,
        );
        const nextOfferId = new anchor.BN(deskAccount.nextOfferId.toString());
        
        // Generate offer keypair (IDL expects signer)
        const offerKeypair = Keypair.generate();
        console.log("Generated offer keypair:", offerKeypair.publicKey.toString());

        // Create offer on Solana
        const tokenAmountWei = new anchor.BN(
          (BigInt(tokenAmount) * 10n ** 18n).toString(),
        );
        const lockupSeconds = new anchor.BN(lockupDays * 24 * 60 * 60);
        const paymentCurrencySol = currency === "USDC" ? 1 : 0; // 0 SOL, 1 USDC

        await program.methods
          .createOffer(
            tokenAmountWei,
            discountBps,
            paymentCurrencySol,
            lockupSeconds,
          )
          .accountsStrict({
            desk,
            deskTokenTreasury,
            beneficiary: wallet.publicKey,
            offer: offerKeypair.publicKey,
            systemProgram: SolSystemProgram.programId,
          })
          .signers([offerKeypair])
          .rpc();

        setStep("await_approval");
        // Poll for approval
        const start = Date.now();
        while (Date.now() - start < 90_000) {
          const off: any = await (program.account as any).offer.fetch(offerKeypair.publicKey);
          if (off.approved) break;
          await new Promise((r) => setTimeout(r, 2000));
        }

        setStep("paying");
        if (paymentCurrencySol === 0) {
          // Pay in SOL
          await program.methods
            .fulfillOfferSol(nextOfferId)
            .accounts({
              desk,
              offer: offerKeypair.publicKey,
              deskTokenTreasury,
              payer: wallet.publicKey,
              systemProgram: SolSystemProgram.programId,
            })
            .signers([])
            .rpc();
        } else {
          // Pay in USDC on Solana
          if (!usdcMintPk || !deskUsdcTreasury) {
            throw new Error("USDC mint/treasury not configured for Solana.");
          }
          const payerUsdcAta = await getAssociatedTokenAddress(
            usdcMintPk,
            wallet.publicKey,
            false,
          );
          await program.methods
            .fulfillOfferUsdc(nextOfferId)
            .accounts({
              desk,
              offer: offerKeypair.publicKey,
              deskTokenTreasury,
              deskUsdcTreasury,
              payerUsdcAta,
              payer: wallet.publicKey,
              tokenProgram: new SolPubkey(
                // spl-token program id
                "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
              ),
              systemProgram: SolSystemProgram.programId,
            })
            .signers([])
            .rpc();
        }

        setStep("complete");
        setIsProcessing(false);
        onComplete?.({ offerId: BigInt(nextOfferId.toString()) });
        return;
      }

      // Update quote with user's selected amount and currency before creating offer
      // Price will be determined by Chainlink oracle on-chain, so we don't calculate it here
      try {
        if (initialQuote?.quoteId) {
          console.log("[AcceptQuote] Updating quote with user selections:", {
            quoteId: initialQuote.quoteId,
            tokenAmount,
            paymentCurrency: currency,
            note: "Price will be determined by Chainlink oracle on-chain",
          });

          await fetch("/api/quote/latest", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              quoteId: initialQuote.quoteId,
              beneficiary: address,
              tokenAmount: String(tokenAmount),
              paymentCurrency: currency,
              totalUsd: 0, // Will be calculated on-chain
              discountUsd: 0, // Will be calculated on-chain
              discountedUsd: 0, // Will be calculated on-chain
              paymentAmount: "0", // Will be calculated on-chain
            }),
          });

          console.log("[AcceptQuote] ✅ Quote updated with user selections");
        }
      } catch (e) {
        console.error("[AcceptQuote] Failed to update quote:", e);
      }

      // Sign the terms for auditability
      const msg = `I agree to purchase ${tokenAmount} ElizaOS at ${(
        discountBps / 100
      ).toFixed(
        2,
      )}% discount with ${lockupDays} days lockup, paying in ${currency}. Wallet: ${address}`;
      try {
        const sig = await signMessageAsync({
          account: address as `0x${string}`,
          message: msg,
        });
        setLastSignedMessage(msg);
        setLastSignature(sig);
      } catch {
        // user may reject; continue without signature but record intent
      }

      // Determine new offer id ahead of time
      const nextId = await readNextOfferId();
      const newOfferId = nextId; // offerId will equal current nextOfferId

      // Step 1: Create offer (User transaction #1)
      console.log(`[AcceptQuote] Step 1/2: Creating offer ${newOfferId}...`);
      const tokenAmountWei = BigInt(tokenAmount) * 10n ** 18n;
      const lockupSeconds = BigInt(lockupDays * 24 * 60 * 60);
      const paymentCurrency = currency === "ETH" ? 0 : 1;
      await createOffer({
        tokenAmountWei,
        discountBps,
        paymentCurrency,
        lockupSeconds,
      });
      console.log(`[AcceptQuote] ✅ Offer created: ${newOfferId}`);

      // Step 2: Pre-authorize payment BEFORE requesting approval
      // This ensures user commits to paying before approver commits to approving
      setStep("paying");
      console.log(
        `[AcceptQuote] Step 2/2: Preparing payment (will execute after approval)...`,
      );

      // Pre-check: Calculate required payment and verify user has funds
      const isEth = currency === "ETH";
      const requiredAmount = await getRequiredPayment(
        newOfferId,
        isEth ? "ETH" : "USDC",
      );

      if (!requiredAmount) {
        throw new Error("Could not determine required payment amount");
      }

      console.log(
        `[AcceptQuote] Required payment: ${requiredAmount} ${currency}`,
      );

      // For USDC, pre-approve the allowance now (User transaction #2a if USDC)
      if (!isEth) {
        console.log("[AcceptQuote] Pre-approving USDC allowance...");
        await approveUsdc(requiredAmount);
        console.log("[AcceptQuote] ✅ USDC allowance approved");
      }

      // Now request approval from backend - with user already committed to pay
      setStep("await_approval");
      console.log(
        `[AcceptQuote] Requesting approval (user payment ready to execute)...`,
      );
      
      const approveRes = await fetch("/api/otc/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offerId: newOfferId.toString() }),
      });

      if (!approveRes.ok) {
        const errorText = await approveRes.text();
        throw new Error(`Approval failed: ${errorText}`);
      }

      const approveData = await approveRes.json();
      console.log(
        `[AcceptQuote] ✅ Offer approved:`,
        approveData.approvalTx || approveData.txHash,
      );

      // Immediately execute payment now that approval is done (User transaction #2 or #3)
      // This minimizes the window between approval and payment, reducing risk
      console.log(
        `[AcceptQuote] Executing payment immediately after approval...`,
      );

      let paymentTxHash: `0x${string}` | undefined;
      try {
        paymentTxHash = await fulfillWithRetry(newOfferId);
        console.log(`[AcceptQuote] ✅ Payment executed: ${paymentTxHash}`);
      } catch (paymentError: any) {
        // Critical: Approval happened but payment failed
        // The offer is now approved but not paid - this is the scenario we want to minimize
        console.error(`[AcceptQuote] ❌ CRITICAL: Payment failed after approval:`, paymentError);
        throw new Error(
          `Deal approved but payment failed: ${paymentError.message || "Unknown error"}. ` +
          `Offer ID ${newOfferId} is approved. You can retry payment from My Deals page.`
        );
      }

      // Notify backend of completion with user-selected amount for persistence
      try {
        if (initialQuote?.quoteId) {
          const response = await fetch("/api/deal-completion", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "complete",
              quoteId: initialQuote.quoteId,
              tokenAmount: String(tokenAmount),
              paymentCurrency: currency,
              offerId: String(newOfferId),
              transactionHash: paymentTxHash || "",
            }),
          });

          if (response.ok) {
            // Redirect to deal completion page for sharing
            setTimeout(() => {
              router.push(`/deal/${initialQuote.quoteId}`);
            }, 1500);
          }
        }
      } catch {}

      setStep("complete");
      setIsProcessing(false);

      onComplete?.({ offerId: newOfferId });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setIsProcessing(false);
      setStep("amount");
    }
  };

  // Price will be determined by Chainlink oracle on-chain
  // We use a placeholder for UI estimation only - actual price is fetched on-chain
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _estimatedUsd = useMemo(() => {
    // Cannot accurately estimate without on-chain oracle price
    // This is just for UI display, actual cost will be determined at execution
    return 0;
  }, []);

  const estPerTokenUsd = useMemo(() => {
    // Cannot accurately estimate without on-chain oracle price
    // This is just for UI display, actual cost will be determined at execution
    return 0;
  }, []);

  const balanceDisplay = useMemo(() => {
    if (!isConnected) return "—";
    if (currency === "USDC") {
      const v = Number(usdcBalance.data?.formatted || 0);
      return `${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    }
    const eth = Number(ethBalance.data?.formatted || 0);
    return `${eth.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
  }, [
    isConnected,
    currency,
    usdcBalance.data?.formatted,
    ethBalance.data?.formatted,
  ]);

  const handleMaxClick = () => {
    try {
      let maxByFunds = ONE_MILLION;
      if (currency === "USDC") {
        const usdc = Number(usdcBalance.data?.formatted || 0);
        if (estPerTokenUsd > 0) maxByFunds = Math.floor(usdc / estPerTokenUsd);
      } else {
        const eth = Number(ethBalance.data?.formatted || 0);
        const ethUsd = initialQuote?.ethPrice || 0;
        if (ethUsd > 0 && estPerTokenUsd > 0) {
          const usd = eth * ethUsd;
          maxByFunds = Math.floor(usd / estPerTokenUsd);
        }
      }
      setTokenAmount(clampAmount(maxByFunds));
    } catch {
      setTokenAmount(ONE_MILLION);
    }
  };

  // Validation: enforce token amount limits (USD check will happen on-chain)
  const validationError = useMemo(() => {
    if (tokenAmount < MIN_TOKENS) {
      return `Order too small. Minimum is ${MIN_TOKENS.toLocaleString()} tokens.`;
    }
    if (tokenAmount > contractMaxTokens) {
      return `Amount exceeds maximum of ${contractMaxTokens.toLocaleString()} tokens.`;
    }
    return null;
  }, [tokenAmount, contractMaxTokens]);

  // Cannot estimate payment without on-chain oracle price
  // Actual payment amount will be calculated when offer is created on-chain
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _estimatedPayment = useMemo(() => {
    return { usdc: undefined, eth: undefined } as const;
  }, []);

  // Cannot check for insufficient funds without knowing the final price
  // User will see error at transaction time if they don't have enough
  const insufficientFunds = useMemo(() => {
    return false;
  }, []);

  return (
    <Dialog open={isOpen} onClose={onClose} data-testid="accept-quote-modal">
      <div className="w-[min(720px,92vw)] mx-auto p-0 overflow-hidden rounded-2xl bg-zinc-950 text-white ring-1 ring-white/10">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5">
          <div className="text-lg font-semibold tracking-wide">Your Quote</div>
          <div className="flex items-center gap-3 text-sm">
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
                setCurrency(activeFamily === "solana" ? "SOL" : "ETH")
              }
            >
              {activeFamily === "solana" ? "SOL" : "ETH"}
            </button>
          </div>
          {/* Solana now supported */}
        </div>

        {/* Main amount card */}
        <div className="m-5 rounded-xl bg-zinc-900 ring-1 ring-white/10">
          <div className="flex items-center justify-between px-5 pt-4">
            <div className="text-sm text-zinc-400">Amount to Buy</div>
            <div className="flex items-center gap-3 text-sm text-zinc-400">
              <span>Balance: {balanceDisplay}</span>
              <button
                type="button"
                className="text-orange-400 hover:text-orange-300 font-medium"
                onClick={handleMaxClick}
              >
                MAX
              </button>
            </div>
          </div>
          <div className="px-5 pb-2">
            <div className="flex items-center justify-between gap-3">
              <input
                data-testid="token-amount-input"
                type="number"
                value={tokenAmount}
                onChange={(e) =>
                  setTokenAmount(clampAmount(Number(e.target.value)))
                }
                min={MIN_TOKENS}
                max={ONE_MILLION}
                className="w-full bg-transparent border-none outline-none text-5xl sm:text-6xl font-extrabold tracking-tight text-white"
              />
              <div className="flex items-center gap-2 text-right">
                <div className="h-9 w-9 rounded-full bg-orange-500/10 flex items-center justify-center">
                  <span className="text-orange-400 text-lg">₣</span>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold">$ElizaOS</div>
                  <div className="text-xs text-zinc-500">{`Balance: ${balanceDisplay}`}</div>
                </div>
              </div>
            </div>
            <div className="mt-2">
              <input
                data-testid="token-amount-slider"
                type="range"
                min={MIN_TOKENS}
                max={ONE_MILLION}
                value={tokenAmount}
                onChange={(e) =>
                  setTokenAmount(clampAmount(Number(e.target.value)))
                }
                className="w-full accent-orange-500"
              />
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div className="px-5 pb-1">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 text-sm">
            <div>
              <div className="text-zinc-500">Your Discount</div>
              <div className="text-lg font-semibold">
                {(discountBps / 100).toFixed(0)}%
              </div>
            </div>
            <div>
              <div className="text-zinc-500">Maturity</div>
              <div className="text-lg font-semibold">
                {Math.round(lockupDays / 30)} months
              </div>
            </div>
            <div>
              <div className="text-zinc-500">Maturity date</div>
              <div className="text-lg font-semibold">
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
              <div className="text-zinc-500">Price per Token</div>
              <div className="text-lg font-semibold text-zinc-400">
                On-chain
              </div>
            </div>
          </div>
        </div>

        {requireApprover && (
          <div className="px-5 pb-1 text-xs text-zinc-400">
            Payment will be executed by the desk&apos;s whitelisted approver
            wallet on your behalf after approval.
          </div>
        )}

        {(error || validationError || insufficientFunds) && (
          <div className="px-5 pt-2 text-xs text-red-400">
            {error ||
              validationError ||
              (insufficientFunds
                ? `Insufficient ${currency} balance for this purchase.`
                : null)}
          </div>
        )}

        {/* Actions / Connect state */}
        {!unifiedConnected ? (
          <div className="px-5 pb-5">
            <div className="rounded-xl overflow-hidden ring-1 ring-white/10 bg-zinc-900">
              <div className="relative">
                <div className="relative aspect-[16/9] w-full bg-gradient-to-br from-zinc-900 to-zinc-800">
                  <div
                    aria-hidden
                    className="absolute inset-0 opacity-30 bg-no-repeat bg-right-bottom"
                    style={{
                      backgroundImage: "url('/business.png')",
                      backgroundSize: "contain",
                    }}
                  />
                  <div className="relative z-10 h-full w-full flex flex-col items-center justify-center text-center px-6">
                    <h3 className="text-xl font-semibold text-white tracking-tight mb-2">
                      Connect Wallet
                    </h3>
                    <p className="text-zinc-300 text-sm mb-4">
                      Get discounted ElizaOS tokens. Let’s deal, anon.
                    </p>
                    <div className="inline-flex gap-2">
                      <NetworkConnectButton className="!h-9">
                        Connect
                      </NetworkConnectButton>
                    </div>
                  </div>
                </div>
              </div>
              <div className="p-4 text-xs text-zinc-400">
                Connect a wallet to continue and complete your purchase.
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 mt-4">
              <Button
                onClick={onClose}
                color="dark"
                className="bg-zinc-800 text-white border-zinc-700"
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-3 px-5 py-5">
            <Button
              onClick={onClose}
              color="dark"
              className="bg-zinc-800 text-white border-zinc-700"
            >
              <div className="px-4 py-2">Cancel</div>
            </Button>
            <Button
              data-testid="confirm-amount-button"
              onClick={handleConfirm}
              color="orange"
              className="bg-orange-600 border-orange-700 hover:brightness-110"
              disabled={
                Boolean(validationError) || insufficientFunds || isProcessing
              }
            >
              <div className="px-4 py-2">
                {isSolanaActive ? "Buy Now" : "Buy Now"}
              </div>
            </Button>
          </div>
        )}

        {/* Progress states */}
        {step === "creating" && (
          <div className="px-5 pb-6">
            <div className="text-center py-6">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500 mx-auto mb-4"></div>
              <h3 className="font-semibold mb-2">
                Step 1/2: Creating Offer
              </h3>
              <p className="text-sm text-zinc-400">
                Confirm the transaction in your wallet to create your offer on-chain.
              </p>
            </div>
          </div>
        )}

        {step === "paying" && (
          <div className="px-5 pb-6">
            <div className="text-center py-6">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500 mx-auto mb-4"></div>
              <h3 className="font-semibold mb-2">
                Step 2/2: Authorizing Payment
              </h3>
              <p className="text-sm text-zinc-400">
                {currency === "USDC" 
                  ? "Approve USDC spending in your wallet. Payment will execute after approval."
                  : "Preparing payment. Will execute immediately after approval."}
              </p>
            </div>
          </div>
        )}

        {step === "await_approval" && (
          <div className="px-5 pb-6">
            <div className="text-center py-6">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-500 mx-auto mb-4"></div>
              <h3 className="font-semibold mb-2">Finalizing Deal</h3>
              <p className="text-sm text-zinc-400">
                Payment authorized. Waiting for approval, then payment will execute automatically.
              </p>
              <p className="text-xs text-zinc-500 mt-2">
                This usually takes a few seconds...
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
              <h3 className="font-semibold mb-2">All Set!</h3>
              <p className="text-sm text-zinc-400">
                Your offer has been paid. You’ll receive the claimable tokens at
                maturity.
              </p>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
