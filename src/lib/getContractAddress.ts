import type { Address } from "viem";
import { getContracts } from "@/config/contracts";

// Mainnet OTC addresses from deployment config (fallback)
const MAINNET_OTC_ADDRESS = "0x12FA61c9d77AEd9BeDA0FF4bF2E900F31bdBdc45";
const TESTNET_OTC_ADDRESS = "0x08cAa161780d195E0799b73b318da5D175b85313";

/**
 * Get network environment from env vars
 */
function getNetworkEnvironment(): "local" | "testnet" | "mainnet" {
  const explicitNetwork = process.env.NEXT_PUBLIC_NETWORK;
  if (explicitNetwork === "mainnet") return "mainnet";
  if (explicitNetwork === "testnet") return "testnet";
  if (explicitNetwork === "local" || explicitNetwork === "localnet") return "local";
  if (process.env.NEXT_PUBLIC_USE_MAINNET === "true") return "mainnet";
  return "testnet";
}

/**
 * Get the appropriate OTC contract address based on network configuration
 * Uses deployment config files for addresses
 *
 * @returns The OTC contract address for the current network
 */
export function getContractAddress(): Address {
  const env = getNetworkEnvironment();
  const deployments = getContracts(env);

  // First: try deployment config
  const configAddress = deployments.evm?.contracts?.otc;
  if (configAddress) {
    return configAddress as Address;
  }

  // Second: try environment variables
  const envAddress =
    process.env.NEXT_PUBLIC_BASE_OTC_ADDRESS ||
    process.env.NEXT_PUBLIC_OTC_ADDRESS;
  if (envAddress) {
    return envAddress as Address;
  }

  // Third: use hardcoded fallbacks based on network
  switch (env) {
    case "mainnet":
      return MAINNET_OTC_ADDRESS as Address;
    case "testnet":
      return TESTNET_OTC_ADDRESS as Address;
    case "local":
    default:
      // Local deployment address (deterministic from Anvil)
      return "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9" as Address;
  }
}
