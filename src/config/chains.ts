import {
  base,
  baseSepolia,
  bsc,
  bscTestnet,
  foundry,
  mainnet,
  sepolia,
  type Chain as ViemChain,
} from "viem/chains";
import { getEvmConfig, getNetwork, getSolanaConfig } from "./contracts";
import { getSolanaRpcProxyUrl, LOCAL_DEFAULTS } from "./env";

// String-based chain identifier for database/API (lowercase, URL-safe)
export type Chain = "ethereum" | "base" | "bsc" | "solana";
export type ChainFamily = "evm" | "solana";

export interface ChainConfig {
  id: string; // String ID for database storage
  name: string;
  rpcUrl: string;
  explorerUrl: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  contracts: {
    otc?: string;
    usdc?: string;
    registrationHelper?: string;
  };
  type: ChainFamily;
  viemChain?: ViemChain; // Reference to viem chain for wagmi (EVM only)
  chainId?: number; // Numeric chain ID (EVM only)
}

// Use centralized network resolution from contracts.ts
const env = getNetwork();
// Get validated configs (these throw if required fields are missing)
const solanaConfig = getSolanaConfig(env);
const evmConfig = getEvmConfig(env);

export const SUPPORTED_CHAINS: Record<Chain, ChainConfig> = {
  ethereum: (() => {
    const isMainnet = env === "mainnet";
    const isLocal = env === "local";

    // Local dev uses foundry/Anvil (chainId 31337), testnet uses Sepolia, mainnet uses Ethereum mainnet
    const chain = isLocal ? foundry : isMainnet ? mainnet : sepolia;

    // Get addresses from deployment config (validated)
    // FAIL-FAST: If networks exists, ethereum should exist (or we should know why it doesn't)
    const networkConfig = evmConfig.networks?.ethereum ?? null;

    // FAIL-FAST: Validate required contracts
    if (!evmConfig.contracts) {
      throw new Error("EVM config missing contracts");
    }
    if (!evmConfig.contracts.otc) {
      throw new Error("EVM config missing contracts.otc");
    }
    if (!evmConfig.contracts.usdc && !isMainnet) {
      throw new Error("EVM config missing contracts.usdc");
    }
    // registrationHelper is only required for mainnet/testnet (token registration feature)
    // Skip this check for local development
    if (isMainnet && !evmConfig.contracts.registrationHelper) {
      throw new Error("EVM config missing contracts.registrationHelper for mainnet");
    }

    // RPC URL: local uses Anvil, mainnet/testnet use proxy to keep API key server-side
    const rpcUrl = isLocal ? LOCAL_DEFAULTS.evmRpc : "/api/rpc/ethereum";

    return {
      id: chain.id.toString(),
      name: isLocal ? "Anvil Local" : isMainnet ? "Ethereum" : "Sepolia",
      rpcUrl,
      explorerUrl: isLocal
        ? "http://localhost:8545"
        : isMainnet
          ? "https://etherscan.io"
          : "https://sepolia.etherscan.io",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      contracts: {
        // networkConfig overrides evmConfig.contracts if present
        otc: networkConfig?.otc ?? evmConfig.contracts.otc,
        usdc:
          networkConfig?.usdc ??
          (isMainnet
            ? "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" // USDC on Ethereum mainnet
            : isLocal
              ? evmConfig.contracts.usdc
              : "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"), // USDC on Sepolia
        registrationHelper:
          networkConfig?.registrationHelper ?? evmConfig.contracts.registrationHelper,
      },
      type: "evm" as ChainFamily,
      viemChain: chain,
      chainId: chain.id,
    };
  })(),
  base: (() => {
    const isMainnet = env === "mainnet";
    const isLocal = env === "local";
    const chain = isLocal ? foundry : isMainnet ? base : baseSepolia;

    // Get addresses from deployment config (validated)
    // networks is optional - if it exists, validate the specific network config
    const networkConfig = evmConfig.networks?.base ?? null;
    // If networks exists but base doesn't, that's a config bug (networks should be complete)
    if (evmConfig.networks && !evmConfig.networks.base) {
      throw new Error("EVM config has networks but missing base network config");
    }

    // Use proxy route to keep Alchemy key server-side
    const rpcUrl = isLocal ? LOCAL_DEFAULTS.evmRpc : "/api/rpc/base";

    return {
      id: chain.id.toString(),
      name: isLocal ? "Anvil Local" : isMainnet ? "Base" : "Base Sepolia",
      rpcUrl,
      explorerUrl: isLocal
        ? "http://localhost:8545"
        : isMainnet
          ? "https://basescan.org"
          : "https://sepolia.basescan.org",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      contracts: {
        // networkConfig overrides evmConfig.contracts if present
        otc: networkConfig?.otc ?? evmConfig.contracts.otc,
        usdc:
          networkConfig?.usdc ??
          (isMainnet
            ? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
            : "0x036CbD53842c5426634e7929541eC2318f3dCF7e"),
        registrationHelper:
          networkConfig?.registrationHelper ?? evmConfig.contracts.registrationHelper,
      },
      type: "evm" as ChainFamily,
      viemChain: chain,
      chainId: isLocal ? 31337 : chain.id,
    };
  })(),
  bsc: (() => {
    const isMainnet = env === "mainnet";
    const isLocal = env === "local";
    const chain = isMainnet ? bsc : bscTestnet;

    // Get addresses from deployment config (validated)
    // networks is optional - if it exists, validate the specific network config
    const networkConfig = evmConfig.networks?.bsc ?? null;
    // If networks exists but bsc doesn't, that's a config bug (networks should be complete)
    if (evmConfig.networks && !evmConfig.networks.bsc) {
      throw new Error("EVM config has networks but missing bsc network config");
    }

    // For local development, BSC is not available (no local BSC fork)
    // Provide a stub config with mainnet RPC - safe for read-only operations
    // but contracts.otc is undefined so writes will fail-fast
    if (isLocal) {
      return {
        id: chain.id.toString(),
        name: "BSC (Not Available Locally)",
        rpcUrl: "https://bsc-dataseed1.binance.org", // Public mainnet RPC (read-only)
        explorerUrl: "https://bscscan.com",
        nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
        contracts: {
          otc: undefined,
          usdc: undefined,
          registrationHelper: undefined,
        },
        type: "evm" as ChainFamily,
        viemChain: chain,
        chainId: chain.id,
      };
    }

    // FAIL-FAST: BSC requires network config with OTC contract for mainnet/testnet
    if (!networkConfig) {
      throw new Error("BSC requires network config with otc contract address");
    }
    if (!networkConfig.otc) {
      throw new Error("BSC network config missing otc contract address");
    }

    return {
      id: chain.id.toString(),
      name: isMainnet ? "BSC" : "BSC Testnet",
      rpcUrl: isMainnet
        ? "https://bsc-dataseed1.binance.org"
        : "https://data-seed-prebsc-1-s1.binance.org:8545",
      explorerUrl: isMainnet ? "https://bscscan.com" : "https://testnet.bscscan.com",
      nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
      contracts: {
        otc: networkConfig.otc,
        // FAIL-FAST: USDC address must be provided in config
        usdc:
          typeof networkConfig.usdc === "string" && networkConfig.usdc.trim() !== ""
            ? networkConfig.usdc
            : (() => {
                // Only use hardcoded fallback for mainnet (known address)
                if (isMainnet) {
                  return "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
                }
                throw new Error("BSC network config missing usdc contract address");
              })(),
        registrationHelper: networkConfig.registrationHelper,
      },
      type: "evm" as ChainFamily,
      viemChain: chain,
      chainId: chain.id,
    };
  })(),
  solana: (() => {
    const isMainnet = env === "mainnet";
    const isLocal = env === "local";

    // Client-side: always proxy through backend for mainnet
    // Local uses direct localhost URL
    const rpcUrl = isLocal
      ? LOCAL_DEFAULTS.solanaRpc
      : isMainnet
        ? getSolanaRpcProxyUrl() // Proxy to /api/rpc/solana -> Helius
        : "https://api.devnet.solana.com";

    return {
      id: isMainnet ? "solana-mainnet" : isLocal ? "solana-localnet" : "solana-devnet",
      name: isMainnet ? "Solana" : isLocal ? "Solana Localnet" : "Solana Devnet",
      rpcUrl,
      explorerUrl: "https://explorer.solana.com",
      nativeCurrency: { name: "SOL", symbol: "SOL", decimals: 9 },
      contracts: {
        otc: solanaConfig.desk,
        usdc: solanaConfig.usdcMint,
      },
      type: "solana" as ChainFamily,
    };
  })(),
};

/**
 * Get chain config by identifier
 * FAIL-FAST: Throws if chain is not supported (should never happen with proper typing)
 */
export function getChainConfig(chain: Chain): ChainConfig {
  const config = SUPPORTED_CHAINS[chain];
  if (!config) {
    throw new Error(`Unsupported chain: ${chain}`);
  }
  return config;
}

/**
 * Check if chain is EVM-based
 */
export function isEVMChain(chain: Chain): boolean {
  return SUPPORTED_CHAINS[chain].type === "evm";
}

/**
 * Check if chain is Solana-based
 */
export function isSolanaChain(chain: Chain): boolean {
  return SUPPORTED_CHAINS[chain].type === "solana";
}

/**
 * Get chain identifier from string chain ID (database format)
 */
export function getChainFromId(chainId: string): Chain | null {
  for (const [key, config] of Object.entries(SUPPORTED_CHAINS)) {
    if (config.id === chainId) return key as Chain;
  }
  return null;
}

/**
 * Get chain identifier from numeric chain ID (wagmi/viem format)
 */
export function getChainFromNumericId(chainId: number): Chain | null {
  for (const [key, config] of Object.entries(SUPPORTED_CHAINS)) {
    if (config.chainId === chainId) return key as Chain;
  }
  return null;
}

/**
 * Get all viem chains for wagmi configuration
 */
export function getAllViemChains(): ViemChain[] {
  return Object.values(SUPPORTED_CHAINS)
    .filter((config) => config.viemChain)
    .map((config) => config.viemChain!);
}
