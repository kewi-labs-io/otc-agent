"use client";

import { Button } from "../button";

interface StepProps {
  formData: any;
  updateFormData: (updates: any) => void;
  onNext: () => void;
  onBack: () => void;
}

export function AmountStep({
  formData,
  updateFormData,
  onNext,
  onBack,
}: StepProps) {
  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium mb-2">
          Total Amount to Consign
        </label>
        <input
          type="text"
          value={formData.amount}
          onChange={(e) => updateFormData({ amount: e.target.value })}
          placeholder="Enter amount (e.g., 1000000)"
          className="w-full px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900"
        />
        <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
          Enter the total number of tokens you want to make available for OTC
          deals
        </p>
      </div>

      <div className="flex gap-4">
        <Button onClick={onBack} color="zinc" className="flex-1">
          Back
        </Button>
        <Button onClick={onNext} disabled={!formData.amount} className="flex-1">
          Next
        </Button>
      </div>
    </div>
  );
}



