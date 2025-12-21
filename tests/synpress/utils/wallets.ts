import type { EvmWalletConfig, SolanaWalletConfig } from "@/types";

export type { EvmWalletConfig, SolanaWalletConfig };

const defaultSeed = "test test test test test test test test test test test junk";
const defaultPassword = "Tester@1234";

export const evmSeller: EvmWalletConfig = {
  seedPhrase: process.env.SELLER_SEED_PHRASE ?? defaultSeed,
  password: process.env.WALLET_PASSWORD ?? defaultPassword,
  address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8545",
  chainId: Number(process.env.CHAIN_ID ?? 31337),
};

export const evmBuyer: EvmWalletConfig = {
  seedPhrase: process.env.BUYER_SEED_PHRASE ?? defaultSeed,
  password: process.env.WALLET_PASSWORD ?? defaultPassword,
  address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8545",
  chainId: Number(process.env.CHAIN_ID ?? 31337),
};

export const phantomTrader: SolanaWalletConfig = {
  seedPhrase: process.env.PHANTOM_SEED_PHRASE ?? defaultSeed,
  password: process.env.PHANTOM_PASSWORD ?? defaultPassword,
  // Derived from the default seed when imported into Phantom
  address: process.env.PHANTOM_PUBLIC_ADDRESS ?? "oeYf6KAJkLYhBuR8CiGc6L4D4Xtfepr85fuDgA9kq96",
  rpcUrl: process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899",
};

export const tokenAddresses = {
  evmEliza: process.env.EVM_ELIZA_ADDRESS ?? "0xea17df5cf6d172224892b5477a16acb111182478",
  evmUsdc: process.env.EVM_USDC_ADDRESS ?? "0x7B0d3C4b0C297a49F18A8b048121F8F67E7f3e8d",
  solanaEliza: process.env.SOLANA_ELIZA_ADDRESS ?? "DuMbhu7mvQvqQHGcnikDgb4XegXJRyhUBfdU22uELiZA",
};
