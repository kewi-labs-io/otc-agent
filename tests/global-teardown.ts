/**
 * Global Teardown for E2E Tests
 *
 * Stops infrastructure started by global-setup.ts.
 * Only stops services that were started by setup (respects shouldStop flags).
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_PORT, killProcessesOnPort, logTeardown } from "./test-utils";

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(CURRENT_DIR, "..");
const STATE_FILE = join(PROJECT_ROOT, ".test-infrastructure-state.json");

interface InfrastructureState {
  anvilPid?: number;
  solanaPid?: number;
  nextPid?: number;
  startedAt: number;
  shouldStopAnvil: boolean;
  shouldStopSolana: boolean;
  shouldStopNext: boolean;
}

function loadState(): InfrastructureState | null {
  if (!existsSync(STATE_FILE)) {
    return null;
  }

  const content = readFileSync(STATE_FILE, "utf8");
  return JSON.parse(content) as InfrastructureState;
}

function cleanupStateFile(): void {
  if (existsSync(STATE_FILE)) {
    unlinkSync(STATE_FILE);
  }
}

function stopAnvil(): void {
  execSync("pkill -9 -f anvil 2>/dev/null || true", { stdio: "ignore" });
}

function stopNextJs(): void {
  killProcessesOnPort(APP_PORT);
  execSync("pkill -f 'next dev' 2>/dev/null || true", { stdio: "ignore" });
  execSync("pkill -f 'next-server' 2>/dev/null || true", { stdio: "ignore" });
}

function stopSolana(): void {
  execSync("pkill -9 -f solana-test-validator 2>/dev/null || true", { stdio: "ignore" });
}

function stopPostgres(): void {
  if (process.env.TEARDOWN_POSTGRES !== "true") {
    logTeardown("Keeping PostgreSQL running (set TEARDOWN_POSTGRES=true to stop)");
    return;
  }

  execSync("docker stop otc-postgres 2>/dev/null || true", { stdio: "ignore" });
  logTeardown("Stopped PostgreSQL container");
}

export default async function globalTeardown(): Promise<void> {
  logTeardown("Stopping E2E test infrastructure...");

  const state = loadState();

  if (state) {
    if (state.shouldStopNext) {
      stopNextJs();
      logTeardown("Stopped Next.js");
    }

    if (state.shouldStopAnvil) {
      stopAnvil();
      logTeardown("Stopped Anvil");
    }

    if (state.shouldStopSolana) {
      stopSolana();
      logTeardown("Stopped Solana validator");
    }

    const elapsed = ((Date.now() - state.startedAt) / 1000).toFixed(1);
    logTeardown(`Infrastructure ran for ${elapsed}s`);
  } else {
    // No state file - stop everything as fallback
    stopNextJs();
    stopAnvil();
    stopSolana();
    logTeardown("Stopped all services (no state file found)");
  }

  stopPostgres();
  cleanupStateFile();

  logTeardown("Teardown complete");
}
