"use client";

import { AlertCircle, ArrowLeft, Check, Copy } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { useChain, useWalletConnection } from "@/contexts";
import { usePoolCheck } from "@/hooks/usePoolCheck";
import { formatAddress, formatTokenAmountFull } from "@/utils/format";
import { parseTokenId } from "@/utils/token-utils";
import { Button } from "@/components/button";

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
  onNext: () => void;
  requiredChain?: "evm" | "solana" | null;
  isConnectedToRequiredChain?: boolean;
  onConnect?: () => void;
  privyReady?: boolean;
  selectedTokenSymbol?: string;
  selectedTokenDecimals?: number;
  selectedTokenLogoUrl?: string | null;
}

export function ReviewStep({
  formData,
  onBack,
  onNext,
  requiredChain,
  isConnectedToRequiredChain,
  onConnect,
  privyReady = true,
  selectedTokenSymbol = "TOKEN",
  selectedTokenLogoUrl,
}: ReviewStepProps) {
  const { activeFamily } = useChain();
  const { evmAddress, solanaPublicKey } = useWalletConnection();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logoError, setLogoError] = useState(false);

  const { chain: tokenChain, address: rawTokenAddress } = parseTokenId(formData.tokenId);

  // Use React Query for pool checking - automatic caching and deduplication
  const { poolCheck, isCheckingPool } = usePoolCheck(rawTokenAddress, tokenChain);

  // getDisplayAddress uses centralized formatAddress from @/utils/format
  const getDisplayAddress = (addr: string) => (addr ? formatAddress(addr) : "");

  const handleCopyToken = async () => {
    await navigator.clipboard.writeText(rawTokenAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleProceed = () => {
    setError(null);
    const consignerAddress = activeFamily === "solana" ? solanaPublicKey : evmAddress;

    if (!consignerAddress) {
      setError("Please connect your wallet before creating a consignment");
      return;
    }

    if (!formData.tokenId) {
      setError("Please select a token first");
      return;
    }

    if (!formData.amount) {
      setError("Please enter an amount");
      return;
    }

    // For EVM tokens, require a valid pool (blocking handled by button disabled state)
    if (tokenChain !== "solana" && poolCheck && !poolCheck.hasPool) {
      setError(
        "No liquidity pool found. This token needs a Uniswap V3/V4, Aerodrome, or Pancakeswap pool to be listed.",
      );
      return;
    }

    // Proceed to submission step
    onNext();
  };

  // formatAmount uses centralized formatTokenAmountFull from @/utils/format
  const formatAmount = (amount: string) => {
    const num = parseFloat(amount);
    return Number.isNaN(num) ? "0" : formatTokenAmountFull(num);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center pb-4">
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Review Your Listing
        </h3>
        <p className="text-sm text-zinc-500">Confirm the details before creating</p>
      </div>

      {/* Token Info */}
      <div className="flex items-center gap-3 p-4 rounded-xl bg-brand-500/5">
        {selectedTokenLogoUrl && !logoError ? (
          <Image
            src={selectedTokenLogoUrl}
            alt={selectedTokenSymbol}
            width={48}
            height={48}
            className="w-12 h-12 rounded-full"
            onError={() => setLogoError(true)}
          />
        ) : (
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-brand-400 to-brand-500 flex items-center justify-center">
            <span className="text-white font-bold text-lg">{selectedTokenSymbol.charAt(0)}</span>
          </div>
        )}
        <div className="flex-1">
          <p className="font-semibold text-lg text-zinc-900 dark:text-zinc-100">
            {formatAmount(formData.amount)} {selectedTokenSymbol}
          </p>
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500 font-mono">
              {getDisplayAddress(rawTokenAddress)}
            </span>
            <button
              type="button"
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
      <div className="grid gap-2">
        <div className="flex justify-between items-center p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/30">
          <span className="text-zinc-600 dark:text-zinc-400">Pricing Type</span>
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            {formData.isNegotiable ? "Negotiable" : "Fixed Price"}
          </span>
        </div>

        {formData.isNegotiable ? (
          <>
            <div className="flex justify-between items-center p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/30">
              <span className="text-zinc-600 dark:text-zinc-400">Discount Range</span>
              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                {formData.minDiscountBps / 100}% – {formData.maxDiscountBps / 100}%
              </span>
            </div>
            <div className="flex justify-between items-center p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/30">
              <span className="text-zinc-600 dark:text-zinc-400">Lockup Range</span>
              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                {formData.minLockupDays} – {formData.maxLockupDays} days
              </span>
            </div>
          </>
        ) : (
          <>
            <div className="flex justify-between items-center p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/30">
              <span className="text-zinc-600 dark:text-zinc-400">Discount</span>
              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                {formData.fixedDiscountBps / 100}%
              </span>
            </div>
            <div className="flex justify-between items-center p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/30">
              <span className="text-zinc-600 dark:text-zinc-400">Lockup</span>
              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                {formData.fixedLockupDays} days
              </span>
            </div>
          </>
        )}

        <div className="flex justify-between items-center p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/30">
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
        <Button onClick={onBack} color="dark" className="flex items-center gap-2 px-6 py-3">
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>
        {formData.tokenId && requiredChain && !isConnectedToRequiredChain ? (
          <Button
            onClick={onConnect}
            disabled={!privyReady}
            color={requiredChain === "solana" ? ("purple" as const) : ("blue" as const)}
            className="flex-1 py-3"
          >
            {privyReady
              ? `Connect ${requiredChain === "solana" ? "Solana" : "EVM"} Wallet`
              : "Loading..."}
          </Button>
        ) : (
          <Button
            onClick={handleProceed}
            disabled={tokenChain !== "solana" && (isCheckingPool || !poolCheck?.hasPool)}
            color="brand"
            className="flex-1 py-3"
            data-testid="consign-create-button"
          >
            {isCheckingPool ? "Checking pool..." : "Create Listing"}
          </Button>
        )}
      </div>
    </div>
  );
}
