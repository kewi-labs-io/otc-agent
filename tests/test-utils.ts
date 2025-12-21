/**
 * Consolidated E2E Test Utilities
 *
 * Shared utilities for all E2E tests.
 */

import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { Address } from "viem";

// =============================================================================
// CONSTANTS
// =============================================================================

export const PROJECT_ROOT = process.cwd();
export const ANVIL_PORT = 8545;
export const SOLANA_PORT = 8899;
export const APP_PORT = 4444;
export const POSTGRES_PORT = 5439;
export const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || `http://localhost:${APP_PORT}`;
export const TEST_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// =============================================================================
// ASSERTION HELPERS
// =============================================================================

/**
 * Assert that a value is defined and not null. Throws if undefined/null.
 */
export function expectDefined<T>(value: T | undefined | null, message: string): T {
  if (value === undefined) {
    throw new Error(`Expected value to be defined: ${message}`);
  }
  return value;
}

/**
 * Assert that a string is non-empty. Throws if empty or not a string.
 */
export function expectNonEmptyString(value: string | undefined | null, message: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Expected non-empty string: ${message}, got: ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * Assert that a value matches a regex pattern. Throws if no match.
 */
export function expectMatch(value: string, pattern: RegExp, message: string): string {
  if (!pattern.test(value)) {
    throw new Error(`Expected ${message} to match ${pattern}, got: ${value}`);
  }
  return value;
}

/**
 * Assert that an EVM address is valid (0x + 40 hex chars). Throws if invalid.
 */
export function expectEvmAddress(value: string | undefined | null, message: string): Address {
  const addr = expectNonEmptyString(value, message);
  if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) {
    throw new Error(`Invalid EVM address for ${message}: ${addr}`);
  }
  return addr as Address;
}

/**
 * Assert that a Solana address is valid (base58, 32-44 chars). Throws if invalid.
 */
export function expectSolanaAddress(value: string | undefined | null, message: string): string {
  const addr = expectNonEmptyString(value, message);
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)) {
    throw new Error(`Invalid Solana address for ${message}: ${addr}`);
  }
  return addr;
}

/**
 * Assert that a number is positive. Throws if not.
 */
export function expectPositive(value: number | bigint, message: string): number | bigint {
  if (typeof value === "bigint" ? value <= 0n : value <= 0) {
    throw new Error(`Expected positive number for ${message}, got: ${value}`);
  }
  return value;
}

/**
 * Assert that a value equals an expected value. Throws if not equal.
 */
export function expectEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`Expected ${message} to equal ${expected}, got: ${actual}`);
  }
}

// =============================================================================
// PORT AND PROCESS UTILITIES
// =============================================================================

/**
 * Check if a port is in use. Returns true if listening, false otherwise.
 */
export function isPortInUse(port: number): boolean {
  try {
    execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Kill all processes listening on a given port.
 */
export function killProcessesOnPort(port: number): void {
  try {
    const out = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`, {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    if (!out) return;

    for (const pidStr of out.split(/\s+/)) {
      const pid = Number(pidStr);
      if (Number.isFinite(pid) && pid > 0) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // Process may have already exited
        }
      }
    }
  } catch {
    // No listeners on port
  }
}

/**
 * Wait for a port to become available. Throws on timeout.
 */
export async function waitForPort(port: number, timeoutMs: number = 30000): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    if (isPortInUse(port)) {
      return;
    }
    await sleep(500);
  }
  throw new Error(`Timeout waiting for port ${port} after ${timeoutMs}ms`);
}

/**
 * Wait for a port to close. Throws on timeout.
 */
export async function waitForPortToClose(port: number, timeoutMs: number = 30000): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    if (!isPortInUse(port)) {
      return;
    }
    await sleep(500);
  }
  throw new Error(`Timeout waiting for port ${port} to close after ${timeoutMs}ms`);
}

// =============================================================================
// HTTP UTILITIES
// =============================================================================

/**
 * Wait for a URL to be reachable (returns 2xx or 404). Throws on timeout.
 */
export async function waitForUrl(url: string, timeoutMs: number = 60000): Promise<void> {
  const startTime = Date.now();
  let lastError: Error | null = null;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(url, {
        method: "HEAD",
        signal: AbortSignal.timeout(5000),
      });
      // Accept 2xx or 404 (server is up, just path not found)
      if (response.ok || response.status === 404) {
        return;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
    }
    await sleep(1000);
  }

  // FAIL-FAST: Extract error message - prefer Error.message, fallback to string conversion
  const errorMessage = lastError instanceof Error
    ? lastError.message
    : lastError
      ? String(lastError)
      : "Unknown error";
  throw new Error(`Timeout waiting for ${url} after ${timeoutMs}ms: ${errorMessage}`);
}

/**
 * Wait for the test server to be ready. Throws on timeout.
 */
export async function waitForServer(maxWaitMs: number = 60000): Promise<void> {
  await waitForUrl(`${BASE_URL}/api/tokens`, maxWaitMs);
}

/**
 * Perform a health check on the test server. Throws if unhealthy.
 */
export async function assertServerHealthy(): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/tokens`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    throw new Error(`Server health check failed: HTTP ${res.status}`);
  }
}

// =============================================================================
// EVM RPC UTILITIES
// =============================================================================

interface EvmRpcResponse {
  result?: string;
  error?: { message?: string };
}

/**
 * Get the nonce for an EVM address. Throws on failure.
 */
export async function getEvmNonce(rpcUrl: string, address: string): Promise<bigint> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getTransactionCount",
      params: [address, "latest"],
    }),
  });

  if (!response.ok) {
    throw new Error(`RPC ${rpcUrl} returned HTTP ${response.status}`);
  }

  const data = (await response.json()) as EvmRpcResponse;

  // FAIL-FAST: RPC errors must include message
  if (data.error && typeof data.error.message === "string") {
    throw new Error(`RPC error: ${data.error.message}`);
  }

  const result = expectNonEmptyString(data.result, "eth_getTransactionCount result");
  if (!result.startsWith("0x")) {
    throw new Error(`Invalid eth_getTransactionCount response: ${result}`);
  }

  return BigInt(result);
}

/**
 * Check if Anvil is ready with a fresh chain state (nonce 0 for deployer).
 */
export async function assertAnvilFresh(rpcUrl: string): Promise<void> {
  const deployer = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
  const nonce = await getEvmNonce(rpcUrl, deployer);
  if (nonce !== 0n) {
    throw new Error(`Anvil not fresh: deployer nonce is ${nonce}, expected 0`);
  }
}

// =============================================================================
// FILE AND DEPLOYMENT UTILITIES
// =============================================================================

interface EvmDeploymentFile {
  contracts: {
    deal?: string;
    otc?: string;
    elizaToken?: string;
    usdc?: string;
    usdcToken?: string;
  };
}

interface LocalEvmConfig {
  contracts: {
    otc: string;
    usdc: string;
    elizaToken: string;
  };
}

export interface EvmDeployment {
  otc: Address;
  token: Address;
  usdc: Address;
}

/**
 * Load EVM deployment addresses. Throws if not found.
 */
export function loadEvmDeployment(): EvmDeployment {
  const deploymentPath = join(PROJECT_ROOT, "contracts/deployments/eliza-otc-deployment.json");
  const localEvmPath = join(PROJECT_ROOT, "src/config/deployments/local-evm.json");

  if (existsSync(deploymentPath)) {
    const deployment = JSON.parse(readFileSync(deploymentPath, "utf8")) as EvmDeploymentFile;
    // Handle legacy contract names - fail-fast if neither exists
    const otc = deployment.contracts.otc ?? deployment.contracts.deal;
    if (!otc) {
      throw new Error("EVM deployment missing OTC contract address (expected contracts.otc or contracts.deal)");
    }
    const token = deployment.contracts.elizaToken;
    if (!token) {
      throw new Error("EVM deployment missing elizaToken contract address");
    }
    // Handle legacy USDC contract names - fail-fast if neither exists
    const usdc = deployment.contracts.usdc ?? deployment.contracts.usdcToken;
    if (!usdc) {
      throw new Error("EVM deployment missing USDC contract address (expected contracts.usdc or contracts.usdcToken)");
    }

    return {
      otc: expectEvmAddress(otc, "OTC contract"),
      token: expectEvmAddress(token, "ElizaToken contract"),
      usdc: expectEvmAddress(usdc, "USDC contract"),
    };
  }

  if (existsSync(localEvmPath)) {
    const local = JSON.parse(readFileSync(localEvmPath, "utf8")) as LocalEvmConfig;
    return {
      otc: expectEvmAddress(local.contracts.otc, "OTC contract"),
      token: expectEvmAddress(local.contracts.elizaToken, "ElizaToken contract"),
      usdc: expectEvmAddress(local.contracts.usdc, "USDC contract"),
    };
  }

  // Check environment variables
  const envOtc = process.env.EVM_OTC_ADDRESS;
  const envToken = process.env.EVM_ELIZA_ADDRESS;
  const envUsdc = process.env.EVM_USDC_ADDRESS;

  return {
    otc: expectEvmAddress(envOtc, "EVM_OTC_ADDRESS"),
    token: expectEvmAddress(envToken, "EVM_ELIZA_ADDRESS"),
    usdc: expectEvmAddress(envUsdc, "EVM_USDC_ADDRESS"),
  };
}

interface SolanaDeploymentFile {
  programId: string;
  desk: string;
  deskOwner: string;
  usdcMint: string;
  rpc?: string;
}

export interface SolanaDeployment {
  programId: string;
  desk: string;
  deskOwner: string;
  usdcMint: string;
  rpc: string;
}

/**
 * Load Solana deployment addresses. Throws if not found.
 */
export function loadSolanaDeployment(): SolanaDeployment {
  const localSolanaPath = join(PROJECT_ROOT, "src/config/deployments/local-solana.json");

  if (existsSync(localSolanaPath)) {
    const local = JSON.parse(readFileSync(localSolanaPath, "utf8")) as SolanaDeploymentFile;
    return {
      programId: expectSolanaAddress(local.programId, "programId"),
      desk: expectSolanaAddress(local.desk, "desk"),
      deskOwner: expectSolanaAddress(local.deskOwner, "deskOwner"),
      usdcMint: expectSolanaAddress(local.usdcMint, "usdcMint"),
      rpc: local.rpc || "http://127.0.0.1:8899",
    };
  }

  // Check environment variables
  const programId = process.env.SOLANA_PROGRAM_ID;
  const desk = process.env.SOLANA_DESK;
  const deskOwner = process.env.SOLANA_DESK_OWNER;
  const usdcMint = process.env.SOLANA_USDC_MINT;
  const rpc = process.env.SOLANA_RPC_URL || "http://127.0.0.1:8899";

  return {
    programId: expectSolanaAddress(programId, "SOLANA_PROGRAM_ID"),
    desk: expectSolanaAddress(desk, "SOLANA_DESK"),
    deskOwner: expectSolanaAddress(deskOwner, "SOLANA_DESK_OWNER"),
    usdcMint: expectSolanaAddress(usdcMint, "SOLANA_USDC_MINT"),
    rpc,
  };
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Sleep for a given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Log with a prefix.
 */
export function log(prefix: string, message: string): void {
  console.log(`[${prefix}] ${message}`);
}

/**
 * Log test setup progress.
 */
export function logSetup(message: string): void {
  log("E2E Setup", message);
}

/**
 * Log test teardown progress.
 */
export function logTeardown(message: string): void {
  log("E2E Teardown", message);
}

//==============================================================================
// TEST INFRASTRUCTURE STATE TYPES
//==============================================================================

/**
 * Infrastructure state for test setup/teardown
 * Shared between global-setup.ts and global-teardown.ts
 */
export interface InfrastructureState {
  anvilPid?: number;
  solanaPid?: number;
  nextPid?: number;
  startedAt: number;
  shouldStopAnvil: boolean;
  shouldStopSolana: boolean;
  shouldStopNext: boolean;
}
