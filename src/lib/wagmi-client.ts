import { createConfig, http } from "wagmi";
import type { Config } from "wagmi";
import { base, hardhat, mainnet } from "wagmi/chains";
import { injected, walletConnect } from "wagmi/connectors";

// Custom RPC URL if provided, otherwise use default
const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || "http://127.0.0.1:8545";

// Configure chains based on environment
const isDevelopment = process.env.NODE_ENV === "development";
const chains = isDevelopment ? [hardhat, base, mainnet] : [base, mainnet];

// Create connectors only on client side to avoid indexedDB SSR errors
function getConnectors() {
  if (typeof window === "undefined") return [];
  return [
    injected({ shimDisconnect: true }),
    walletConnect({
      projectId: process.env.NEXT_PUBLIC_PROJECT_ID || "demo-project-id",
    }),
  ];
}

// Wagmi configuration for Privy integration
// Privy handles wallet connection, wagmi handles contract interactions
export const config: Config = createConfig({
  chains: chains as any,
  connectors: getConnectors(),
  transports: {
    [hardhat.id]: http(rpcUrl),
    [base.id]: http(),
    [mainnet.id]: http(),
  },
  ssr: true,
});
