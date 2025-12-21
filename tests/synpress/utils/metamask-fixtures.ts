import path from "node:path";

import { chromium, test as base, type BrowserContext, type Page } from "@playwright/test";
import {
  CACHE_DIR_NAME,
  createTempContextDir,
  defineWalletSetup,
  prepareExtension,
  removeTempContextDir,
} from "@synthetixio/synpress-cache";
import fs from "fs-extra";

import {
  getExtensionId,
  unlockForFixture,
} from "@synthetixio/synpress-metamask/playwright";
import type { MetaMaskFixtures } from "@/types";

async function persistLocalStorage(
  origins: {
    readonly origin: string;
    readonly localStorage: ReadonlyArray<{ readonly name: string; readonly value: string }>;
  }[],
  context: BrowserContext,
): Promise<void> {
  const newPage = await context.newPage();

  for (const { origin, localStorage } of origins) {
    const frame = newPage.mainFrame();
    await frame.goto(origin);

    await frame.evaluate((localStorageData) => {
      localStorageData.forEach(({ name, value }) => {
        window.localStorage.setItem(name, value);
      });
    }, localStorage);
  }

  await newPage.close();
}

async function waitUntilStable(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded", { timeout: 10_000 });
  // networkidle can be flaky for extension UIs; treat as best-effort.
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
}

async function getExtensionIdWithRetry(
  context: BrowserContext,
  extensionName: string,
  timeoutMs = 30_000,
): Promise<string> {
  const start = Date.now();
  let lastError: Error | null = null;

  while (Date.now() - start < timeoutMs) {
    try {
      return await getExtensionId(context, extensionName);
    } catch (e) {
      lastError = e instanceof Error ? e : new Error("Failed to get extension id");
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  throw lastError ?? new Error("Failed to get extension id");
}

/**
 * Patched MetaMask fixtures for Synpress.
 *
 * Fixes upstream behavior where MetaMask may not be loaded from a cached profile
 * because `--load-extension` is omitted.
 */
export const metaMaskFixtures = (
  walletSetup: ReturnType<typeof defineWalletSetup>,
  slowMo = 0,
) => {
  return base.extend<MetaMaskFixtures>({
    _contextPath: async ({ browserName }, use, testInfo) => {
      const contextPath = await createTempContextDir(browserName, testInfo.testId);

      await use(contextPath);

      const error = await removeTempContextDir(contextPath);
      if (error) {
        // eslint-disable-next-line no-console
        console.error(error);
      }
    },

    context: async ({ context: currentContext, _contextPath }, use) => {
      const { walletPassword, hash } = walletSetup;

      const cacheDirPath = path.join(process.cwd(), CACHE_DIR_NAME, hash);
      if (!(await fs.exists(cacheDirPath))) {
        throw new Error(`Cache for ${hash} does not exist. Create it first.`);
      }

      // Copy cache into a temp context dir
      await fs.copy(cacheDirPath, _contextPath);

      const metamaskPath = await prepareExtension();

      // Ensure extension is actually loaded (required on some platforms).
      const browserArgs = [
        `--disable-extensions-except=${metamaskPath}`,
        `--load-extension=${metamaskPath}`,
      ];

      if (process.env.HEADLESS) {
        browserArgs.push("--headless=new");
      }

      const context = await chromium.launchPersistentContext(_contextPath, {
        headless: false,
        args: browserArgs,
        slowMo: process.env.HEADLESS ? 0 : slowMo,
      });

      const { cookies, origins } = await currentContext.storageState();

      // cookies and origins are arrays - check length directly
      if (Array.isArray(cookies) && cookies.length > 0) {
        await context.addCookies(cookies);
      }
      if (Array.isArray(origins) && origins.length > 0) {
        await persistLocalStorage(origins, context);
      }

      const extensionId = await getExtensionIdWithRetry(context, "MetaMask");

      const metamaskPage = context.pages()[0];
      if (!metamaskPage) throw new Error("MetaMask page not found in context");

      await metamaskPage.goto(`chrome-extension://${extensionId}/home.html`);
      await waitUntilStable(metamaskPage);
      await unlockForFixture(metamaskPage, walletPassword);

      await use(context);

      await context.close();
    },

    metamaskPage: async ({ context }, use) => {
      const extensionId = await getExtensionIdWithRetry(context, "MetaMask");
      const page = context.pages()[0];
      if (!page) throw new Error("MetaMask page not found in context");

      // Best-effort: if we somehow started on a blank page, navigate to home.
      if (!page.url().startsWith(`chrome-extension://${extensionId}`)) {
        await page.goto(`chrome-extension://${extensionId}/home.html`);
      }

      await use(page);
    },

    extensionId: async ({ context }, use) => {
      const extensionId = await getExtensionIdWithRetry(context, "MetaMask");
      await use(extensionId);
    },

    page: async ({ page }, use) => {
      await page.goto("/");
      await use(page);
    },
  });
};
