"use client";

import { useState } from "react";
import { useMultiWallet } from "../multiwallet";
import { Button } from "../button";
import { useRouter } from "next/navigation";

interface StepProps {
  formData: any;
  updateFormData: (updates: any) => void;
  onNext: () => void;
  onBack: () => void;
}

export function ReviewStep({ formData, onBack }: StepProps) {
  const { activeFamily, evmAddress, solanaPublicKey } = useMultiWallet();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);

    const consignerAddress =
      activeFamily === "solana" ? solanaPublicKey : evmAddress;

    const chain = activeFamily === "solana" ? "solana" : "base";

    const response = await fetch("/api/consignments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...formData,
        consignerAddress,
        chain,
      }),
    });

    const data = await response.json();

    if (data.success) {
      router.push(`/my-deals?tab=listings`);
    } else {
      alert("Failed to create consignment: " + (data.error || "Unknown error"));
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="flex justify-between">
          <span className="text-zinc-600 dark:text-zinc-400">Token:</span>
          <span className="font-medium">{formData.tokenId}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-600 dark:text-zinc-400">Amount:</span>
          <span className="font-medium">{formData.amount}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-600 dark:text-zinc-400">Type:</span>
          <span className="font-medium">
            {formData.isNegotiable ? "Negotiable" : "Fixed Price"}
          </span>
        </div>
        {formData.isNegotiable ? (
          <>
            <div className="flex justify-between">
              <span className="text-zinc-600 dark:text-zinc-400">
                Discount Range:
              </span>
              <span className="font-medium">
                {formData.minDiscountBps / 100}% -{" "}
                {formData.maxDiscountBps / 100}%
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-600 dark:text-zinc-400">
                Lockup Range:
              </span>
              <span className="font-medium">
                {formData.minLockupDays} - {formData.maxLockupDays} days
              </span>
            </div>
          </>
        ) : (
          <>
            <div className="flex justify-between">
              <span className="text-zinc-600 dark:text-zinc-400">
                Fixed Discount:
              </span>
              <span className="font-medium">
                {formData.fixedDiscountBps / 100}%
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-600 dark:text-zinc-400">
                Fixed Lockup:
              </span>
              <span className="font-medium">
                {formData.fixedLockupDays} days
              </span>
            </div>
          </>
        )}
        <div className="flex justify-between">
          <span className="text-zinc-600 dark:text-zinc-400">
            Deal Size Range:
          </span>
          <span className="font-medium">
            {formData.minDealAmount} - {formData.maxDealAmount}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-600 dark:text-zinc-400">
            Fractionalized:
          </span>
          <span className="font-medium">
            {formData.isFractionalized ? "Yes" : "No"}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-600 dark:text-zinc-400">Visibility:</span>
          <span className="font-medium">
            {formData.isPrivate ? "Private" : "Public"}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-600 dark:text-zinc-400">
            Price Protection:
          </span>
          <span className="font-medium">
            ±{formData.maxPriceVolatilityBps / 100}%
          </span>
        </div>
      </div>

      <div className="flex gap-4">
        <Button
          onClick={onBack}
          color="zinc"
          className="flex-1"
          disabled={submitting}
        >
          Back
        </Button>
        <Button onClick={handleSubmit} className="flex-1" disabled={submitting}>
          {submitting ? "Creating..." : "Create Consignment"}
        </Button>
      </div>
    </div>
  );
}
