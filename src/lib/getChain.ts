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
 *
 * Priority: NEXT_PUBLIC_NETWORK > NETWORK > NODE_ENV inference
 */
export function getChain(): Chain {
  const network =
    process.env.NEXT_PUBLIC_NETWORK || process.env.NETWORK || "testnet";

  // Handle unified network names
  if (network === "mainnet") return base;
  if (network === "testnet") return baseSepolia;
  if (network === "local" || network === "localnet") return localhost;

  // Handle chain-specific network names
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
      // Default to Base Sepolia (testnet)
      return baseSepolia;
  }
}

/**
 * Get RPC URL for the current chain
 */
export function getRpcUrl(): string {
  const network =
    process.env.NEXT_PUBLIC_NETWORK || process.env.NETWORK || "testnet";

  // Handle unified network names
  if (network === "mainnet") {
    return process.env.NEXT_PUBLIC_BASE_RPC_URL || "https://mainnet.base.org";
  }
  if (network === "testnet") {
    return process.env.NEXT_PUBLIC_BASE_RPC_URL || "https://sepolia.base.org";
  }
  if (network === "local" || network === "localnet") {
    return process.env.NEXT_PUBLIC_RPC_URL || "http://127.0.0.1:8545";
  }

  // Handle chain-specific network names
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

/**
 * Check if current network is local (Anvil/localhost)
 */
export function isLocalNetwork(): boolean {
  const network =
    process.env.NEXT_PUBLIC_NETWORK || process.env.NETWORK || "testnet";
  return (
    network === "local" ||
    network === "localnet" ||
    network === "localhost" ||
    network === "anvil"
  );
}
