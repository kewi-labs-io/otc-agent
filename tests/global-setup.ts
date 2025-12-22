/**
 * Global Setup for E2E Tests
 *
 * Starts all required infrastructure before tests run:
 * - PostgreSQL database (via Docker)
 * - Anvil (local EVM node)
 * - Deploys contracts to Anvil
 * - Solana validator (optional)
 * - Next.js dev server
 */

import { type ChildProcess, execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ANVIL_PORT,
  APP_PORT,
  getEvmNonce,
  isPortInUse,
  killProcessesOnPort,
  logSetup,
  POSTGRES_PORT,
  SOLANA_PORT,
  sleep,
  waitForPort,
  waitForPortToClose,
  waitForUrl,
} from "./test-utils";

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

function saveState(state: InfrastructureState): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function cleanupStateFile(): void {
  if (existsSync(STATE_FILE)) {
    unlinkSync(STATE_FILE);
  }
}

// =============================================================================
// INFRASTRUCTURE START FUNCTIONS
// =============================================================================

async function ensurePostgres(): Promise<void> {
  logSetup("Ensuring PostgreSQL is running...");

  const scriptPath = join(PROJECT_ROOT, "scripts/ensure-postgres.sh");
  if (!existsSync(scriptPath)) {
    throw new Error(`PostgreSQL script not found: ${scriptPath}`);
  }

  execSync(scriptPath, {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
  });

  logSetup("PostgreSQL ready on port " + POSTGRES_PORT);
}

async function startAnvil(): Promise<{ process: ChildProcess; shouldStop: boolean }> {
  const rpcUrl = `http://127.0.0.1:${ANVIL_PORT}`;
  const deployer = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

  // Check if Anvil is already running with fresh state
  if (isPortInUse(ANVIL_PORT)) {
    const nonce = await getEvmNonce(rpcUrl, deployer).catch(() => {
      logSetup("Anvil port in use but not responding - restarting");
      throw new Error("Anvil port in use but RPC not responding");
    });
    if (nonce === 0n) {
      logSetup("Anvil already running with fresh state - reusing");
      return { process: null as never, shouldStop: false };
    }
    logSetup(`Anvil running but stale (nonce=${nonce}) - restarting`);
  } else {
    logSetup("Starting Anvil...");
  }

  killProcessesOnPort(ANVIL_PORT);
  execSync("pkill -9 -f anvil 2>/dev/null || true", { stdio: "ignore" });

  await waitForPortToClose(ANVIL_PORT, 15000);

  const anvil = spawn(
    "anvil",
    [
      "--host",
      "127.0.0.1",
      "--port",
      String(ANVIL_PORT),
      "--chain-id",
      "31337",
      "--accounts",
      "20",
      "--balance",
      "10000",
      "--gas-limit",
      "30000000",
      "--gas-price",
      "0",
    ],
    {
      cwd: PROJECT_ROOT,
      stdio: "ignore",
      detached: true,
    },
  );

  anvil.unref();

  await waitForPort(ANVIL_PORT, 15000);

  // Verify fresh chain state
  const nonce = await getEvmNonce(rpcUrl, deployer);
  if (nonce !== 0n) {
    throw new Error(`Anvil started but deployer nonce is ${nonce}, expected 0`);
  }

  logSetup("Anvil started successfully on port " + ANVIL_PORT);
  return { process: anvil, shouldStop: true };
}

async function deployContracts(): Promise<void> {
  logSetup("Deploying contracts to Anvil...");

  const contractsDir = join(PROJECT_ROOT, "contracts");
  if (!existsSync(contractsDir)) {
    throw new Error(`Contracts directory not found: ${contractsDir}`);
  }

  execSync(
    "forge script scripts/DeployElizaOTC.s.sol --broadcast --rpc-url http://127.0.0.1:8545",
    {
      cwd: contractsDir,
      stdio: "inherit",
    },
  );

  logSetup("Contracts deployed successfully");

  // Sync deployment addresses to local-evm.json
  const deploymentFile = join(PROJECT_ROOT, "contracts/deployments/eliza-otc-deployment.json");
  const localEvmFile = join(PROJECT_ROOT, "src/config/deployments/local-evm.json");

  if (!existsSync(deploymentFile)) {
    throw new Error(`Deployment file not created: ${deploymentFile}`);
  }

  interface DeploymentData {
    contracts: Record<string, string>;
    accounts?: Record<string, string>;
  }

  const deployment = JSON.parse(readFileSync(deploymentFile, "utf8")) as DeploymentData;

  // Validate required deployment fields
  const ownerAccount = deployment.accounts?.owner ?? "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

  const otcAddress = deployment.contracts.otc ?? deployment.contracts.deal;
  if (!otcAddress) {
    throw new Error("Deployment missing OTC contract (expected contracts.otc or contracts.deal)");
  }

  const usdcAddress =
    deployment.contracts.usdc ?? deployment.contracts.usdcToken ?? deployment.contracts.usdcMock;
  if (!usdcAddress) {
    throw new Error(
      "Deployment missing USDC contract (expected contracts.usdc, contracts.usdcToken, or contracts.usdcMock)",
    );
  }

  if (!deployment.contracts.elizaToken) {
    throw new Error("Deployment missing elizaToken contract");
  }

  const localConfig = {
    network: "local-anvil",
    chainId: 31337,
    rpc: "http://127.0.0.1:8545",
    timestamp: new Date().toISOString(),
    deployer: ownerAccount,
    contracts: {
      otc: otcAddress,
      usdc: usdcAddress,
      elizaToken: deployment.contracts.elizaToken,
      registrationHelper: deployment.contracts.registrationHelper,
      elizaUsdFeed: deployment.contracts.elizaUsdFeed,
      ethUsdFeed: deployment.contracts.ethUsdFeed,
    },
    accounts: deployment.accounts,
  };

  mkdirSync(join(PROJECT_ROOT, "src/config/deployments"), { recursive: true });
  writeFileSync(localEvmFile, JSON.stringify(localConfig, null, 2));
  logSetup("Updated local-evm.json with deployment addresses");

  if (deployment.accounts) {
    if (!deployment.accounts.testWallet) {
      throw new Error(
        "Deployment has accounts config but missing testWallet - test infrastructure incomplete",
      );
    }
    const ownerKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    execSync(
      `cast send ${deployment.accounts.testWallet} --value 100ether --private-key ${ownerKey} --rpc-url http://127.0.0.1:8545`,
      { stdio: "ignore" },
    );
    logSetup("Funded test wallet with 100 ETH");
  }
  // If no accounts config, that's fine - tests may not need it
}

async function startSolana(): Promise<{ pid?: number; shouldStop: boolean }> {
  // Default to restart for E2E tests - ensures clean state with properly initialized desk
  // Set E2E_RESTART_SOLANA=false to reuse existing validator (not recommended for tests)
  const shouldRestart = process.env.E2E_RESTART_SOLANA !== "false";
  const alreadyRunning = isPortInUse(SOLANA_PORT);

  if (alreadyRunning && !shouldRestart) {
    logSetup("Solana validator already running - reusing (E2E_RESTART_SOLANA=false)");
    const pidStr = execSync("lsof -nP -iTCP:8899 -sTCP:LISTEN -t | head -n1").toString().trim();
    const pid = pidStr ? Number(pidStr) : undefined;
    return { pid, shouldStop: false };
  }

  logSetup(alreadyRunning ? "Restarting Solana validator..." : "Starting Solana validator...");

  execSync("pkill -9 -f solana-test-validator 2>/dev/null || true", { stdio: "ignore" });

  const scriptPath = join(PROJECT_ROOT, "scripts/start-solana.sh");
  if (!existsSync(scriptPath)) {
    throw new Error(`Solana script not found: ${scriptPath}`);
  }

  execSync(scriptPath, {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
    env: { ...process.env, NO_TAIL: "true" },
  });

  await waitForPort(SOLANA_PORT, 30000);

  const pidStr = execSync("lsof -nP -iTCP:8899 -sTCP:LISTEN -t | head -n1").toString().trim();
  const pid: number | undefined = pidStr ? Number(pidStr) : undefined;

  logSetup("Solana validator ready on port " + SOLANA_PORT);
  return { pid, shouldStop: true };
}

async function startNextJs(): Promise<{ process: ChildProcess | null; shouldStop: boolean }> {
  const shouldStart = process.env.E2E_START_NEXT !== "false";

  // Check if already running AND healthy (returns 2xx on health endpoint)
  let serverState: "healthy" | "unhealthy" | "not_running" = "not_running";
  try {
    const response = await fetch(`http://localhost:${APP_PORT}/api/tokens`, {
      method: "HEAD",
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok || response.status === 404) {
      serverState = "healthy";
    } else {
      serverState = "unhealthy";
      logSetup(`Next.js running but unhealthy (HTTP ${response.status}) - will restart`);
    }
  } catch {
    serverState = "not_running";
  }

  if (serverState === "healthy") {
    logSetup(`Next.js already running and healthy on port ${APP_PORT} - reusing`);
    return { process: null, shouldStop: false };
  }

  if (!shouldStart) {
    throw new Error(`E2E_START_NEXT=false but Next.js is not running/healthy on port ${APP_PORT}`);
  }

  logSetup("Starting Next.js dev server...");

  // Kill any existing server (including unhealthy ones)
  killProcessesOnPort(APP_PORT);
  execSync("pkill -f 'next dev' 2>/dev/null || true", { stdio: "ignore" });
  execSync("pkill -f 'next-server' 2>/dev/null || true", { stdio: "ignore" });

  await sleep(2000);

  // Clean .next directory to avoid stale cache issues (routes-manifest.json corruption)
  execSync(`rm -rf ${join(PROJECT_ROOT, ".next")}`, { stdio: "ignore" });

  // Environment for local testing
  const env = { ...process.env };
  env.NEXT_PUBLIC_NETWORK = "local";
  env.NETWORK = "local";
  env.NEXT_PUBLIC_RPC_URL = "http://127.0.0.1:8545";
  env.CHAIN_ID = "31337";
  env.NODE_ENV = "development";
  env.POSTGRES_DEV_PORT = String(POSTGRES_PORT);
  delete env.DATABASE_POSTGRES_URL;
  delete env.DATABASE_URL_UNPOOLED;
  delete env.POSTGRES_URL;
  delete env.POSTGRES_DATABASE_URL;

  const next = spawn("bunx", ["next", "dev", "-p", String(APP_PORT)], {
    cwd: PROJECT_ROOT,
    stdio: "ignore",
    detached: true,
    env,
  });

  next.unref();

  await waitForUrl(`http://localhost:${APP_PORT}/api/tokens`, 300000); // 5 minutes
  logSetup(`Next.js started on port ${APP_PORT}`);

  return { process: next, shouldStop: true };
}

async function seedLocalTokens(): Promise<void> {
  const localEvmFile = join(PROJECT_ROOT, "src/config/deployments/local-evm.json");

  if (!existsSync(localEvmFile)) {
    logSetup("No local EVM deployment found, skipping token seed");
    return;
  }

  interface LocalEvmConfig {
    contracts?: { elizaToken?: string };
  }

  const evmDeployment = JSON.parse(readFileSync(localEvmFile, "utf8")) as LocalEvmConfig;
  if (!evmDeployment.contracts) {
    logSetup("EVM deployment missing contracts field, skipping token seed");
    return;
  }
  const tokenAddress = evmDeployment.contracts.elizaToken;

  if (!tokenAddress) {
    logSetup("No ElizaToken in deployment, skipping token seed");
    return;
  }

  logSetup("Seeding local test token...");

  try {
    // First check if the token already exists
    const checkResponse = await fetch(
      `http://localhost:${APP_PORT}/api/tokens?address=${tokenAddress}&chain=base`,
      { signal: AbortSignal.timeout(10000) },
    );

    if (checkResponse.ok) {
      interface TokensCheckResponse {
        tokens: Array<{ contractAddress: string }>;
      }
      const checkData = (await checkResponse.json()) as TokensCheckResponse;
      // FAIL-FAST: tokens field is required per interface - if missing, API contract is broken
      if (!checkData.tokens) {
        throw new Error("Token check response missing required 'tokens' field");
      }
      const existingToken = checkData.tokens.find(
        (t) => t.contractAddress.toLowerCase() === tokenAddress.toLowerCase(),
      );
      if (existingToken) {
        logSetup("Local test token already exists, skipping seed");
        return;
      }
    }

    // Create the token
    const response = await fetch(`http://localhost:${APP_PORT}/api/tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol: "TEST",
        name: "Local Test Token",
        contractAddress: tokenAddress,
        chain: "base",
        decimals: 18,
        logoUrl: "/tokens/eliza.svg",
        description: "LOCAL DEV ONLY - Test token for E2E",
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (response.ok) {
      logSetup("Local test token registered successfully");
    } else {
      const error = await response.text();
      // Non-fatal: log warning but continue - tests can still run with existing tokens
      logSetup(`Warning: Token seed returned ${response.status}: ${error || "(empty response)"}`);
    }
  } catch (e) {
    // Non-fatal: log warning but continue
    const errMsg = e instanceof Error ? e.message : String(e);
    logSetup(`Warning: Token seed failed: ${errMsg}`);
  }
}

// =============================================================================
// INFRASTRUCTURE STOP FUNCTIONS
// =============================================================================

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
    logSetup("Keeping PostgreSQL running (set TEARDOWN_POSTGRES=true to stop)");
    return;
  }

  execSync("docker stop otc-postgres 2>/dev/null || true", { stdio: "ignore" });
  logSetup("Stopped PostgreSQL container");
}

// =============================================================================
// MAIN SETUP FUNCTION
// =============================================================================

export default async function globalSetup(): Promise<() => Promise<void>> {
  logSetup("Starting E2E test infrastructure...");
  const startTime = Date.now();

  // Clean up any stale state
  cleanupStateFile();

  // Stop stale processes if we'll be starting them
  const shouldStartNext = process.env.E2E_START_NEXT !== "false";
  if (shouldStartNext) stopNextJs();

  // 1. Start PostgreSQL
  await ensurePostgres();

  // 2. Start Anvil (EVM localnet)
  const anvil = await startAnvil();

  // 3. Deploy contracts
  await deployContracts();

  // 4. Start Solana (optional)
  const solana = await startSolana();

  // 5. Start Next.js
  const next = await startNextJs();

  // 6. Seed local tokens
  await seedLocalTokens();

  // Save state for teardown
  const state: InfrastructureState = {
    anvilPid: anvil.process?.pid,
    solanaPid: solana.pid,
    nextPid: next.process?.pid,
    startedAt: startTime,
    shouldStopAnvil: anvil.shouldStop,
    shouldStopSolana: solana.shouldStop,
    shouldStopNext: next.shouldStop,
  };
  saveState(state);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  logSetup(`Infrastructure ready in ${elapsed}s`);
  logSetup(`  PostgreSQL: localhost:${POSTGRES_PORT}`);
  logSetup(`  Anvil: http://127.0.0.1:${ANVIL_PORT}`);
  logSetup(`  Next.js: http://localhost:${APP_PORT}`);

  // Return teardown function
  return async () => {
    logSetup("Stopping E2E test infrastructure...");

    if (state.shouldStopNext) {
      stopNextJs();
      logSetup("Stopped Next.js");
    }

    if (state.shouldStopAnvil) {
      stopAnvil();
      logSetup("Stopped Anvil");
    }

    if (state.shouldStopSolana) {
      stopSolana();
      logSetup("Stopped Solana validator");
    }

    stopPostgres();
    cleanupStateFile();

    const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    logSetup(`Infrastructure ran for ${totalElapsed}s - Teardown complete`);
  };
}
