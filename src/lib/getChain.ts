import {
  base,
  baseSepolia,
  bsc,
  bscTestnet,
  localhost,
  type Chain,
} from "viem/chains";

/**
 * Get the appropriate chain based on environment and configuration
 * Supports: Base, BSC, Anvil/localhost
 */
export function getChain(): Chain {
  const env = process.env.NODE_ENV;
  const network = process.env.NETWORK || "base";

  // Production: Use mainnet chains
  if (env === "production") {
    if (network === "base") return base;
    if (network === "bsc") return bsc;
    return base; // Default to Base in production
  }

  // Development/staging: Support multiple networks
  switch (network) {
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
      // Default to Base Sepolia in development
      return baseSepolia;
  }
}

/**
 * Get RPC URL for the current chain
 */
export function getRpcUrl(): string {
  const network = process.env.NETWORK || "base";

  switch (network) {
    case "base":
      return process.env.NEXT_PUBLIC_BASE_RPC_URL || "https://mainnet.base.org";
    case "base-sepolia":
      return process.env.NEXT_PUBLIC_BASE_RPC_URL || "https://sepolia.base.org";
    case "bsc":
      return (
        process.env.NEXT_PUBLIC_BSC_RPC_URL ||
        "https://bsc-dataseed1.binance.org"
      );
    case "bsc-testnet":
      return (
        process.env.NEXT_PUBLIC_BSC_RPC_URL ||
        "https://data-seed-prebsc-1-s1.binance.org:8545"
      );
    case "localhost":
    case "anvil":
      return process.env.NEXT_PUBLIC_RPC_URL || "http://127.0.0.1:8545";
    default:
      return process.env.NEXT_PUBLIC_BASE_RPC_URL || "https://sepolia.base.org";
  }
}
