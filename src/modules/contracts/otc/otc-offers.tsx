"use client";

import type { FC } from "react";
import { useState } from "react";
import { useOTC } from "@/hooks/contracts/useOTC";
import { useAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";

function toWei(amount: string) {
  try {
    const [int, dec = ""] = amount.split(".");
    const padded = (int + (dec + "0".repeat(18)).slice(0, 18)).replace(
      /^0+/,
      "",
    );
    return BigInt(padded || "0");
  } catch {
    return 0n;
  }
}

// parseLockupPeriod function removed - not used
// function parseLockupPeriod(value: string, unit: string): bigint {
//   const num = parseInt(value) || 0;
//   switch (unit) {
//     case "minutes":
//       return BigInt(num * 60);
//     case "hours":
//       return BigInt(num * 60 * 60);
//     case "days":
//       return BigInt(num * 60 * 60 * 24);
//     case "weeks":
//       return BigInt(num * 60 * 60 * 24 * 7);
//     default:
//       return BigInt(num);
//   }
// }

export const OTCOffers: FC = () => {
  const {
    createOffer,
    isApprover,
    approveOffer,
    fulfillOffer,
    openOfferIds,
    openOffers,
    approveUsdc,
  } = useOTC();
  const { address, isConnected } = useAccount();
  const [form, setForm] = useState({
    tokenAmount: "0",
    discountPercent: "0",
    paymentCurrency: 0 as 0 | 1,
    lockupDays: "7",
  });
  const [offerId, setOfferId] = useState<string>("");

  return (
    <div className="rounded-lg border bg-white dark:bg-black p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">OTC Offers</h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Create and approve ELIZA quotes
          </p>
        </div>
        <ConnectButton />
      </div>

      {!isConnected ? (
        <div className="text-center py-8">
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            Connect your wallet to interact with the OTC Desk
          </p>
          <ConnectButton />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1">
              <span className="text-sm">Token amount (ELIZA)</span>
              <input
                className="px-3 py-2 border rounded-md bg-white dark:bg-black"
                value={form.tokenAmount}
                onChange={(e) =>
                  setForm((s) => ({ ...s, tokenAmount: e.target.value }))
                }
              />
            </label>
            <label className="grid gap-1">
              <span className="text-sm">Discount (%) 0–25</span>
              <input
                className="px-3 py-2 border rounded-md bg-white dark:bg-black"
                type="number"
                min="0"
                max="25"
                step="0.01"
                value={form.discountPercent}
                onChange={(e) =>
                  setForm((s) => ({ ...s, discountPercent: e.target.value }))
                }
              />
            </label>

            <div className="grid gap-1">
              <span className="text-sm">Lockup Period (days, 7–365)</span>
              <div className="flex gap-2">
                <input
                  className="px-3 py-2 border rounded-md bg-white dark:bg-black flex-1"
                  type="number"
                  min="7"
                  max="365"
                  value={form.lockupDays}
                  onChange={(e) =>
                    setForm((s) => ({ ...s, lockupDays: e.target.value }))
                  }
                />
              </div>
            </div>

            <fieldset className="flex items-center gap-2">
              <legend className="text-sm">Payment Currency</legend>
              <button
                type="button"
                className={`px-3 py-1.5 text-sm font-medium rounded-md ${form.paymentCurrency === 0 ? "bg-black text-white dark:bg-white dark:text-black" : "border"}`}
                onClick={() => setForm((s) => ({ ...s, paymentCurrency: 0 }))}
              >
                ETH
              </button>
              <button
                type="button"
                className={`px-3 py-1.5 text-sm font-medium rounded-md ${form.paymentCurrency === 1 ? "bg-black text-white dark:bg-white dark:text-black" : "border"}`}
                onClick={() => setForm((s) => ({ ...s, paymentCurrency: 1 }))}
              >
                USDC
              </button>
            </fieldset>
          </div>

          <div className="p-3 bg-gray-50 dark:bg-gray-900 rounded-md">
            <div className="text-sm text-gray-600 dark:text-gray-400">
              Connected Wallet
            </div>
            <div className="font-mono text-sm">{address}</div>
            <div className="text-xs text-gray-500 dark:text-gray-500 mt-1">
              Role: {isApprover ? "Approver" : "User"}
            </div>
          </div>

          <div className="flex gap-2 flex-wrap">
            <button
              className="px-3 py-1.5 text-sm font-medium rounded-md bg-black text-white dark:bg-white dark:text-black"
              onClick={async () => {
                try {
                  // Ensure devnet is deployed
                  const ensureRes = await fetch("/api/devnet/ensure", {
                    method: "POST",
                  });
                  if (!ensureRes.ok) {
                    console.warn("[OTC] Failed to ensure devnet deployment");
                  }
                } catch (error) {
                  console.error("[OTC] Error ensuring devnet:", error);
                }

                // Validate and clamp inputs
                const pct = Number.parseFloat(form.discountPercent || "0");
                const clampedPct = Number.isFinite(pct)
                  ? Math.min(25, Math.max(0, pct))
                  : 0;
                const discountBps = Math.round(clampedPct * 100);
                const daysNum = Number.parseInt(form.lockupDays || "7", 10);
                const clampedDays = Number.isFinite(daysNum)
                  ? Math.min(365, Math.max(7, daysNum))
                  : 7;
                const lockupSeconds = BigInt(clampedDays * 60 * 60 * 24);
                const currency =
                  form.paymentCurrency === 0 || form.paymentCurrency === 1
                    ? form.paymentCurrency
                    : 0;
                try {
                  const tokenWei = toWei(form.tokenAmount);
                  if (tokenWei === 0n) {
                    alert("Please enter a valid token amount");
                    return;
                  }

                  await createOffer({
                    tokenAmountWei: tokenWei,
                    discountBps,
                    paymentCurrency: currency,
                    lockupSeconds,
                  });

                  // Reset form on success
                  setForm({
                    tokenAmount: "0",
                    discountPercent: "0",
                    paymentCurrency: 0,
                    lockupDays: "7",
                  });

                  alert("Offer created successfully!");
                } catch (error) {
                  console.error("[OTC] Failed to create offer:", error);
                  alert(
                    `Failed to create offer: ${
                      error instanceof Error ? error.message : "Unknown error"
                    }`,
                  );
                }
              }}
            >
              Create Offer
            </button>

            {isApprover && (
              <>
                <input
                  className="px-3 py-2 border rounded-md bg-white dark:bg-black"
                  placeholder="Offer ID"
                  value={offerId}
                  onChange={(e) => setOfferId(e.target.value)}
                />
                <button
                  className="px-3 py-1.5 text-sm font-medium rounded-md bg-black text-white dark:bg-white dark:text-black"
                  onClick={async () => {
                    if (!offerId || offerId.trim() === "") {
                      alert("Please enter an Offer ID");
                      return;
                    }

                    try {
                      const offerIdBn = BigInt(offerId);
                      await approveOffer(offerIdBn);
                      alert(`Offer #${offerId} approved successfully!`);
                      setOfferId("");
                    } catch (error) {
                      console.error("[OTC] Failed to approve offer:", error);
                      alert(
                        `Failed to approve offer: ${
                          error instanceof Error
                            ? error.message
                            : "Invalid Offer ID"
                        }`,
                      );
                    }
                  }}
                >
                  Approve Offer
                </button>
              </>
            )}
          </div>

          <div className="space-y-3">
            <div className="font-medium">Open Offers</div>
            <div className="space-y-2">
              {openOfferIds.length === 0 && (
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  No open offers
                </div>
              )}
              {openOfferIds.map((id, idx) => {
                const q = (openOffers[idx] ?? {}) as any;
                const discountBps = Number(q?.discountBps ?? 0);
                const tokenAmount = String(q?.tokenAmount ?? 0n);
                const unlockTime = q?.unlockTime ? Number(q.unlockTime) : 0;
                const createdAt = q?.createdAt ? Number(q.createdAt) : 0;
                const lockupSeconds =
                  unlockTime > createdAt ? unlockTime - createdAt : 0;
                const lockupDays = Math.floor(lockupSeconds / (60 * 60 * 24));
                const lockupHours = Math.floor(
                  (lockupSeconds % (60 * 60 * 24)) / (60 * 60),
                );

                return (
                  <div
                    key={id.toString()}
                    className="flex items-center justify-between rounded-md border p-3"
                  >
                    <div className="text-sm">
                      <div className="font-medium">Offer #{id.toString()}</div>
                      <div className="text-xs text-gray-600 dark:text-gray-400">
                        Beneficiary: {q?.beneficiary?.slice(0, 6)}...
                        {q?.beneficiary?.slice(-4)}
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-400">
                        Tokens: {tokenAmount} ELIZA
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-400">
                        Discount: {(discountBps / 100).toFixed(2)}% (
                        {discountBps} bps)
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-400">
                        Currency:{" "}
                        {Number(q?.currency ?? 0) === 0 ? "ETH" : "USDC"}
                      </div>
                      {lockupSeconds > 0 && (
                        <div className="text-xs text-gray-600 dark:text-gray-400">
                          Lockup: {lockupDays > 0 ? `${lockupDays}d ` : ""}
                          {lockupHours > 0 ? `${lockupHours}h` : ""}
                          {lockupDays === 0 &&
                            lockupHours === 0 &&
                            "Less than 1 hour"}
                        </div>
                      )}
                    </div>
                    <button
                      className="px-3 py-1.5 text-sm font-medium rounded-md bg-black text-white dark:bg-white dark:text-black"
                      onClick={async () => {
                        try {
                          const ta = BigInt(q?.tokenAmount ?? 0n);
                          const priceUsdPerToken = BigInt(
                            q?.priceUsdPerToken ?? 0n,
                          ); // 8d
                          const dbps = BigInt(q?.discountBps ?? 0n);
                          const usd8 =
                            (((ta * priceUsdPerToken) / 10n ** 18n) *
                              (10_000n - dbps)) /
                            10_000n;
                          if (Number(q?.currency ?? 0) === 0) {
                            const ethUsd = BigInt(q?.ethUsdPrice ?? 0n); // 8d
                            const weiAmount = (usd8 * 10n ** 18n) / ethUsd;
                            await fulfillOffer(id, weiAmount);
                          } else {
                            const usdcAmount = (usd8 * 10n ** 6n) / 10n ** 8n;
                            await approveUsdc(usdcAmount);
                            await fulfillOffer(id);
                          }
                        } catch (e) {
                          console.error("[OTC] Failed to fulfill offer:", {
                            offerId: id.toString(),
                            error: e instanceof Error ? e.message : String(e),
                          });
                          alert(
                            `Failed to fulfill offer: ${
                              e instanceof Error ? e.message : "Unknown error"
                            }`,
                          );
                        }
                      }}
                    >
                      Fulfill
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
