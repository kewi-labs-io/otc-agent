"use client";

import { Button } from "../button";

interface StepProps {
  formData: any;
  updateFormData: (updates: any) => void;
  onNext: () => void;
  onBack: () => void;
}

export function DealStructureStep({
  formData,
  updateFormData,
  onNext,
  onBack,
}: StepProps) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-2">
            Minimum Deal Amount
          </label>
          <input
            type="text"
            value={formData.minDealAmount}
            onChange={(e) => updateFormData({ minDealAmount: e.target.value })}
            placeholder="e.g., 1000"
            className="w-full px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-2">
            Maximum Deal Amount
          </label>
          <input
            type="text"
            value={formData.maxDealAmount}
            onChange={(e) => updateFormData({ maxDealAmount: e.target.value })}
            placeholder="e.g., 100000"
            className="w-full px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800"
          />
        </div>
      </div>

      <div>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={formData.isFractionalized}
            onChange={(e) =>
              updateFormData({ isFractionalized: e.target.checked })
            }
            className="rounded"
          />
          <span className="font-medium">Allow Fractionalized Deals</span>
        </label>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 ml-6 mt-1">
          Allow multiple buyers to purchase portions of your consignment
        </p>
      </div>

      <div>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={formData.isPrivate}
            onChange={(e) => updateFormData({ isPrivate: e.target.checked })}
            className="rounded"
          />
          <span className="font-medium">Private Listing</span>
        </label>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 ml-6 mt-1">
          Hide from public marketplace (whitelist only)
        </p>
      </div>

      {formData.isPrivate && (
        <div>
          <label className="block text-sm font-medium mb-2">
            Allowed Buyers (comma-separated addresses)
          </label>
          <textarea
            value={formData.allowedBuyers.join(", ")}
            onChange={(e) =>
              updateFormData({
                allowedBuyers: e.target.value
                  .split(",")
                  .map((a) => a.trim())
                  .filter((a) => a),
              })
            }
            placeholder="0x123..., 0x456..."
            className="w-full px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 h-24"
          />
        </div>
      )}

      <div className="flex gap-4">
        <Button onClick={onBack} color="zinc" className="flex-1">
          Back
        </Button>
        <Button
          onClick={onNext}
          disabled={!formData.minDealAmount || !formData.maxDealAmount}
          className="flex-1"
        >
          Next
        </Button>
      </div>
    </div>
  );
}



