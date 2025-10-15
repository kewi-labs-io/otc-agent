"use client";

import { Button } from "../button";

interface StepProps {
  formData: any;
  updateFormData: (updates: any) => void;
  onNext: () => void;
  onBack: () => void;
}

export function ProtectionsStep({
  formData,
  updateFormData,
  onNext,
  onBack,
}: StepProps) {
  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium mb-2">
          Max Price Volatility (%)
        </label>
        <input
          type="number"
          value={formData.maxPriceVolatilityBps / 100}
          onChange={(e) =>
            updateFormData({
              maxPriceVolatilityBps: Number(e.target.value) * 100,
            })
          }
          className="w-full px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800"
        />
        <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
          Maximum allowed price change from quote to execution. Recommended:
          5-10%
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium mb-2">
          Quote Expiry (seconds)
        </label>
        <input
          type="number"
          value={formData.maxTimeToExecuteSeconds}
          onChange={(e) =>
            updateFormData({ maxTimeToExecuteSeconds: Number(e.target.value) })
          }
          className="w-full px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800"
        />
        <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
          How long quotes remain valid. Recommended: 1800 seconds (30 minutes)
        </p>
      </div>

      <div className="flex gap-4">
        <Button onClick={onBack} color="zinc" className="flex-1">
          Back
        </Button>
        <Button onClick={onNext} className="flex-1">
          Next
        </Button>
      </div>
    </div>
  );
}



