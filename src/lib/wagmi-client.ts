import { createConfig, http } from "wagmi";
import type { Config } from "wagmi";
import { mainnet, sepolia, localhost, base, baseSepolia, bsc, bscTestnet } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { farcasterMiniApp } from "@farcaster/miniapp-wagmi-connector";

// Custom RPC URLs - use proxy routes to keep API keys server-side
const ethRpcUrl = process.env.NEXT_PUBLIC_ETH_RPC_URL;
const baseRpcUrl = process.env.NEXT_PUBLIC_BASE_RPC_URL;
const bscRpcUrl = process.env.NEXT_PUBLIC_BSC_RPC_URL;
const anvilRpcUrl = process.env.NEXT_PUBLIC_RPC_URL || "http://127.0.0.1:8545";

// Get absolute URL for proxy routes (needed for wagmi HTTP transport)
function getProxyUrl(path: string): string {
  if (typeof window !== "undefined") {
    return `${window.location.origin}${path}`;
  }
  // Server-side fallback - use env or default
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:4444";
  return `${appUrl}${path}`;
}

// Determine available chains based on configuration
function getAvailableChains() {
  const network = process.env.NEXT_PUBLIC_NETWORK;
  const isLocalNetwork = network === "local" || network === "localnet";
  const chains = [];

  // Only add localhost when explicitly using local network
  if (isLocalNetwork) {
    chains.push(localhost);
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

  const network = process.env.NEXT_PUBLIC_NETWORK;
  const isLocalNetwork = network === "local" || network === "localnet";

  // Only add localhost transport when explicitly using local network
  if (isLocalNetwork) {
    transports[localhost.id] = http(anvilRpcUrl);
  }

  // Add Ethereum transports - use proxy to keep Alchemy key server-side
  transports[mainnet.id] = http(ethRpcUrl || getProxyUrl("/api/rpc/ethereum"));
  transports[sepolia.id] = http(ethRpcUrl || getProxyUrl("/api/rpc/ethereum"));

  // Add Base transports - use proxy to keep Alchemy key server-side
  transports[base.id] = http(baseRpcUrl || getProxyUrl("/api/rpc/base"));
  transports[baseSepolia.id] = http(baseRpcUrl || getProxyUrl("/api/rpc/base"));

  // Add BSC transports
  if (bscRpcUrl) {
    transports[bsc.id] = http(bscRpcUrl);
    transports[bscTestnet.id] = http(bscRpcUrl);
  }

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
