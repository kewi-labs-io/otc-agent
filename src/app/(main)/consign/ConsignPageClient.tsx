"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useMultiWallet } from "@/components/multiwallet";
import { usePrivy } from "@privy-io/react-auth";
import type { TokenWithBalance } from "@/components/consignment-form/token-selection-step";

const TokenSelectionStep = dynamic(
  () => import("@/components/consignment-form/token-selection-step").then((m) => m.TokenSelectionStep),
  { ssr: false }
);
const FormStep = dynamic(
  () => import("@/components/consignment-form/form-step").then((m) => m.FormStep),
  { ssr: false }
);
const ReviewStep = dynamic(
  () => import("@/components/consignment-form/review-step").then((m) => m.ReviewStep),
  { ssr: false }
);

function getRequiredChain(tokenId: string): "evm" | "solana" | null {
  if (!tokenId) return null;
  if (tokenId.includes("solana")) return "solana";
  if (tokenId.includes("base") || tokenId.includes("evm") || tokenId.includes("bsc")) return "evm";
  return null;
}

const STEP_LABELS = ["Select", "Configure", "Review"];

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

export default function ConsignPageClient() {
  const {
    hasWallet,
    activeFamily,
    setActiveFamily,
    evmConnected,
    solanaConnected,
    evmAddress,
    solanaPublicKey,
    networkLabel,
    disconnect,
    connectWallet,
    privyAuthenticated,
    isFarcasterContext,
  } = useMultiWallet();
  const { login, ready: privyReady } = usePrivy();

  const [step, setStep] = useState(1);
  const [selectedToken, setSelectedToken] = useState<TokenWithBalance | null>(null);
  const [formData, setFormData] = useState(INITIAL_FORM_DATA);

  const currentAddress = activeFamily === "solana" ? solanaPublicKey : evmAddress;
  const displayAddress = currentAddress
    ? `${currentAddress.slice(0, 6)}...${currentAddress.slice(-4)}`
    : null;

  const requiredChain = useMemo(() => getRequiredChain(formData.tokenId), [formData.tokenId]);

  const isConnectedToRequiredChain = useMemo(() => {
    if (!requiredChain) return hasWallet;
    return requiredChain === "solana"
      ? activeFamily === "solana" && hasWallet
      : activeFamily === "evm" && hasWallet;
  }, [requiredChain, activeFamily, hasWallet]);

  // Reset form when chain changes (prevents stale token selection)
  useEffect(() => {
    if (step > 1 && selectedToken) {
      const tokenChain = selectedToken.chain;
      const isTokenOnCurrentChain =
        (tokenChain === "solana" && activeFamily === "solana") ||
        (tokenChain !== "solana" && activeFamily === "evm");

      if (!isTokenOnCurrentChain) {
        // Token is on different chain, reset to step 1
        setStep(1);
        setSelectedToken(null);
        setFormData(INITIAL_FORM_DATA);
      }
    }
  }, [activeFamily, step, selectedToken]);

  const updateFormData = useCallback((updates: Partial<typeof formData>) => {
    setFormData((prev) => ({ ...prev, ...updates }));
  }, []);

  const handleNext = useCallback(() => setStep((s) => Math.min(s + 1, 3)), []);
  const handleBack = useCallback(() => setStep((s) => Math.max(s - 1, 1)), []);

  const handleConnect = useCallback(
    (chain?: "evm" | "solana") => {
      if (chain) setActiveFamily(chain);
      privyAuthenticated ? connectWallet() : login();
    },
    [setActiveFamily, privyAuthenticated, connectWallet, login]
  );

  const handleTokenSelect = useCallback((token: TokenWithBalance) => {
    setSelectedToken(token);
    // Auto-set deal amounts based on token balance
    const humanBalance = Number(BigInt(token.balance)) / Math.pow(10, token.decimals);
    const minDeal = Math.max(1, Math.floor(humanBalance * 0.01));
    const maxDeal = Math.floor(humanBalance);
    setFormData((prev) => ({
      ...prev,
      minDealAmount: minDeal.toString(),
      maxDealAmount: maxDeal.toString(),
    }));
  }, []);

  return (
    <main className="flex-1 px-3 sm:px-4 md:px-6 py-4 sm:py-6 md:py-8">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl sm:text-3xl font-bold mb-2">List Your Tokens for OTC</h1>
        <p className="text-sm sm:text-base text-zinc-600 dark:text-zinc-400 mb-4">
          Sell your tokens at a discount with a lockup period
        </p>

        {hasWallet && (
          <div className="mb-6 p-4 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center">
                  <span className="text-white text-xs font-bold">
                    {activeFamily === "solana" ? "S" : "E"}
                  </span>
                </div>
                <div>
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {displayAddress || "Not connected"}
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">{networkLabel}</p>
                </div>
              </div>
              {!isFarcasterContext && (
                <button
                  onClick={disconnect}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                >
                  Disconnect
                </button>
              )}
            </div>
          </div>
        )}

        {/* Progress indicator */}
        <div className="mb-6 sm:mb-8">
          <div className="flex justify-between items-center mb-2">
            {[1, 2, 3].map((s) => (
              <div
                key={s}
                className={`flex-1 h-2 ${
                  s <= step ? "bg-orange-500" : "bg-zinc-200 dark:bg-zinc-800"
                } ${s < 3 ? "mr-2" : ""} rounded-full transition-colors`}
              />
            ))}
          </div>
          <div className="flex justify-between text-xs text-zinc-600 dark:text-zinc-400">
            {STEP_LABELS.map((label, idx) => (
              <span key={label} className={step === idx + 1 ? "text-orange-500 font-medium" : ""}>
                {label}
              </span>
            ))}
          </div>
        </div>

        {/* Form steps */}
        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 sm:p-6 max-h-[calc(100vh-280px)] flex flex-col">
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
            />
          )}
          {step === 3 && (
            <ReviewStep
              formData={formData}
              onBack={handleBack}
              requiredChain={requiredChain}
              isConnectedToRequiredChain={isConnectedToRequiredChain}
              onConnect={() => handleConnect(requiredChain || undefined)}
              privyReady={privyReady}
              selectedTokenSymbol={selectedToken?.symbol}
              selectedTokenDecimals={selectedToken?.decimals}
            />
          )}
        </div>
      </div>
    </main>
  );
}
