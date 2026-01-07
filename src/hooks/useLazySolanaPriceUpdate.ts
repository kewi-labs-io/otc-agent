/**
 * Lazy Solana Price Update Hook
 *
 * Stale-while-revalidate pattern for Solana on-chain prices:
 * 1. Show cached price immediately (fast UX)
 * 2. Trigger background update if price is stale (no blocking)
 * 3. By the time user clicks to buy, price should be fresh
 *
 * This is cost-efficient: only updates prices for tokens users actually view.
 */

import { useEffect, useRef } from "react";

// Track which token mints we've already triggered updates for
// Prevents duplicate updates within a session
const updatedMints = new Set<string>();

// Minimum time between update attempts for the same mint (5 minutes)
const UPDATE_COOLDOWN_MS = 5 * 60 * 1000;
const lastUpdateAttempts = new Map<string, number>();

/**
 * Trigger a background price update for a Solana token.
 * Fire-and-forget - doesn't block or return status.
 */
async function triggerBackgroundUpdate(tokenMint: string): Promise<void> {
  // Skip if already updated this session
  if (updatedMints.has(tokenMint)) {
    return;
  }

  // Skip if recently attempted (cooldown)
  const lastAttempt = lastUpdateAttempts.get(tokenMint);
  if (lastAttempt && Date.now() - lastAttempt < UPDATE_COOLDOWN_MS) {
    return;
  }

  // Mark as attempting
  lastUpdateAttempts.set(tokenMint, Date.now());

  try {
    // First, check if price is stale (fast GET)
    const checkRes = await fetch(
      `/api/solana/update-price?tokenMint=${encodeURIComponent(tokenMint)}`,
    );
    const checkData = await checkRes.json();

    // If price is fresh, skip update
    if (!checkData.isStale && checkData.price > 0) {
      console.log(`[LazyPrice] ${tokenMint.slice(0, 8)}... price is fresh ($${checkData.price})`);
      updatedMints.add(tokenMint);
      return;
    }

    // Price is stale - trigger background update (POST)
    console.log(
      `[LazyPrice] ${tokenMint.slice(0, 8)}... price stale, updating in background...`,
    );

    // Fire-and-forget - don't await
    fetch("/api/solana/update-price", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tokenMint, forceUpdate: false }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.updated) {
          console.log(
            `[LazyPrice] ${tokenMint.slice(0, 8)}... updated: $${data.oldPrice} → $${data.newPrice}`,
          );
        } else if (data.stale) {
          console.warn(
            `[LazyPrice] ${tokenMint.slice(0, 8)}... could not update (needs desk owner key)`,
          );
        } else {
          console.log(`[LazyPrice] ${tokenMint.slice(0, 8)}... no update needed`);
        }
        updatedMints.add(tokenMint);
      })
      .catch((err) => {
        console.warn(`[LazyPrice] ${tokenMint.slice(0, 8)}... update failed:`, err);
        // Don't mark as updated on failure - allow retry after cooldown
      });
  } catch (err) {
    console.warn(`[LazyPrice] ${tokenMint.slice(0, 8)}... check failed:`, err);
  }
}

/**
 * Hook to lazily update Solana token prices when viewing deals.
 *
 * @param tokenMints - Array of Solana token mint addresses to check/update
 */
export function useLazySolanaPriceUpdate(tokenMints: string[]): void {
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    // Filter to only Solana addresses (44 chars base58)
    const solanaAddresses = tokenMints.filter((mint) => {
      // Basic validation: Solana addresses are 32-44 chars, base58
      return mint && mint.length >= 32 && mint.length <= 44 && !/^0x/i.test(mint);
    });

    if (solanaAddresses.length === 0) return;

    // Trigger updates for each token (fire-and-forget, async)
    for (const mint of solanaAddresses) {
      triggerBackgroundUpdate(mint).catch(() => {
        // Errors handled inside function
      });
    }

    return () => {
      mountedRef.current = false;
    };
  }, [tokenMints.join(",")]); // Re-run when mints change
}

/**
 * Hook to lazily update a single Solana token price.
 *
 * @param tokenMint - Solana token mint address (or null/undefined to skip)
 */
export function useLazySolanaPriceUpdateSingle(tokenMint: string | null | undefined): void {
  const mints = tokenMint ? [tokenMint] : [];
  useLazySolanaPriceUpdate(mints);
}

/**
 * Manually trigger a price update (use when entering accept-quote-modal).
 * Returns immediately - update happens in background.
 */
export function triggerLazyPriceUpdate(tokenMint: string): void {
  triggerBackgroundUpdate(tokenMint).catch(() => {
    // Errors handled inside function
  });
}
