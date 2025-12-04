import localEvm from "./deployments/local-evm.json";
import localSolana from "./deployments/local-solana.json";
import testnetEvm from "./deployments/testnet-evm.json";
import testnetSolana from "./deployments/testnet-solana.json";
import mainnetEvm from "./deployments/mainnet-evm.json";
import mainnetSolana from "./deployments/mainnet-solana.json";

export type EvmDeployment = {
  contracts?: {
    otc?: string;
    usdc?: string;
    elizaToken?: string;
    deal?: string;
    // ... other fields
  };
  // ...
};

export type SolanaDeployment = {
  NEXT_PUBLIC_SOLANA_RPC?: string;
  NEXT_PUBLIC_SOLANA_PROGRAM_ID?: string;
  NEXT_PUBLIC_SOLANA_DESK?: string;
  NEXT_PUBLIC_SOLANA_DESK_OWNER?: string;
  NEXT_PUBLIC_SOLANA_USDC_MINT?: string;
};

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

export function getContracts(
  network: "local" | "testnet" | "mainnet" = "local",
) {
  return CONTRACT_DEPLOYMENTS[network];
}
