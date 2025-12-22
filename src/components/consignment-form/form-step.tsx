"use client";

import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  ChevronDown,
  ChevronUp,
  Clock,
  Coins,
  Eye,
  EyeOff,
  Info,
  Loader2,
  Lock,
  Percent,
  TrendingDown,
  Zap,
} from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePoolCheck } from "@/hooks/usePoolCheck";
import { parseTokenId } from "@/utils/token-utils";
import { Button } from "../button";

interface FormStepProps {
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
    selectedPoolAddress?: string;
  };
  updateFormData: (updates: Partial<FormStepProps["formData"]>) => void;
  onNext: () => void;
  onBack: () => void;
  selectedTokenBalance?: string;
  selectedTokenDecimals?: number;
  selectedTokenSymbol?: string;
  selectedTokenLogoUrl?: string | null;
}

function DualRangeSlider({
  min,
  max,
  minValue,
  maxValue,
  step = 1,
  onChange,
  accentColor = "orange",
}: {
  min: number;
  max: number;
  minValue: number;
  maxValue: number;
  step?: number;
  onChange: (min: number, max: number) => void;
  accentColor?: "orange" | "purple" | "blue";
}) {
  const colorClasses = {
    orange: "bg-brand-500",
    purple: "bg-purple-500",
    blue: "bg-blue-500",
  };

  const minPercent = ((minValue - min) / (max - min)) * 100;
  const maxPercent = ((maxValue - min) / (max - min)) * 100;

  return (
    <div className="relative pt-2 pb-2">
      <div className="relative h-2 bg-zinc-200 dark:bg-zinc-700 rounded-full">
        <div
          className={`absolute h-full ${colorClasses[accentColor]} rounded-full`}
          style={{
            left: `${minPercent}%`,
            width: `${maxPercent - minPercent}%`,
          }}
        />
      </div>

      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={minValue}
        onChange={(e) => {
          const val = Number(e.target.value);
          if (val <= maxValue) onChange(val, maxValue);
        }}
        className="absolute top-2 w-full h-2 appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-zinc-400 [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:hover:border-brand-500 [&::-webkit-slider-thumb]:transition-colors"
      />

      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={maxValue}
        onChange={(e) => {
          const val = Number(e.target.value);
          if (val >= minValue) onChange(minValue, val);
        }}
        className="absolute top-2 w-full h-2 appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-zinc-400 [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:hover:border-brand-500 [&::-webkit-slider-thumb]:transition-colors"
      />
    </div>
  );
}

function SingleSlider({
  min,
  max,
  value,
  step = 1,
  onChange,
}: {
  min: number;
  max: number;
  value: number;
  step?: number;
  onChange: (val: number) => void;
}) {
  const percent = ((value - min) / (max - min)) * 100;

  return (
    <div className="relative pt-2 pb-2">
      <div className="relative h-2 bg-zinc-200 dark:bg-zinc-700 rounded-full">
        <div
          className="absolute h-full bg-brand-500 rounded-full"
          style={{ width: `${percent}%` }}
        />
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="absolute top-2 w-full h-2 appearance-none bg-transparent cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-brand-500 [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:hover:scale-110 [&::-webkit-slider-thumb]:transition-transform"
      />
    </div>
  );
}

export function FormStep({
  formData,
  updateFormData,
  onNext,
  onBack,
  selectedTokenBalance = "0",
  selectedTokenDecimals = 18,
  selectedTokenSymbol = "TOKEN",
  selectedTokenLogoUrl,
}: FormStepProps) {
  const [logoError, setLogoError] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedPoolIndex, setSelectedPoolIndex] = useState(0);
  const [showPoolSelector, setShowPoolSelector] = useState(false);

  const { chain: tokenChain, address: rawTokenAddress } = parseTokenId(formData.tokenId);

  // Use React Query for pool checking - automatic caching and deduplication
  const { poolCheck, isCheckingPool } = usePoolCheck(rawTokenAddress, tokenChain);

  // Reset pool selection when pool check changes and set initial selected pool
  useEffect(() => {
    setSelectedPoolIndex(0);
    setShowPoolSelector(false);
    // Set the default pool address in form data
    if (!poolCheck) return;

    // FAIL-FAST: If poolCheck exists, it should have either allPools or pool
    const defaultPool =
      poolCheck.allPools && poolCheck.allPools.length > 0 ? poolCheck.allPools[0] : poolCheck.pool;

    if (defaultPool) {
      // FAIL-FAST: Pool must have address
      if (!defaultPool.address) {
        throw new Error("Pool object missing required address field");
      }
      updateFormData({ selectedPoolAddress: defaultPool.address });
    }
  }, [poolCheck, updateFormData]);

  // Get currently selected pool from allPools or fall back to default pool
  const selectedPool = useMemo(() => {
    if (!poolCheck) return null;
    if (poolCheck.allPools && poolCheck.allPools.length > 0) {
      // FAIL-FAST: Validate index is within bounds
      if (selectedPoolIndex < 0 || selectedPoolIndex >= poolCheck.allPools.length) {
        throw new Error(
          `Invalid pool index: ${selectedPoolIndex} (available: ${poolCheck.allPools.length})`,
        );
      }
      const selected = poolCheck.allPools[selectedPoolIndex];
      // FAIL-FAST: Selected pool must exist (index validated above)
      if (!selected) {
        throw new Error(`Pool at index ${selectedPoolIndex} is null or undefined`);
      }
      return selected;
    }
    return poolCheck.pool ?? null;
  }, [poolCheck, selectedPoolIndex]);

  const maxBalance = useMemo(() => {
    // FAIL-FAST: Balance should be provided, but default to "0" if missing (user hasn't loaded balance yet)
    const balanceStr = selectedTokenBalance || "0";
    const raw = BigInt(balanceStr);
    return Number(raw) / 10 ** selectedTokenDecimals;
  }, [selectedTokenBalance, selectedTokenDecimals]);

  const currentAmount = useMemo(() => {
    const parsed = parseFloat(formData.amount);
    return Number.isNaN(parsed) ? 0 : parsed;
  }, [formData.amount]);

  const validationErrors = useMemo(() => {
    const errors: string[] = [];

    if (!formData.amount || parseFloat(formData.amount) <= 0) {
      errors.push("Enter an amount to list");
    } else if (currentAmount > maxBalance) {
      errors.push(`Amount exceeds balance (${maxBalance.toLocaleString()} ${selectedTokenSymbol})`);
    }

    if (formData.isNegotiable) {
      if (formData.minDiscountBps > formData.maxDiscountBps) {
        errors.push("Min discount must be less than max discount");
      }
      if (formData.minLockupDays > formData.maxLockupDays) {
        errors.push("Min lockup must be less than max lockup");
      }
      // Ensure fixed values are within negotiable range for consistency
      if (formData.fixedLockupDays > formData.maxLockupDays) {
        errors.push(
          `Fixed lockup (${formData.fixedLockupDays}d) exceeds max lockup (${formData.maxLockupDays}d)`,
        );
      }
    } else {
      if (!formData.fixedDiscountBps || formData.fixedDiscountBps <= 0) {
        errors.push("Set a discount percentage");
      }
      // Lockup can be 0 days (immediate claim) depending on listing terms.
    }

    return errors;
  }, [formData, currentAmount, maxBalance, selectedTokenSymbol]);

  // For EVM tokens, also require a valid pool
  const poolValid =
    tokenChain === "solana" ||
    (!isCheckingPool && poolCheck && (poolCheck.hasPool || poolCheck.isRegistered));
  const isValid = validationErrors.length === 0 && currentAmount > 0 && poolValid;

  const setAmountPercentage = useCallback(
    (pct: number) => {
      const amount = Math.floor(maxBalance * pct);
      updateFormData({ amount: amount.toString() });
    },
    [maxBalance, updateFormData],
  );

  return (
    <div className="space-y-6">
      {/* Selected Token Header */}
      <div className="flex items-center gap-3 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50">
        {selectedTokenLogoUrl && !logoError ? (
          <Image
            src={selectedTokenLogoUrl}
            alt={selectedTokenSymbol}
            width={40}
            height={40}
            className="w-10 h-10 rounded-full"
            onError={() => setLogoError(true)}
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-brand-400 to-brand-500 flex items-center justify-center">
            <span className="text-white font-bold">{selectedTokenSymbol.charAt(0)}</span>
          </div>
        )}
        <div className="flex-1">
          <p className="font-semibold text-zinc-900 dark:text-zinc-100">{selectedTokenSymbol}</p>
          <p className="text-xs text-zinc-500">
            Available: {maxBalance.toLocaleString()} {selectedTokenSymbol}
          </p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="text-xs text-brand-500 hover:text-brand-600 font-medium"
        >
          Change
        </button>
      </div>

      {/* Amount Section */}
      <div className="rounded-xl p-4 bg-zinc-50 dark:bg-zinc-800/30">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-lg bg-brand-500/20 flex items-center justify-center">
            <Coins className="w-4 h-4 text-brand-500" />
          </div>
          <div>
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">Amount to List</h3>
            <p className="text-xs text-zinc-500">How many tokens to make available</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="relative">
            <input
              type="text"
              inputMode="decimal"
              value={formData.amount}
              onChange={(e) => {
                const val = e.target.value.replace(/[^0-9.]/g, "");
                updateFormData({ amount: val });
              }}
              placeholder="0"
              data-testid="consign-amount-input"
              className={`w-full px-4 py-3 text-2xl font-bold rounded-xl border bg-white dark:bg-zinc-800/50 focus:ring-2 transition-all ${
                currentAmount > maxBalance
                  ? "border-red-500 focus:border-red-500 focus:ring-red-500/20"
                  : "border-zinc-200 dark:border-zinc-700 focus:border-brand-500 focus:ring-brand-500/20"
              }`}
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 font-medium">
              {selectedTokenSymbol}
            </span>
          </div>

          {currentAmount > maxBalance && (
            <div className="flex items-center gap-2 text-red-500 text-sm">
              <AlertCircle className="w-4 h-4" />
              <span>Exceeds available balance</span>
            </div>
          )}

          {maxBalance > 0 && (
            <SingleSlider
              min={0}
              max={maxBalance}
              value={Math.min(currentAmount, maxBalance)}
              step={maxBalance / 100}
              onChange={(val) => updateFormData({ amount: Math.floor(val).toString() })}
            />
          )}

          <div className="flex gap-2">
            {[
              { label: "10%", pct: 0.1 },
              { label: "25%", pct: 0.25 },
              { label: "50%", pct: 0.5 },
              { label: "75%", pct: 0.75 },
              { label: "Max", pct: 1 },
            ].map(({ label, pct }) => (
              <button
                key={label}
                type="button"
                onClick={() => setAmountPercentage(pct)}
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  currentAmount === Math.floor(maxBalance * pct)
                    ? "bg-brand-500 text-white"
                    : "bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Pricing Mode Toggle */}
      <div className="flex items-center justify-between p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800/30">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center">
            <Zap className="w-4 h-4 text-purple-500" />
          </div>
          <div>
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">Negotiable Pricing</h3>
            <p className="text-xs text-zinc-500">Allow buyers to negotiate</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => updateFormData({ isNegotiable: !formData.isNegotiable })}
          className={`relative w-11 h-6 rounded-full transition-colors ${
            formData.isNegotiable ? "bg-purple-500" : "bg-zinc-300 dark:bg-zinc-600"
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
              formData.isNegotiable ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      {/* Discount Section */}
      <div className="rounded-xl p-4 bg-zinc-50 dark:bg-zinc-800/30">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
            <TrendingDown className="w-4 h-4 text-emerald-500" />
          </div>
          <div>
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">
              {formData.isNegotiable ? "Discount Range" : "Fixed Discount"}
            </h3>
            <p className="text-xs text-zinc-500">Percentage below market price</p>
          </div>
        </div>

        {formData.isNegotiable ? (
          <div className="space-y-4" data-testid="consign-discount-range">
            <DualRangeSlider
              min={1}
              max={50}
              minValue={formData.minDiscountBps / 100}
              maxValue={formData.maxDiscountBps / 100}
              onChange={(minVal, maxVal) =>
                updateFormData({
                  minDiscountBps: minVal * 100,
                  maxDiscountBps: maxVal * 100,
                })
              }
              accentColor="orange"
            />
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <Percent className="w-4 h-4 text-zinc-400" />
                <span className="text-zinc-600 dark:text-zinc-400">
                  Min: {formData.minDiscountBps / 100}%
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-zinc-600 dark:text-zinc-400">
                  Max: {formData.maxDiscountBps / 100}%
                </span>
                <Percent className="w-4 h-4 text-zinc-400" />
              </div>
            </div>
          </div>
        ) : (
          <SingleSlider
            min={1}
            max={50}
            value={formData.fixedDiscountBps / 100}
            onChange={(val) => updateFormData({ fixedDiscountBps: val * 100 })}
          />
        )}
      </div>

      {/* Lockup Section */}
      <div className="rounded-xl p-4 bg-zinc-50 dark:bg-zinc-800/30">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
            <Lock className="w-4 h-4 text-blue-500" />
          </div>
          <div>
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">
              {formData.isNegotiable ? "Lockup Duration Range" : "Fixed Lockup"}
            </h3>
            <p className="text-xs text-zinc-500">How long tokens are locked after purchase</p>
          </div>
        </div>

        {formData.isNegotiable ? (
          <div className="space-y-4" data-testid="consign-lockup-range">
            <DualRangeSlider
              min={0}
              max={365}
              minValue={formData.minLockupDays}
              maxValue={formData.maxLockupDays}
              onChange={(minVal, maxVal) => {
                // Auto-adjust fixedLockupDays to stay within range
                const updates: Partial<typeof formData> = {
                  minLockupDays: minVal,
                  maxLockupDays: maxVal,
                };
                if (formData.fixedLockupDays > maxVal) {
                  updates.fixedLockupDays = maxVal;
                }
                if (formData.fixedLockupDays < minVal) {
                  updates.fixedLockupDays = minVal;
                }
                updateFormData(updates);
              }}
              accentColor="blue"
            />
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-zinc-400" />
                <span className="text-zinc-600 dark:text-zinc-400">
                  Min: {formData.minLockupDays} days
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-zinc-600 dark:text-zinc-400">
                  Max: {formData.maxLockupDays} days
                </span>
                <Calendar className="w-4 h-4 text-zinc-400" />
              </div>
            </div>
          </div>
        ) : (
          <SingleSlider
            min={0}
            max={365}
            value={formData.fixedLockupDays}
            onChange={(val) => updateFormData({ fixedLockupDays: val })}
          />
        )}
      </div>

      {/* Pool Status Section - EVM only */}
      {tokenChain !== "solana" && (
        <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800/30 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
              <Info className="w-4 h-4" />
              Price Oracle
            </div>
            {poolCheck?.allPools && poolCheck.allPools.length > 1 && (
              <button
                type="button"
                onClick={() => setShowPoolSelector(!showPoolSelector)}
                className="text-xs text-orange-600 hover:text-orange-700 dark:text-orange-400 dark:hover:text-orange-300"
              >
                {showPoolSelector ? "Hide" : "Change"} ({poolCheck.allPools.length} available)
              </button>
            )}
          </div>

          {isCheckingPool ? (
            <div className="flex items-center gap-2 text-sm text-zinc-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              Checking pool status...
            </div>
          ) : poolCheck ? (
            <div className="space-y-2">
              {/* Pool Selector */}
              {showPoolSelector && poolCheck.allPools && poolCheck.allPools.length > 1 && (
                <div className="space-y-1 p-2 rounded-lg bg-zinc-100 dark:bg-zinc-800/50 max-h-48 overflow-y-auto">
                  {poolCheck.allPools.map((pool, idx) => (
                    <button
                      key={pool.address}
                      type="button"
                      onClick={() => {
                        setSelectedPoolIndex(idx);
                        setShowPoolSelector(false);
                        updateFormData({ selectedPoolAddress: pool.address });
                      }}
                      className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                        idx === selectedPoolIndex
                          ? "bg-orange-500/20 text-orange-700 dark:text-orange-300"
                          : "hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300"
                      }`}
                    >
                      <div className="flex justify-between items-center">
                        <span className="font-medium">
                          {pool.protocol} ({pool.baseToken})
                        </span>
                        <span className={pool.tvlUsd < 10000 ? "text-amber-600" : "text-green-600"}>
                          $
                          {pool.tvlUsd.toLocaleString(undefined, {
                            maximumFractionDigits: 0,
                          })}
                        </span>
                      </div>
                      <div className="text-zinc-500 dark:text-zinc-400 truncate">
                        {pool.address.slice(0, 10)}...{pool.address.slice(-8)}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Selected Pool Info */}
              {poolCheck.hasPool && selectedPool && (
                <>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-600 dark:text-zinc-400">Source:</span>
                    <span className="text-zinc-900 dark:text-zinc-100">
                      {selectedPool.protocol} ({selectedPool.baseToken})
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-600 dark:text-zinc-400">Pool Liquidity:</span>
                    <span
                      className={`${selectedPool.tvlUsd < 10000 ? "text-amber-600" : "text-green-600"}`}
                    >
                      $
                      {selectedPool.tvlUsd.toLocaleString(undefined, {
                        maximumFractionDigits: 0,
                      })}
                    </span>
                  </div>
                  {selectedPool.priceUsd && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-zinc-600 dark:text-zinc-400">Current Price:</span>
                      <span className="text-zinc-900 dark:text-zinc-100">
                        $
                        {selectedPool.priceUsd.toLocaleString(undefined, {
                          maximumFractionDigits: 6,
                        })}
                      </span>
                    </div>
                  )}
                </>
              )}

              {/* Warning - show based on selected pool */}
              {selectedPool && selectedPool.tvlUsd < 10000 && (
                <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    {selectedPool.tvlUsd < 1000
                      ? `Low liquidity detected ($${selectedPool.tvlUsd.toFixed(0)}). Price accuracy may be affected.`
                      : `Moderate liquidity ($${selectedPool.tvlUsd.toFixed(0)}). Consider waiting for more liquidity for better price accuracy.`}
                  </p>
                </div>
              )}

              {/* No Pool Error */}
              {!poolCheck.hasPool && (
                <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/20 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-red-600 dark:text-red-400">
                    No liquidity pool found. This token needs a Uniswap V3/V4, Aerodrome, or
                    Pancakeswap pool to be listed.
                  </p>
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}

      {/* Advanced Settings Toggle */}
      <button
        type="button"
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="w-full flex items-center justify-between p-3 rounded-lg bg-zinc-100 dark:bg-zinc-800/50 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors"
      >
        <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
          Advanced Settings
        </span>
        {showAdvanced ? (
          <ChevronUp className="w-4 h-4 text-zinc-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-zinc-400" />
        )}
      </button>

      {showAdvanced && (
        <div className="space-y-4 pl-4 border-l-2 border-zinc-200 dark:border-zinc-700">
          {/* Private Listing Toggle */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/30">
            <div className="flex items-center gap-3">
              {formData.isPrivate ? (
                <EyeOff className="w-5 h-5 text-zinc-500" />
              ) : (
                <Eye className="w-5 h-5 text-zinc-500" />
              )}
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  Private Listing
                </p>
                <p className="text-xs text-zinc-500">Hide from marketplace</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => updateFormData({ isPrivate: !formData.isPrivate })}
              className={`relative w-11 h-6 rounded-full transition-colors ${
                formData.isPrivate ? "bg-brand-500" : "bg-zinc-300 dark:bg-zinc-600"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                  formData.isPrivate ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          {/* Execution Settings */}
          <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/30 space-y-3">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-zinc-500" />
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Execution Window
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="max-price-volatility" className="text-xs text-zinc-500 mb-1 block">
                  Max Price Volatility
                </label>
                <div className="relative">
                  <input
                    id="max-price-volatility"
                    type="number"
                    value={formData.maxPriceVolatilityBps / 100}
                    onChange={(e) =>
                      updateFormData({
                        maxPriceVolatilityBps: Number(e.target.value) * 100,
                      })
                    }
                    className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500">
                    %
                  </span>
                </div>
              </div>
              <div>
                <label htmlFor="max-execute-time" className="text-xs text-zinc-500 mb-1 block">
                  Max Execute Time
                </label>
                <div className="relative">
                  <input
                    id="max-execute-time"
                    type="number"
                    value={formData.maxTimeToExecuteSeconds / 60}
                    onChange={(e) =>
                      updateFormData({
                        maxTimeToExecuteSeconds: Number(e.target.value) * 60,
                      })
                    }
                    className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500">
                    min
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Validation Errors */}
      {validationErrors.length > 0 && currentAmount > 0 && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
            <div className="space-y-1">
              {/* Using index as key is acceptable for validation error lists -
                 errors are derived from form state and don't reorder */}
              {validationErrors.map((error, i) => (
                <p
                  key={`${error.slice(0, 30)}-${i}`}
                  className="text-sm text-red-600 dark:text-red-400"
                >
                  {error}
                </p>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex gap-3 pt-4">
        <Button
          onClick={onBack}
          className="flex items-center gap-2 px-6 py-3 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-xl transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>
        <Button
          onClick={onNext}
          disabled={!isValid}
          color="brand"
          data-testid="consign-review-button"
          className="flex-1 px-6 py-3"
        >
          {tokenChain !== "solana" && isCheckingPool ? "Checking pool..." : "Review Listing"}
        </Button>
      </div>
    </div>
  );
}
