/**
 * Environment Variables Configuration
 *
 * This file is the SINGLE SOURCE OF TRUTH for all environment variables.
 * It categorizes them into:
 * - SECRETS: Private keys, API keys that must never be exposed
 * - DATABASE: Database connection strings (vary by environment)
 * - CONFIG: Non-secret configuration that could be in code but we keep in env for flexibility
 *
 * All contract addresses, RPC URLs, and other deployment-specific values
 * should come from src/config/deployments/*.json files, NOT environment variables.
 */

// =============================================================================
// TYPES
// =============================================================================

export type NetworkEnvironment = "local" | "testnet" | "mainnet";

// =============================================================================
// SECRETS (Required in production, have dev defaults)
// =============================================================================

/**
 * Get Alchemy API key for RPC proxy
 * Required for Base/Ethereum RPC access in production
 */
export function getAlchemyApiKey(): string | undefined {
  return process.env.ALCHEMY_API_KEY;
}

/**
 * Get EVM private key for approver/signer operations
 * Required for backend transaction signing
 */
export function getEvmPrivateKey(): string | undefined {
  const raw = process.env.EVM_PRIVATE_KEY;
  if (!raw) return undefined;
  // Normalize: ensure 0x prefix
  return raw.startsWith("0x") ? raw : `0x${raw}`;
}

/**
 * Get Solana desk private key for signing withdrawal/claim transactions
 * Can be base58 encoded or JSON array format
 */
export function getSolanaPrivateKey(): string | undefined {
  return process.env.SOLANA_DESK_PRIVATE_KEY || process.env.SOLANA_PRIVATE_KEY;
}

/**
 * Get Groq API key for AI/LLM
 * Required for agent functionality
 */
export function getGroqApiKey(): string | undefined {
  return process.env.GROQ_API_KEY;
}

/**
 * Get CoinGecko API key for market data
 * Optional - free tier works without key (rate limited)
 */
export function getCoingeckoApiKey(): string | undefined {
  return process.env.COINGECKO_API_KEY;
}

/**
 * Get Birdeye API key for Solana market data
 * Required for Solana token pricing on devnet/mainnet
 */
export function getBirdeyeApiKey(): string | undefined {
  return process.env.BIRDEYE_API_KEY;
}

/**
 * Get cron job authentication secret
 * Required in production for /api/cron/* routes
 */
export function getCronSecret(): string | undefined {
  return process.env.CRON_SECRET;
}

/**
 * Get worker authentication token for quote signatures
 * Required for quote generation
 */
export function getWorkerAuthToken(): string {
  const token = process.env.WORKER_AUTH_TOKEN;
  if (!token) {
    throw new Error(
      "WORKER_AUTH_TOKEN must be set for quote signature generation",
    );
  }
  return token;
}

/**
 * Get Helius API key for Solana RPC (optional enhanced access)
 */
export function getHeliusApiKey(): string | undefined {
  return process.env.HELIUS_API_KEY;
}

/**
 * Get Helius RPC URL for server-side use only
 * REQUIRES HELIUS_API_KEY - no fallback
 */
export function getHeliusRpcUrl(): string {
  const heliusKey = process.env.HELIUS_API_KEY;
  if (!heliusKey) {
    throw new Error("[Solana RPC] CRITICAL: HELIUS_API_KEY not configured!");
  }
  return `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`;
}

/**
 * Get Solana RPC URL for client-side use (proxy through backend)
 * Returns relative URL on client-side, full URL on server-side
 */
export function getSolanaRpcProxyUrl(): string {
  // On client-side, use relative URL so it works on any port
  if (typeof window !== "undefined") {
    return `${window.location.origin}/api/rpc/solana`;
  }
  // On server-side, use configured URL
  const baseUrl = getAppUrl();
  return `${baseUrl}/api/rpc/solana`;
}

/**
 * Get Solana mainnet RPC URL
 * - Server-side: Uses Helius directly
 * - Client-side: Uses proxy endpoint (requires full URL)
 */
export function getSolanaMainnetRpcUrl(): string {
  // Server-side: use Helius directly
  if (typeof window === "undefined") {
    return getHeliusRpcUrl();
  }

  // Client-side: use proxy endpoint with full URL
  return getSolanaRpcProxyUrl();
}

/**
 * Get Vercel Blob storage token
 */
export function getBlobToken(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN;
}

// =============================================================================
// DATABASE
// =============================================================================

/**
 * Get PostgreSQL connection URL
 * Checks multiple env var names for compatibility with different hosting providers
 */
export function getDatabaseUrl(): string {
  const url =
    process.env.DATABASE_POSTGRES_URL || // Vercel Neon Storage (pooled)
    process.env.DATABASE_URL_UNPOOLED || // Vercel Neon Storage (unpooled)
    process.env.POSTGRES_URL || // Standard
    process.env.POSTGRES_DATABASE_URL; // Alternative

  if (url) return url;

  // Local development default
  const port = process.env.POSTGRES_DEV_PORT || "5439";
  return `postgres://eliza:password@localhost:${port}/eliza`;
}

/**
 * Check if using production database
 */
export function isProductionDatabase(): boolean {
  const url = getDatabaseUrl();
  return !url.includes("localhost") && !url.includes("127.0.0.1");
}

// =============================================================================
// CONFIGURATION (Non-secret, public values)
// =============================================================================

/**
 * Get current network environment
 * This is the SINGLE SOURCE OF TRUTH for network resolution
 */
export function getNetwork(): NetworkEnvironment {
  const explicit = process.env.NEXT_PUBLIC_NETWORK || process.env.NETWORK;

  if (explicit === "mainnet") return "mainnet";
  if (explicit === "testnet" || explicit === "sepolia") return "testnet";
  if (explicit === "local" || explicit === "localnet" || explicit === "anvil")
    return "local";

  // Legacy flag support
  if (process.env.NEXT_PUBLIC_USE_MAINNET === "true") return "mainnet";

  // Default to mainnet for production
  return "mainnet";
}

/**
 * Check if running in production mode
 */
export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Check if running in development mode
 */
export function isDevelopment(): boolean {
  return process.env.NODE_ENV === "development";
}

/**
 * Get app URL for redirects and metadata
 */
export function getAppUrl(): string {
  return (
    process.env.NEXT_PUBLIC_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:4444"
  );
}

/**
 * Get server port
 */
export function getPort(): number {
  return parseInt(process.env.PORT || "4444", 10);
}

/**
 * Get Privy App ID for authentication
 * Public client ID, not a secret
 */
export function getPrivyAppId(): string | undefined {
  return process.env.NEXT_PUBLIC_PRIVY_APP_ID;
}

/**
 * Get Groq model names (with defaults)
 */
export function getGroqModels() {
  return {
    small: process.env.SMALL_GROQ_MODEL || "qwen/qwen3-32b",
    medium: process.env.MEDIUM_GROQ_MODEL,
    large: process.env.LARGE_GROQ_MODEL || "moonshotai/kimi-k2-instruct-0905",
  };
}

/**
 * Get tunnel domain for CORS (development only)
 */
export function getTunnelDomain(): string | undefined {
  return process.env.TUNNEL_DOMAIN;
}

/**
 * Get additional allowed dev origins (comma-separated)
 */
export function getAllowedDevOrigins(): string[] {
  const origins = process.env.ALLOWED_DEV_ORIGINS;
  if (!origins) return [];
  return origins
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

// =============================================================================
// LOCAL DEVELOPMENT DEFAULTS
// =============================================================================

export const LOCAL_DEFAULTS = {
  evmRpc: "http://127.0.0.1:8545",
  solanaRpc: "http://127.0.0.1:8899",
  solanaWs: "ws://127.0.0.1:8900",
  port: 4444,
} as const;

// =============================================================================
// VALIDATION
// =============================================================================

/**
 * Validate that required secrets are configured for production
 * Call this on server startup
 */
export function validateProductionSecrets(): {
  valid: boolean;
  missing: string[];
} {
  if (!isProduction()) {
    return { valid: true, missing: [] };
  }

  const missing: string[] = [];

  // Required in production - EVM
  if (!getAlchemyApiKey()) missing.push("ALCHEMY_API_KEY");
  if (!getEvmPrivateKey()) missing.push("EVM_PRIVATE_KEY");

  // Required in production - Solana
  if (!getHeliusApiKey()) missing.push("HELIUS_API_KEY");
  if (!getBirdeyeApiKey()) missing.push("BIRDEYE_API_KEY");

  // Required in production - Services
  if (!getGroqApiKey()) missing.push("GROQ_API_KEY");
  if (!getCronSecret()) missing.push("CRON_SECRET");
  if (!process.env.WORKER_AUTH_TOKEN) missing.push("WORKER_AUTH_TOKEN");
  if (getDatabaseUrl().includes("localhost"))
    missing.push("DATABASE_POSTGRES_URL");

  return { valid: missing.length === 0, missing };
}

/**
 * Log environment configuration (safe for logs, no secrets)
 */
export function logEnvironmentConfig(): void {
  console.log("[Environment]", {
    network: getNetwork(),
    isProduction: isProduction(),
    appUrl: getAppUrl(),
    port: getPort(),
    hasAlchemyKey: !!getAlchemyApiKey(),
    hasEvmKey: !!getEvmPrivateKey(),
    hasSolanaKey: !!getSolanaPrivateKey(),
    hasGroqKey: !!getGroqApiKey(),
    hasCoinGeckoKey: !!getCoingeckoApiKey(),
    hasBirdeyeKey: !!getBirdeyeApiKey(),
    hasCronSecret: !!getCronSecret(),
    hasWorkerToken: !!process.env.WORKER_AUTH_TOKEN,
    hasPrivyAppId: !!getPrivyAppId(),
    databaseConfigured: isProductionDatabase(),
  });
}
