"use client";

import type { FC } from "react";
import { useOTC } from "@/hooks/contracts/useOTC";
import { useAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { formatElizaAmount } from "@/lib/plugin-otc-desk/services/priceFeed";

export const OTCPanel: FC = () => {
  const {
    otcAddress,
    availableTokens,
    myOffers,
    isApprover,
    claim,
    isClaiming,
    ethBalanceWei,
    usdcBalance,
    minUsdAmount,
    maxTokenPerOrder,
    quoteExpirySeconds,
    defaultUnlockDelaySeconds,
  } = useOTC();
  const { address, isConnected } = useAccount();

  // Format ELIZA amounts for display
  const formatTokens = (amount: bigint) => {
    const num = Number(amount) / 1e18; // Convert from wei to tokens
    return formatElizaAmount(num);
  };

  return (
    <div className="rounded-lg border bg-white dark:bg-black p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Agent OTC Desk</h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Contract:{" "}
            {otcAddress
              ? `${otcAddress.slice(0, 6)}...${otcAddress.slice(-4)}`
              : "Not deployed"}{" "}
            • Mode: {isApprover ? "Admin" : "User"}
          </p>
        </div>
        {!isConnected && <ConnectButton />}
      </div>

      {!isConnected ? (
        <div className="text-center py-8">
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            Connect your wallet to view your otc offers
          </p>
          <ConnectButton />
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              Available ELIZA Inventory
            </div>
            <div className="text-lg font-mono">
              {formatTokens(availableTokens)} ELIZA
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <div className="text-sm text-gray-600 dark:text-gray-400">
                Treasury ETH
              </div>
              <div className="font-mono text-sm">
                {ethBalanceWei
                  ? (Number(ethBalanceWei) / 1e18).toFixed(6)
                  : "-"}{" "}
                ETH
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-600 dark:text-gray-400">
                Treasury USDC
              </div>
              <div className="font-mono text-sm">
                {usdcBalance ? (Number(usdcBalance) / 1e6).toFixed(2) : "-"}{" "}
                USDC
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-600 dark:text-gray-400">
                Config
              </div>
              <div className="font-mono text-xs">
                Min: $
                {minUsdAmount ? (Number(minUsdAmount) / 1e8).toFixed(2) : "-"}
                <br />
                Max: {maxTokenPerOrder
                  ? formatTokens(maxTokenPerOrder)
                  : "-"}{" "}
                ELIZA
                <br />
                Expiry:{" "}
                {quoteExpirySeconds ? `${Number(quoteExpirySeconds)}s` : "-"}
                <br />
                Default Lock:{" "}
                {defaultUnlockDelaySeconds
                  ? `${Math.floor(Number(defaultUnlockDelaySeconds) / 86400)}d`
                  : "-"}
              </div>
            </div>
          </div>

          <div className="p-3 bg-gray-50 dark:bg-gray-900 rounded-md">
            <div className="text-sm text-gray-600 dark:text-gray-400">
              Your Wallet
            </div>
            <div className="font-mono text-sm">{address}</div>
          </div>

          <div className="space-y-2">
            <div className="font-medium">Your ELIZA Offers</div>
            {myOffers.length === 0 && (
              <div className="text-sm text-gray-600 dark:text-gray-400">
                No offers yet
              </div>
            )}
            {myOffers.map((o) => {
              const now = Math.floor(Date.now() / 1000);
              const canClaim =
                Number(o.unlockTime ?? 0n) <= now &&
                !o.cancelled &&
                o.fulfilled;
              const timeUntilUnlock = Number(o.unlockTime ?? 0n) - now;
              const daysUntilUnlock = Math.floor(timeUntilUnlock / 86400);
              const hoursUntilUnlock = Math.floor(
                (timeUntilUnlock % 86400) / 3600,
              );

              return (
                <div
                  key={o.id.toString()}
                  className="flex items-center justify-between rounded-md border p-3"
                >
                  <div className="space-y-1">
                    <div className="text-sm font-medium">
                      Offer #{o.id.toString()}
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">
                      Tokens: {formatTokens(o.tokenAmount)} ELIZA
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">
                      Discount: {(Number(o.discountBps) / 100).toFixed(2)}% (
                      {o.discountBps.toString()} bps)
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">
                      {canClaim ? (
                        <span className="text-green-600 dark:text-green-400">
                          Ready to claim!
                        </span>
                      ) : timeUntilUnlock > 0 ? (
                        <span>
                          Unlocks in:{" "}
                          {daysUntilUnlock > 0 ? `${daysUntilUnlock}d ` : ""}
                          {hoursUntilUnlock}h
                        </span>
                      ) : (
                        <span>
                          Unlock:{" "}
                          {new Date(
                            Number(o.unlockTime) * 1000,
                          ).toLocaleString()}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">
                      Status:{" "}
                      {o.cancelled
                        ? "❌ Cancelled"
                        : o.fulfilled
                          ? "✅ Fulfilled"
                          : o.approved
                            ? "⏳ Approved"
                            : "🆕 Pending"}
                    </div>
                  </div>
                  <button
                    disabled={!canClaim || isClaiming}
                    onClick={() => claim(o.id)}
                    className="px-3 py-1.5 text-sm font-medium rounded-md bg-black text-white dark:bg-white dark:text-black disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isClaiming ? "Claiming..." : "Claim"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
