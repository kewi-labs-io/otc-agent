import localEvm from "./deployments/local-evm.json";
import localSolana from "./deployments/local-solana.json";
import testnetEvm from "./deployments/testnet-evm.json";
import testnetSolana from "./deployments/testnet-solana.json";
import mainnetEvm from "./deployments/mainnet-evm.json";
import mainnetSolana from "./deployments/mainnet-solana.json";
import { getNetwork, type NetworkEnvironment } from "./env";

// =============================================================================
// TYPES
// =============================================================================

export interface EvmChainConfig {
  chainId: number;
  otc: string;
  registrationHelper?: string;
  usdc: string;
  ethUsdFeed?: string;
  bnbUsdFeed?: string;
}

export interface EvmDeployment {
  network: string;
  chainId?: number;
  rpc?: string;
  timestamp?: string;
  deployer?: string;
  contracts: {
    otc?: string;
    usdc?: string;
    // Legacy names from deployment files
    deal?: string;
    usdcToken?: string;
    elizaToken?: string;
    registrationHelper?: string;
    elizaUsdFeed?: string;
    ethUsdFeed?: string;
  };
  accounts?: {
    owner?: string;
    agent?: string;
    approver?: string;
    testWallet?: string;
  };
  testWalletPrivateKey?: string;
  // Multi-chain support
  networks?: {
    base?: EvmChainConfig;
    bsc?: EvmChainConfig;
    ethereum?: EvmChainConfig;
  };
  features?: {
    p2pAutoApproval?: boolean;
    version?: string;
  };
}

export interface SolanaDeployment {
  network: string;
  rpc: string;
  deployer?: string;
  programId: string;
  desk: string;
  deskOwner?: string;
  usdcMint: string;
  elizaosMint?: string;
  features?: {
    p2pAutoApproval?: boolean;
    version?: string;
  };
  registeredTokens?: Record<
    string,
    {
      mint: string;
      registry: string;
      treasury: string;
      priceUsd?: number;
    }
  >;
}

// =============================================================================
// DEPLOYMENT CONFIGS
// =============================================================================

export const CONTRACT_DEPLOYMENTS = {
  local: {
    evm: localEvm as EvmDeployment,
    solana: localSolana as SolanaDeployment,
  },
  testnet: {
    evm: testnetEvm as EvmDeployment,
    solana: testnetSolana as SolanaDeployment,
  },
  mainnet: {
    evm: mainnetEvm as EvmDeployment,
    solana: mainnetSolana as SolanaDeployment,
  },
};

export type NetworkType = NetworkEnvironment;

// Re-export for backwards compatibility
export { getNetwork, getNetwork as getCurrentNetwork };

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get deployment configs for a network
 */
export function getContracts(network?: NetworkType) {
  const net = network || getNetwork();
  return CONTRACT_DEPLOYMENTS[net];
}

/**
 * Get EVM contract addresses from deployment config
 * All values come from deployment JSON - no env var overrides
 * FAIL-FAST: Validates required fields exist
 */
export function getEvmConfig(network?: NetworkType): EvmDeployment {
  const net = network || getNetwork();
  const config = CONTRACT_DEPLOYMENTS[net].evm;

  // Handle legacy contract names (deal -> otc, usdcToken -> usdc)
  // FAIL-FAST: At least one of the field names must exist
  const otcAddress =
    config.contracts.otc !== undefined
      ? config.contracts.otc
      : config.contracts.deal;
  const usdcAddress =
    config.contracts.usdc !== undefined
      ? config.contracts.usdc
      : config.contracts.usdcToken;

  // FAIL-FAST: Required contract addresses must exist
  if (!otcAddress) {
    throw new Error(
      `EVM OTC contract address not configured for network: ${net}. Expected contracts.otc or contracts.deal`,
    );
  }
  if (!usdcAddress) {
    throw new Error(
      `EVM USDC contract address not configured for network: ${net}. Expected contracts.usdc or contracts.usdcToken`,
    );
  }

  return {
    ...config,
    contracts: {
      ...config.contracts,
      otc: otcAddress,
      usdc: usdcAddress,
    },
  };
}

/**
 * Get Solana config from deployment config
 * All values come from deployment JSON - no env var overrides
 * FAIL-FAST: Validates required fields exist
 */
export function getSolanaConfig(network?: NetworkType): SolanaDeployment {
  const net = network || getNetwork();
  const config = CONTRACT_DEPLOYMENTS[net].solana;

  // Validate required fields
  if (!config.desk) {
    throw new Error(`Solana desk not configured for network: ${net}`);
  }
  if (!config.programId) {
    throw new Error(`Solana programId not configured for network: ${net}`);
  }
  if (!config.usdcMint) {
    throw new Error(`Solana usdcMint not configured for network: ${net}`);
  }

  return config;
}

/**
 * Get OTC contract address for current network
 */
export function getOtcAddress(network?: NetworkType): string {
  const config = getEvmConfig(network);
  const address = config.contracts.otc;
  if (!address) {
    throw new Error(
      `OTC contract address not configured for network: ${network || getNetwork()}`,
    );
  }
  return address;
}

/**
 * Get Solana desk address for current network
 */
export function getSolanaDesk(network?: NetworkType): string {
  const config = getSolanaConfig(network);
  return config.desk;
}

/**
 * Get Solana program ID for current network
 */
export function getSolanaProgramId(network?: NetworkType): string {
  const config = getSolanaConfig(network);
  return config.programId;
}

/**
 * Get OTC address for a specific EVM chain
 */
export function getOtcAddressForChain(
  chainId: number,
  network?: NetworkType,
): string | undefined {
  const config = getEvmConfig(network);

  // Check multi-chain networks first
  if (config.networks) {
    if (chainId === 8453 && config.networks.base)
      return config.networks.base.otc;
    if (chainId === 56 && config.networks.bsc) return config.networks.bsc.otc;
    if (chainId === 1 && config.networks.ethereum)
      return config.networks.ethereum.otc;
  }

  // Fallback to primary contract
  return config.contracts.otc;
}

/**
 * Get registration helper address for a chain
 */
export function getRegistrationHelperForChain(
  chainId: number,
  network?: NetworkType,
): string | undefined {
  const config = getEvmConfig(network);

  if (config.networks) {
    if (chainId === 8453 && config.networks.base)
      return config.networks.base.registrationHelper;
    if (chainId === 56 && config.networks.bsc)
      return config.networks.bsc.registrationHelper;
    if (chainId === 1 && config.networks.ethereum)
      return config.networks.ethereum.registrationHelper;
  }

  return config.contracts.registrationHelper;
}

/**
 * Get USDC address for a chain
 */
export function getUsdcAddressForChain(
  chainId: number,
  network?: NetworkType,
): string | undefined {
  const config = getEvmConfig(network);

  if (config.networks) {
    if (chainId === 8453 && config.networks.base)
      return config.networks.base.usdc;
    if (chainId === 56 && config.networks.bsc) return config.networks.bsc.usdc;
    if (chainId === 1 && config.networks.ethereum)
      return config.networks.ethereum.usdc;
  }

  return config.contracts.usdc;
}

/**
 * All mainnet OTC contract addresses (hardcoded for reference)
 * In practice, use getOtcAddressForChain() which reads from deployment JSON
 * NOTE: Solana program was closed on mainnet and needs redeployment
 */
export const MAINNET_OTC_ADDRESSES = {
  base: "0x5a1C9911E104F18267505918894fd7d343739657",
  bsc: "0x5a1C9911E104F18267505918894fd7d343739657",
  ethereum: "0x5a1C9911E104F18267505918894fd7d343739657",
  solana: {
    programId: "3uTdWzoAcBFKTVYRd2z2jDKAcuyW64rQLxa9wMreDJKo",
    desk: "EDzQZXDT3iZcXxkp56vb7LLJ1tgaTn1gbf1CgWQuKXtY",
  },
} as const;
