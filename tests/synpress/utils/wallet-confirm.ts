/**
 * Robust Wallet Transaction Confirmation Utilities
 *
 * Handles flaky wallet popup confirmation by:
 * 1. Using longer timeouts (30+ seconds)
 * 2. Retrying multiple times
 * 3. Actively looking for notification popups across all contexts
 * 4. Dismissing promotional popups that might be blocking
 * 5. Ensuring proper page focus
 */

import { type BrowserContext, expect, type Page } from "@playwright/test";
import type { MetaMask, Phantom } from "@synthetixio/synpress/playwright";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Configuration for robust confirmation
 */
const CONFIRM_CONFIG = {
  maxRetries: 5,
  initialTimeout: 30000, // 30 seconds to find popup
  retryDelay: 2000, // 2 seconds between retries
  popupWaitTime: 5000, // Wait for popup to appear after action
};

/**
 * Find and return all extension notification pages in the context
 */
async function findNotificationPages(
  context: BrowserContext,
  extensionId: string,
): Promise<Page[]> {
  const notificationUrl = `chrome-extension://${extensionId}/notification.html`;
  return context.pages().filter((page) => page.url().includes(notificationUrl));
}

/**
 * Dismiss any promotional/onboarding popups in wallet extension windows
 */
async function dismissWalletPopups(context: BrowserContext): Promise<void> {
  for (const page of context.pages()) {
    // Skip non-extension pages
    if (!page.url().includes("chrome-extension://")) continue;

    // Try to bring extension page to front first
    try {
      await page.bringToFront();
    } catch {
      // Page may be closed
    }

    const dismissSelectors = [
      // MetaMask specific
      'button[data-testid="popover-close"]',
      'button[data-testid="whats-new-popup-close-button"]',
      'button[data-testid="onboarding-complete"]',
      '[data-testid="auto-detect-token-modal-close"]',
      // Phantom specific
      'button[data-testid="dismiss"]',
      // Generic
      'button:has-text("Got it")',
      'button:has-text("Not now")',
      'button:has-text("No thanks")',
      'button:has-text("Skip")',
      'button:has-text("Close")',
      'button:has-text("Dismiss")',
      'button:has-text("Later")',
      'button:has-text("Maybe later")',
      '[aria-label="Close"]',
      '[aria-label="Dismiss"]',
      '[aria-label="close"]',
    ];

    for (const selector of dismissSelectors) {
      try {
        const button = page.locator(selector).first();
        if (await button.isVisible({ timeout: 300 }).catch(() => false)) {
          console.log(`[dismissWalletPopups] Dismissing popup with selector: ${selector}`);
          await button.click();
          await sleep(500);
        }
      } catch {
        // Button may have disappeared
      }
    }
  }
}

/**
 * Wait for a notification popup to appear with extended timeout
 */
async function _waitForNotificationPopup(
  context: BrowserContext,
  extensionId: string,
  timeout: number = CONFIRM_CONFIG.initialTimeout,
): Promise<Page | null> {
  const notificationUrl = `chrome-extension://${extensionId}/notification.html`;
  const isNotificationPage = (page: Page) => page.url().includes(notificationUrl);

  // Check if already open
  let notificationPage = context.pages().find(isNotificationPage);
  if (notificationPage) {
    return notificationPage;
  }

  // Wait for it to appear
  try {
    notificationPage = await context.waitForEvent("page", {
      predicate: isNotificationPage,
      timeout,
    });
    return notificationPage;
  } catch {
    return null;
  }
}

/**
 * Handle MetaMask spending cap approval flow (ERC20 approve)
 * MetaMask shows a two-step flow: 1) Spending cap request -> 2) Confirm
 */
async function handleSpendingCapApproval(notificationPage: Page): Promise<boolean> {
  console.log("[handleSpendingCapApproval] Checking for spending cap dialog...");

  // Check if we're on the spending cap dialog
  const spendingCapIndicators = [
    "text=/spending cap/i",
    "text=/site requested/i",
    '[data-testid="page-container-footer-next"]:has-text("Next")',
  ];

  for (const indicator of spendingCapIndicators) {
    if (
      await notificationPage
        .locator(indicator)
        .first()
        .isVisible({ timeout: 2000 })
        .catch(() => false)
    ) {
      console.log("[handleSpendingCapApproval] Spending cap dialog detected");

      // Scroll to bottom to ensure all content is viewed (MetaMask sometimes requires this)
      try {
        await notificationPage.evaluate(() => {
          const scrollContainer = document.querySelector(".page-container__content");
          if (scrollContainer) {
            scrollContainer.scrollTop = scrollContainer.scrollHeight;
          }
        });
        await sleep(500);
      } catch {
        // Scroll failed, continue anyway
      }

      // Click "Use default" if available to accept the requested spending cap
      const useDefaultBtn = notificationPage.locator('button:has-text("Use default")').first();
      if (await useDefaultBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        console.log("[handleSpendingCapApproval] Clicking 'Use default'");
        await useDefaultBtn.click();
        await sleep(500);
      }

      // Now click the "Next" button to proceed to confirmation
      const nextBtn = notificationPage
        .locator('[data-testid="page-container-footer-next"]')
        .first();

      // Wait for button to be enabled
      try {
        await expect(nextBtn).toBeEnabled({ timeout: 10000 });
        console.log("[handleSpendingCapApproval] Next button is enabled, clicking...");
        await nextBtn.click();
        await sleep(1000);
        return true;
      } catch (_e) {
        console.log("[handleSpendingCapApproval] Next button not enabled, trying force click...");
        // Try clicking anyway with force
        await nextBtn.click({ force: true }).catch(() => {});
        await sleep(1000);
        return true;
      }
    }
  }

  return false;
}

/**
 * Robust MetaMask transaction confirmation with retries
 */
export async function confirmMetaMaskTransaction(
  page: Page,
  context: BrowserContext,
  metamask: MetaMask,
  options?: {
    maxRetries?: number;
    timeout?: number;
  },
): Promise<boolean> {
  const maxRetries = options?.maxRetries ?? CONFIRM_CONFIG.maxRetries;
  const timeout = options?.timeout ?? CONFIRM_CONFIG.initialTimeout;

  console.log("[confirmMetaMaskTransaction] Starting robust confirmation...");

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[confirmMetaMaskTransaction] Attempt ${attempt}/${maxRetries}`);

      // Dismiss any popups that might be blocking
      await dismissWalletPopups(context);

      // Wait a moment for the popup to stabilize
      await sleep(1000);

      // Find the notification page first
      const extensionId = metamask.extensionId;
      if (extensionId) {
        const notificationPages = await findNotificationPages(context, extensionId);
        if (notificationPages.length > 0) {
          const notificationPage = notificationPages[0];

          // Bring notification page to front
          try {
            await notificationPage.bringToFront();
            console.log(
              "[confirmMetaMaskTransaction] Notification page found and brought to front",
            );
          } catch {
            // Continue anyway
          }

          // Dismiss any popups on the notification page specifically
          await dismissWalletPopups(context);

          // Handle spending cap approval flow if present
          const handledSpendingCap = await handleSpendingCapApproval(notificationPage);
          if (handledSpendingCap) {
            console.log(
              "[confirmMetaMaskTransaction] Handled spending cap dialog, now looking for confirm...",
            );
            await sleep(1000);
          }

          // Wait for the actual confirm button to be visible
          const confirmSelectors = [
            '[data-testid="confirm-footer-button"]',
            '[data-testid="page-container-footer-next"]',
            'button.btn-primary:has-text("Confirm")',
            'button:has-text("Approve")',
          ];

          for (const selector of confirmSelectors) {
            const confirmBtn = notificationPage.locator(selector).first();
            if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
              console.log(
                `[confirmMetaMaskTransaction] Found confirm button with selector: ${selector}`,
              );
              break;
            }
          }
        }
      }

      // Try the standard confirm method with increased timeout
      const confirmPromise = metamask.confirmTransaction();
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Timeout")), timeout),
      );

      await Promise.race([confirmPromise, timeoutPromise]);

      // Success!
      console.log("[confirmMetaMaskTransaction] Transaction confirmed successfully");

      // Bring main page back to focus
      await page.bringToFront();

      return true;
    } catch (error) {
      console.log(
        `[confirmMetaMaskTransaction] Attempt ${attempt} failed: ${error instanceof Error ? error.message : String(error)}`,
      );

      if (attempt < maxRetries) {
        // Wait before retrying
        await sleep(CONFIRM_CONFIG.retryDelay);

        // Try dismissing popups again
        await dismissWalletPopups(context);

        // Try to bring any notification page to front
        const extensionId = metamask.extensionId;
        if (extensionId) {
          const notificationPages = await findNotificationPages(context, extensionId);
          if (notificationPages.length > 0) {
            try {
              await notificationPages[0].bringToFront();
              console.log("[confirmMetaMaskTransaction] Brought notification page to front");
            } catch {
              // Page may have closed
            }
          }
        }
      }
    }
  }

  console.log("[confirmMetaMaskTransaction] All attempts failed");
  return false;
}

/**
 * Handle Phantom warning dialogs (like "Confirm anyway" for unverified tokens or insufficient funds)
 */
async function handlePhantomWarnings(notificationPage: Page): Promise<boolean> {
  console.log("[handlePhantomWarnings] Checking for warning dialogs...");

  // Phantom shows warning dialogs for unverified tokens, insufficient SOL, risky transactions, etc.
  // Use case-insensitive matching for button text
  const warningButtonSelectors = [
    'button:has-text("Confirm anyway")', // lowercase - Phantom uses this
    'button:has-text("Confirm Anyway")', // mixed case - just in case
    'button:text-is("Confirm anyway")',
    'button:text-is("Confirm Anyway")',
    'button:has-text("Continue anyway")',
    'button:has-text("Continue Anyway")',
    'button:has-text("I understand")',
    'button:has-text("Proceed")',
    'button:has-text("Accept Risk")',
    '[data-testid="warning-accept"]',
  ];

  for (const selector of warningButtonSelectors) {
    try {
      const button = notificationPage.locator(selector).first();
      if (await button.isVisible({ timeout: 1000 }).catch(() => false)) {
        console.log(`[handlePhantomWarnings] Found warning button: ${selector}`);
        await button.click();
        await sleep(500);
        return true;
      }
    } catch {
      // Button not found, continue
    }
  }

  return false;
}

/**
 * Robust Phantom transaction confirmation with retries
 */
export async function confirmPhantomTransaction(
  page: Page,
  context: BrowserContext,
  phantom: Phantom,
  options?: {
    maxRetries?: number;
    timeout?: number;
  },
): Promise<boolean> {
  const maxRetries = options?.maxRetries ?? CONFIRM_CONFIG.maxRetries;
  const timeout = options?.timeout ?? CONFIRM_CONFIG.initialTimeout;

  console.log("[confirmPhantomTransaction] Starting robust confirmation...");

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[confirmPhantomTransaction] Attempt ${attempt}/${maxRetries}`);

      // Dismiss any popups that might be blocking
      await dismissWalletPopups(context);

      // Wait a moment for the popup to stabilize
      await sleep(1000);

      // Find notification page and handle any warning dialogs first
      const extensionId = phantom.extensionId;
      if (extensionId) {
        const notificationPages = await findNotificationPages(context, extensionId);
        if (notificationPages.length > 0) {
          const notificationPage = notificationPages[0];

          // Bring to front
          try {
            await notificationPage.bringToFront();
          } catch {
            // Continue anyway
          }

          // Handle "Confirm Anyway" and other warning dialogs
          const handledWarning = await handlePhantomWarnings(notificationPage);
          if (handledWarning) {
            console.log("[confirmPhantomTransaction] Handled warning dialog, continuing...");
            await sleep(1000);
          }
        }
      }

      // Try the standard confirm method
      const confirmPromise = phantom.confirmTransaction();
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Timeout")), timeout),
      );

      await Promise.race([confirmPromise, timeoutPromise]);

      // Success!
      console.log("[confirmPhantomTransaction] Transaction confirmed successfully");

      // Bring main page back to focus
      await page.bringToFront();

      return true;
    } catch (error) {
      console.log(
        `[confirmPhantomTransaction] Attempt ${attempt} failed: ${error instanceof Error ? error.message : String(error)}`,
      );

      if (attempt < maxRetries) {
        // Wait before retrying
        await sleep(CONFIRM_CONFIG.retryDelay);

        // Try dismissing popups again
        await dismissWalletPopups(context);

        // Try to bring any notification page to front and handle warnings
        const extensionId = phantom.extensionId;
        if (extensionId) {
          const notificationPages = await findNotificationPages(context, extensionId);
          if (notificationPages.length > 0) {
            try {
              const notificationPage = notificationPages[0];
              await notificationPage.bringToFront();
              console.log("[confirmPhantomTransaction] Brought notification page to front");

              // Try handling warnings again
              await handlePhantomWarnings(notificationPage);
            } catch {
              // Page may have closed
            }
          }
        }
      }
    }
  }

  console.log("[confirmPhantomTransaction] All attempts failed");
  return false;
}

/**
 * Manual confirmation fallback - tries to find and click confirm button directly
 */
export async function manualConfirmTransaction(
  context: BrowserContext,
  extensionId: string,
  walletType: "metamask" | "phantom",
): Promise<boolean> {
  console.log(`[manualConfirmTransaction] Attempting manual ${walletType} confirmation...`);

  const notificationUrl = `chrome-extension://${extensionId}/notification.html`;
  const notificationPages = context.pages().filter((p) => p.url().includes(notificationUrl));

  if (notificationPages.length === 0) {
    console.log("[manualConfirmTransaction] No notification page found");
    return false;
  }

  const notificationPage = notificationPages[0];

  // Bring to front
  try {
    await notificationPage.bringToFront();
  } catch {
    console.log("[manualConfirmTransaction] Could not bring page to front");
  }

  // For Phantom: First handle any warning dialogs ("Confirm Anyway", etc.)
  if (walletType === "phantom") {
    await handlePhantomWarnings(notificationPage);
    await sleep(500);
  }

  // Now try to click the main confirm button
  try {
    await notificationPage.bringToFront();
  } catch {
    console.log("[manualConfirmTransaction] Could not bring page to front");
  }

  // Define confirm button selectors for each wallet
  const confirmSelectors =
    walletType === "metamask"
      ? [
          '[data-testid="confirm-footer-button"]',
          '[data-testid="page-container-footer-next"]',
          'button:has-text("Confirm")',
          'button:has-text("Approve")',
          'button:has-text("Sign")',
        ]
      : [
          // Phantom selectors - order matters, try warning dialogs first
          'button:has-text("Confirm anyway")', // Warning dialog (lowercase)
          'button:has-text("Confirm Anyway")', // Warning dialog (mixed case)
          'button:has-text("Continue anyway")', // Warning dialog
          'button[data-testid="primary-button"]:has-text("Confirm")',
          'button:has-text("Confirm")',
          'button:has-text("Approve")',
          'button:has-text("Sign")',
          'button:has-text("Accept")',
        ];

  for (const selector of confirmSelectors) {
    const button = notificationPage.locator(selector).first();
    try {
      if (await button.isVisible({ timeout: 3000 }).catch(() => false)) {
        console.log(`[manualConfirmTransaction] Found confirm button with selector: ${selector}`);
        await button.click();
        await sleep(1000);
        return true;
      }
    } catch {
      // Try next selector
    }
  }

  console.log("[manualConfirmTransaction] Could not find confirm button");
  return false;
}
