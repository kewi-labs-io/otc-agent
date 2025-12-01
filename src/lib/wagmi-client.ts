import { createConfig, http } from "wagmi";
import type { Config } from "wagmi";
import { localhost, base, baseSepolia, bsc, bscTestnet } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { farcasterFrame } from "@farcaster/frame-wagmi-connector";

// Custom RPC URLs
const baseRpcUrl = process.env.NEXT_PUBLIC_BASE_RPC_URL;
const bscRpcUrl = process.env.NEXT_PUBLIC_BSC_RPC_URL;
const anvilRpcUrl = process.env.NEXT_PUBLIC_RPC_URL || "http://127.0.0.1:8545";

// Determine available chains based on configuration
function getAvailableChains() {
  const isDevelopment = process.env.NODE_ENV === "development";
  const chains = [];

  // Add localnet chains first in dev mode (default)
  if (isDevelopment) {
    chains.push(localhost);
  }

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

  const isDevelopment = process.env.NODE_ENV === "development";

  if (isDevelopment) {
    transports[localhost.id] = http(anvilRpcUrl);
  }

  // Add Base transports
  if (baseRpcUrl) {
    transports[base.id] = http(baseRpcUrl);
    transports[baseSepolia.id] = http(baseRpcUrl);
  } else {
    // Use public RPCs
    transports[base.id] = http("https://mainnet.base.org");
    transports[baseSepolia.id] = http("https://sepolia.base.org");
  }

  // Add BSC transports
  if (bscRpcUrl) {
    transports[bsc.id] = http(bscRpcUrl);
    transports[bscTestnet.id] = http(bscRpcUrl);
  } else {
    // Use public RPCs
    transports[bsc.id] = http("https://bsc-dataseed1.binance.org");
    transports[bscTestnet.id] = http(
      "https://data-seed-prebsc-1-s1.binance.org:8545",
    );
  }

  return transports;
}

// Create connectors only on client side to avoid indexedDB SSR errors
// Note: WalletConnect is handled by Privy, so we only use injected connector here
// farcasterFrame connector is prioritized when in Farcaster context
function getConnectors() {
  if (typeof window === "undefined") return [];
  return [
    farcasterFrame(), // Prioritize Farcaster wallet when in Farcaster Mini App context
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
