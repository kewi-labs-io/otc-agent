import { farcasterMiniApp } from "@farcaster/miniapp-wagmi-connector";
import type { Config } from "wagmi";
import { createConfig, http } from "wagmi";
import { base, baseSepolia, bsc, bscTestnet, foundry, mainnet, sepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { getAppUrl, getNetwork, LOCAL_DEFAULTS } from "@/config/env";

// Get absolute URL for proxy routes (needed for wagmi HTTP transport)
function getProxyUrl(path: string): string {
  if (typeof window !== "undefined") {
    return `${window.location.origin}${path}`;
  }
  // Server-side fallback - use centralized config
  return `${getAppUrl()}${path}`;
}

// Determine available chains based on configuration
function getAvailableChains() {
  const network = getNetwork();
  const isLocalNetwork = network === "local";
  const chains = [];

  // Only add foundry (Anvil) chain when explicitly using local network
  if (isLocalNetwork) {
    chains.push(foundry);
  }

  // Add Ethereum chains (mainnet + testnet)
  chains.push(mainnet, sepolia);

  // Add Base chains (always available)
  chains.push(base, baseSepolia);

  // Add BSC chains (always available)
  chains.push(bsc, bscTestnet);

  return chains;
}

const chains = getAvailableChains();

// Build transports dynamically based on available chains
function getTransports() {
  const transports: Record<number, ReturnType<typeof http>> = {};

  const network = getNetwork();
  const isLocalNetwork = network === "local";

  // Only add foundry (Anvil) transport when explicitly using local network
  if (isLocalNetwork) {
    transports[foundry.id] = http(LOCAL_DEFAULTS.evmRpc);
  }

  // Add Ethereum transports - use proxy to keep Alchemy key server-side
  transports[mainnet.id] = http(getProxyUrl("/api/rpc/ethereum"));
  transports[sepolia.id] = http(getProxyUrl("/api/rpc/ethereum"));

  // Add Base transports - use proxy to keep Alchemy key server-side
  transports[base.id] = http(getProxyUrl("/api/rpc/base"));
  transports[baseSepolia.id] = http(getProxyUrl("/api/rpc/base"));

  // Add BSC transports - public RPC
  transports[bsc.id] = http("https://bsc-dataseed1.binance.org");
  transports[bscTestnet.id] = http("https://data-seed-prebsc-1-s1.binance.org:8545");

  return transports;
}

// Create connectors only on client side to avoid indexedDB SSR errors
// Note: WalletConnect is handled by Privy, so we only use injected connector here
// farcasterMiniApp connector is prioritized when in Farcaster context
function getConnectors() {
  if (typeof window === "undefined") return [];
  return [
    farcasterMiniApp(), // Prioritize Farcaster wallet when in Farcaster Mini App context
    injected({ shimDisconnect: true }), // Fallback for browser wallets
  ];
}

// Wagmi configuration for Privy integration
// Privy handles wallet connection, wagmi handles contract interactions
export const config: Config = createConfig({
  chains: chains as never,
  connectors: getConnectors(),
  transports: getTransports() as never,
  ssr: true,
});

// Export chains for UI reference
export { chains };
