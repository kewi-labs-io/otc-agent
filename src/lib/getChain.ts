import {
  mainnet,
  sepolia,
  base,
  baseSepolia,
  bsc,
  bscTestnet,
  localhost,
  type Chain,
} from "viem/chains";
import { getCurrentNetwork, getEvmConfig } from "@/config/contracts";

// Anvil chain with correct chain ID (31337)
const anvil: Chain = {
  ...localhost,
  id: 31337,
  name: "Anvil",
};

/**
 * Get the appropriate chain based on environment and configuration
 * Supports: Base, BSC, Anvil/localhost
 */
export function getChain(): Chain {
  const network = getCurrentNetwork();

  // Handle unified network names
  if (network === "mainnet") return base;
  if (network === "testnet") return baseSepolia;
  if (network === "local") return anvil;

  // Default to Base mainnet
  return base;
}

/**
 * Get RPC URL for the current chain
 * Uses deployment config with env override support
 */
export function getRpcUrl(): string {
  const config = getEvmConfig();
  return config.rpc;
}

/**
 * Get RPC URL for a specific chain type
 * @param chainType - Chain identifier (ethereum, base, bsc, localhost, etc.)
 */
export function getRpcUrlForChain(chainType: string): string {
  switch (chainType) {
    case "ethereum":
      return "/api/rpc/ethereum";
    case "sepolia":
      return "/api/rpc/ethereum";
    case "base":
      return "/api/rpc/base";
    case "base-sepolia":
      return "/api/rpc/base";
    case "bsc":
      return process.env.NEXT_PUBLIC_BSC_RPC_URL!;
    case "bsc-testnet":
      return process.env.NEXT_PUBLIC_BSC_RPC_URL!;
    case "localhost":
    case "anvil":
      return process.env.NEXT_PUBLIC_RPC_URL || "http://127.0.0.1:8545";
    default:
      return getRpcUrl();
  }
}

/**
 * Get viem chain config for a chain type
 * @param chainType - Chain identifier (ethereum, base, bsc, etc.)
 */
export function getViemChainForType(chainType: string): Chain {
  switch (chainType) {
    case "ethereum":
      return mainnet;
    case "sepolia":
      return sepolia;
    case "base":
      return base;
    case "base-sepolia":
      return baseSepolia;
    case "bsc":
      return bsc;
    case "bsc-testnet":
      return bscTestnet;
    case "localhost":
    case "anvil":
      return localhost;
    default:
      return base;
  }
}
