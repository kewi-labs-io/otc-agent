"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/button";
import { Dialog } from "@/components/dialog";
import { useOTC } from "@/hooks/contracts/useOTC";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";

interface AcceptQuoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  discountPercent: number;
  lockupMonths: number;
  onConfirm: (tokenAmount: number) => Promise<void>;
}

export function AcceptQuoteModal({
  isOpen,
  onClose,
  discountPercent,
  lockupMonths,
  onConfirm,
}: AcceptQuoteModalProps) {
  const { isConnected } = useAccount();
  const { maxTokenPerOrder } = useOTC();

  // Convert contract values to numbers
  const minTokens = 100; // Minimum 100 tokens
  const maxTokens = maxTokenPerOrder
    ? Number(maxTokenPerOrder / BigInt(10 ** 18))
    : 10000;

  const [tokenAmount, setTokenAmount] = useState(1000);
  const [isProcessing, setIsProcessing] = useState(false);
  const [step, setStep] = useState<
    "amount" | "confirm" | "processing" | "complete"
  >("amount");

  useEffect(() => {
    if (!isOpen) {
      setStep("amount");
      setTokenAmount(1000);
      setIsProcessing(false);
    }
  }, [isOpen]);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTokenAmount(Number(e.target.value));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value);
    if (!isNaN(value)) {
      setTokenAmount(Math.min(maxTokens, Math.max(minTokens, value)));
    }
  };

  const handleProceed = async () => {
    if (!isConnected) return;

    setStep("confirm");
  };

  const handleConfirm = async () => {
    setIsProcessing(true);
    setStep("processing");

    try {
      await onConfirm(tokenAmount);
      setStep("complete");
      setTimeout(() => {
        onClose();
      }, 3000);
    } catch (error) {
      setIsProcessing(false);
      setStep("amount");
    }
  };

  const estimatedPrice = (tokenAmount * 0.00005).toFixed(2); // Mock price calculation

  return (
    <Dialog open={isOpen} onClose={onClose} data-testid="accept-quote-modal">
      <div className="p-6 max-w-md mx-auto">
        <h2 className="text-xl font-bold mb-4">Accept Quote</h2>

        {/* Quote Terms Summary */}
        <div className="bg-zinc-100 dark:bg-zinc-800 rounded-lg p-4 mb-6">
          <div className="flex justify-between mb-2">
            <span className="text-sm text-zinc-600 dark:text-zinc-400">Discount</span>
            <span className="font-semibold">{discountPercent}%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-zinc-600 dark:text-zinc-400">
              Lockup Period
            </span>
            <span className="font-semibold">{lockupMonths} months</span>
          </div>
        </div>

        {step === "amount" && (
          <>
            <div className="mb-6">
              <label className="block text-sm font-medium mb-2">
                Token Amount
              </label>

              {/* Token amount input */}
              <div className="flex items-center gap-4 mb-4">
                <input
                  data-testid="token-amount-input"
                  type="number"
                  value={tokenAmount}
                  onChange={handleInputChange}
                  min={minTokens}
                  max={maxTokens}
                  className="flex-1 px-3 py-2 border rounded-md bg-white dark:bg-zinc-900"
                />
                <span className="text-sm font-medium">ELIZA</span>
              </div>

              {/* Slider */}
              <input
                data-testid="token-amount-slider"
                type="range"
                min={minTokens}
                max={maxTokens}
                value={tokenAmount}
                onChange={handleSliderChange}
                className="w-full mb-2"
              />

              {/* Min/Max labels */}
              <div className="flex justify-between text-xs text-zinc-500">
                <span>{minTokens.toLocaleString()} min</span>
                <span>{maxTokens.toLocaleString()} max</span>
              </div>
            </div>

            {/* Estimated price */}
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 mb-6">
              <div className="flex justify-between">
                <span className="text-sm text-blue-700 dark:text-blue-300">
                  Estimated Price
                </span>
                <span className="font-semibold text-blue-900 dark:text-blue-100">
                  ${estimatedPrice} USDC
                </span>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-3">
              <Button onClick={onClose} color="dark" className="flex-1">
                Cancel
              </Button>
              {!isConnected ? (
                <div className="flex-1">
                  <ConnectButton />
                </div>
              ) : (
                <Button onClick={handleProceed} color="blue" className="flex-1">
                  Proceed
                </Button>
              )}
            </div>
          </>
        )}

        {step === "confirm" && (
          <>
            <div className="mb-6">
              <h3 className="font-semibold mb-4">Confirm Your OTC Purchase</h3>

              <div className="space-y-3 mb-6">
                <div className="flex justify-between">
                  <span className="text-sm text-zinc-600 dark:text-zinc-400">
                    Token Amount
                  </span>
                  <span className="font-medium">
                    {tokenAmount.toLocaleString()} ELIZA
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-zinc-600 dark:text-zinc-400">Discount</span>
                  <span className="font-medium">{discountPercent}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-zinc-600 dark:text-zinc-400">
                    Lockup
                  </span>
                  <span className="font-medium">{lockupMonths} months</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-zinc-600 dark:text-zinc-400">
                    Total Price
                  </span>
                  <span className="font-semibold text-green-600 dark:text-green-400">
                    ${estimatedPrice} USDC
                  </span>
                </div>
              </div>

              <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-3 mb-6">
                <p className="text-xs text-yellow-800 dark:text-yellow-200">
                  ⚠️ This will create an on-chain otc offer. After you submit,
                  the agent will review and approve your offer if it matches the
                  negotiated terms.
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <Button
                onClick={() => setStep("amount")}
                color="dark"
                className="flex-1"
              >
                Back
              </Button>
              <Button
                onClick={handleConfirm}
                color="blue"
                className="flex-1"
                disabled={isProcessing}
              >
                Confirm & Submit
              </Button>
            </div>
          </>
        )}

        {step === "processing" && (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <h3 className="font-semibold mb-2">Processing Your OTC Purchase</h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
              Please confirm the transaction in your wallet...
            </p>
            <div className="space-y-2 text-xs text-left max-w-xs mx-auto">
              <div className="flex items-center gap-2">
                <span className="w-4 h-4 rounded-full bg-blue-500 animate-pulse"></span>
                <span>Creating otc offer on-chain</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-4 h-4 rounded-full bg-zinc-300 dark:bg-zinc-600"></span>
                <span className="text-zinc-400">
                  Waiting for agent approval
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-4 h-4 rounded-full bg-zinc-300 dark:bg-zinc-600"></span>
                <span className="text-zinc-400">Completing transaction</span>
              </div>
            </div>
          </div>
        )}

        {step === "complete" && (
          <div className="text-center py-8">
            <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/20 flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-6 h-6 text-green-600 dark:text-green-400"
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
            <h3 className="font-semibold mb-2">OTC Offer Created!</h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Your offer has been submitted. The agent will review and approve
              it shortly.
            </p>
          </div>
        )}
      </div>
    </Dialog>
  );
}
