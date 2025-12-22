/**
 * Transaction helpers for EVM and Solana
 * Provides polling-based confirmation to avoid WebSocket dependencies
 */

import type { Connection } from "@solana/web3.js";
import type { EvmPublicClient, SolanaCommitment } from "@/types";

/**
 * Poll for EVM transaction confirmation
 * @param client - Viem public client (or any client with getTransactionReceipt)
 * @param hash - Transaction hash
 * @param maxAttempts - Max polling attempts (default 15)
 * @param intervalMs - Polling interval in ms (default 2000)
 * @returns Transaction receipt status ("success" | "reverted" | null)
 */
export async function waitForEvmTx(
  client: EvmPublicClient,
  hash: `0x${string}`,
  maxAttempts = 15,
  intervalMs = 2000,
): Promise<"success" | "reverted" | null> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const receipt = await client.getTransactionReceipt({ hash });
      if (receipt) {
        return receipt.status;
      }
      // Receipt not found yet - this is expected during polling, continue
    } catch {
      // During polling, "receipt not found" is expected and we should continue
      // However, if it's a different error (network, RPC error), we should check
      // Most RPC clients throw specific errors for "not found" vs other errors
      // For polling logic, we continue - if it's a real error, it will persist and timeout
      // This is acceptable for polling where "not found yet" is a valid intermediate state
    }
    await sleep(intervalMs);
  }
  // FAIL-FAST: Polling exhausted - transaction may not be confirmed yet
  return null;
}

/**
 * Poll for Solana transaction confirmation
 * @param connection - Solana connection
 * @param signature - Transaction signature
 * @param commitment - Confirmation level (default "confirmed")
 * @param timeoutMs - Timeout in ms (default 60000)
 * @param pollIntervalMs - Polling interval in ms (default 1000)
 */
export async function waitForSolanaTx(
  connection: Connection,
  signature: string,
  commitment: SolanaCommitment = "confirmed",
  timeoutMs = 60000,
  pollIntervalMs = 1000,
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const response = await connection.getSignatureStatuses([signature]);
    // FAIL-FAST: Response structure must be valid
    if (!response) {
      throw new Error("getSignatureStatuses returned null response");
    }
    if (!response.value) {
      throw new Error("getSignatureStatuses response missing value field");
    }
    if (response.value.length === 0) {
      await sleep(pollIntervalMs);
      continue;
    }
    const status = response.value[0];

    if (status) {
      if (status.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
      }

      const confirmationStatus = status.confirmationStatus;
      const isConfirmed =
        commitment === "processed"
          ? Boolean(confirmationStatus)
          : commitment === "confirmed"
            ? confirmationStatus === "confirmed" || confirmationStatus === "finalized"
            : confirmationStatus === "finalized";

      if (isConfirmed) return;
    }

    await sleep(pollIntervalMs);
  }

  throw new Error(`Transaction confirmation timeout after ${timeoutMs}ms`);
}

/**
 * Simple sleep utility
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
