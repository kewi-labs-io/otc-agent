"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useAccount, useDisconnect } from "wagmi";
import type { TransactionError } from "@/types";
import { clearWalletCachesAndReload } from "@/utils/wallet-utils";

export function useTransactionErrorHandler() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const { disconnect } = useDisconnect();
  const { address } = useAccount();
  const { logout } = usePrivy();

  const isNonceError = useCallback((error: TransactionError): boolean => {
    const errorStr = error.message.toLowerCase();
    const causeStr =
      error.cause &&
      typeof error.cause === "object" &&
      "reason" in error.cause &&
      typeof error.cause.reason === "string"
        ? error.cause.reason.toLowerCase()
        : "";
    const detailsStr =
      error.details && typeof error.details === "string" ? error.details.toLowerCase() : "";
    const shortMsg =
      error.shortMessage && typeof error.shortMessage === "string"
        ? error.shortMessage.toLowerCase()
        : "";

    const noncePatterns = [
      "nonce too high",
      "nonce has already been used",
      "invalid nonce",
      "replacement transaction underpriced",
      "transaction nonce is too low",
    ];

    return noncePatterns.some(
      (pattern) =>
        errorStr.includes(pattern) ||
        causeStr.includes(pattern) ||
        detailsStr.includes(pattern) ||
        shortMsg.includes(pattern),
    );
  }, []);

  const isUserRejection = useCallback((error: TransactionError): boolean => {
    const errorStr = error.message.toLowerCase();
    const causeStr =
      error.cause &&
      typeof error.cause === "object" &&
      "reason" in error.cause &&
      typeof error.cause.reason === "string"
        ? error.cause.reason.toLowerCase()
        : "";

    return (
      errorStr.includes("user rejected") ||
      errorStr.includes("user denied") ||
      errorStr.includes("user cancel") ||
      causeStr.includes("user rejected")
    );
  }, []);

  const resetWalletConnection = useCallback(async () => {
    if (!mounted) return;

    // Disconnect EVM wallet
    if (address) {
      await disconnect();
    }

    // Logout from Privy (handles all wallet types)
    await logout();

    // Clear all wallet caches and reload (slightly longer delay for error recovery)
    clearWalletCachesAndReload(1000);
  }, [mounted, address, disconnect, logout]);

  const handleTransactionError = useCallback(
    (error: TransactionError): string => {
      if (!mounted) return "Transaction failed";

      console.error("[TxError]", error);

      if (isUserRejection(error)) {
        return "Transaction was cancelled";
      }

      if (isNonceError(error)) {
        console.error("[TxError] Nonce error detected - likely chain reset");

        if (typeof window !== "undefined") {
          toast.error("Wallet State Out of Sync", {
            description:
              "Your wallet nonce is out of sync with the blockchain. This happens when the local chain is reset.",
            duration: 15000,
            action: {
              label: "Reset Wallet",
              onClick: resetWalletConnection,
            },
          });
        }

        return "Wallet nonce error - please reset your wallet connection using the button above";
      }

      if (error.message.includes("insufficient funds")) {
        return "Insufficient funds to complete transaction";
      }

      if (error.message.includes("gas")) {
        return "Transaction failed due to gas estimation error";
      }

      if (error.shortMessage) {
        return error.shortMessage;
      }
      return error.message;
    },
    [mounted, isNonceError, isUserRejection, resetWalletConnection],
  );

  return {
    handleTransactionError,
  };
}
