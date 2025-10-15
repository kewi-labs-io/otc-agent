"use client";

import { Button } from "../button";

interface StepProps {
  formData: any;
  updateFormData: (updates: any) => void;
  onNext: () => void;
  onBack: () => void;
}

export function NegotiationParamsStep({
  formData,
  updateFormData,
  onNext,
  onBack,
}: StepProps) {
  return (
    <div className="space-y-6">
      <div>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={formData.isNegotiable}
            onChange={(e) => updateFormData({ isNegotiable: e.target.checked })}
            className="rounded"
          />
          <span className="font-medium">Allow Negotiation</span>
        </label>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 ml-6 mt-1">
          If checked, buyers can negotiate within your specified ranges
        </p>
      </div>

      {formData.isNegotiable ? (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                Min Discount (%)
              </label>
              <input
                type="number"
                value={formData.minDiscountBps / 100}
                onChange={(e) =>
                  updateFormData({
                    minDiscountBps: Number(e.target.value) * 100,
                  })
                }
                className="w-full px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">
                Max Discount (%)
              </label>
              <input
                type="number"
                value={formData.maxDiscountBps / 100}
                onChange={(e) =>
                  updateFormData({
                    maxDiscountBps: Number(e.target.value) * 100,
                  })
                }
                className="w-full px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                Min Lockup (days)
              </label>
              <input
                type="number"
                value={formData.minLockupDays}
                onChange={(e) =>
                  updateFormData({ minLockupDays: Number(e.target.value) })
                }
                className="w-full px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">
                Max Lockup (days)
              </label>
              <input
                type="number"
                value={formData.maxLockupDays}
                onChange={(e) =>
                  updateFormData({ maxLockupDays: Number(e.target.value) })
                }
                className="w-full px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800"
              />
            </div>
          </div>
        </>
      ) : (
        <>
          <div>
            <label className="block text-sm font-medium mb-2">
              Fixed Discount (%)
            </label>
            <input
              type="number"
              value={formData.fixedDiscountBps / 100}
              onChange={(e) =>
                updateFormData({
                  fixedDiscountBps: Number(e.target.value) * 100,
                })
              }
              className="w-full px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              Fixed Lockup (days)
            </label>
            <input
              type="number"
              value={formData.fixedLockupDays}
              onChange={(e) =>
                updateFormData({ fixedLockupDays: Number(e.target.value) })
              }
              className="w-full px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800"
            />
          </div>
        </>
      )}

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



