/**
 * Consolidated Solana keypair loading utilities
 *
 * Supports:
 * - Environment variable (base58 or JSON array format)
 * - File-based keypair (development/localnet)
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { Wallet } from "@coral-xyz/anchor";
import { Keypair, type Transaction, type VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";

/**
 * Load Solana keypair from environment variable or file
 *
 * Tries in order:
 * 1. SOLANA_DESK_PRIVATE_KEY env var (base58 or JSON array)
 * 2. File-based keypairs in solana/otc-program/ directory
 */
export async function loadDeskKeypair(): Promise<Keypair> {
  // 1. Try environment variable first (production/mainnet)
  const privateKeyStr = process.env.SOLANA_DESK_PRIVATE_KEY;
  if (privateKeyStr) {
    return parseKeypairFromString(privateKeyStr);
  }

  // 2. Try file-based keypair (localnet/development)
  const possiblePaths = [
    path.join(process.cwd(), "solana/otc-program/desk-keypair.json"),
    path.join(process.cwd(), "solana/otc-program/desk-mainnet-keypair.json"),
    path.join(process.cwd(), "solana/otc-program/desk-devnet-keypair.json"),
    path.join(process.cwd(), "solana/otc-program/mainnet-deployer.json"),
    path.join(process.cwd(), "solana/otc-program/id.json"),
  ];

  for (const keypairPath of possiblePaths) {
    try {
      const keypairData = JSON.parse(await fs.readFile(keypairPath, "utf8"));
      return Keypair.fromSecretKey(Uint8Array.from(keypairData));
    } catch (err) {
      // Only continue if file doesn't exist (ENOENT) - throw for other errors
      if (err instanceof Error && "code" in err && err.code === "ENOENT") {
        // File doesn't exist, try next path
        continue;
      }
      // FAIL-FAST: Re-throw unexpected errors (parse errors, permission errors, etc.)
      throw err;
    }
  }

  throw new Error(
    "Desk keypair not found. Set SOLANA_DESK_PRIVATE_KEY env var (base58 or JSON array) with the private key for the desk address.",
  );
}

/**
 * Load generic Solana keypair from environment variable
 */
export function loadKeypairFromEnv(envVar: string): Keypair {
  const privateKeyStr = process.env[envVar];
  if (!privateKeyStr) {
    throw new Error(`${envVar} environment variable is not set`);
  }
  return parseKeypairFromString(privateKeyStr);
}

/**
 * Parse keypair from string (supports base58 and JSON array formats)
 */
export function parseKeypairFromString(privateKeyStr: string): Keypair {
  // Support JSON array format: "[1,2,3,...]"
  if (privateKeyStr.startsWith("[")) {
    const secretKey = Uint8Array.from(JSON.parse(privateKeyStr));
    return Keypair.fromSecretKey(secretKey);
  }

  // Default to base58 format
  const secretKey = bs58.decode(privateKeyStr);
  return Keypair.fromSecretKey(secretKey);
}

/**
 * Create an Anchor-compatible wallet from a Keypair
 */
export class KeypairWallet implements Wallet {
  constructor(readonly payer: Keypair) {}

  get publicKey() {
    return this.payer.publicKey;
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    if ("version" in tx) {
      tx.sign([this.payer]);
    } else {
      (tx as Transaction).partialSign(this.payer);
    }
    return tx;
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
    return Promise.all(txs.map((tx) => this.signTransaction(tx)));
  }
}

/**
 * Wallet interface for Anchor (matches @coral-xyz/anchor's Wallet type)
 *
 * NOTE: This is a utility-specific type. For shared types, use AnchorWallet from @/types
 * which is compatible with the shared SolanaTransaction interface.
 */
export interface AnchorWallet {
  publicKey: import("@solana/web3.js").PublicKey;
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
  signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]>;
}

/**
 * Create a simple AnchorWallet from a Keypair
 * (Alternative to KeypairWallet class for simpler use cases)
 */
export function createAnchorWallet(keypair: Keypair): AnchorWallet {
  return {
    publicKey: keypair.publicKey,
    signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T) => {
      (tx as Transaction).partialSign(keypair);
      return tx;
    },
    signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]) => {
      for (const tx of txs) {
        (tx as Transaction).partialSign(keypair);
      }
      return txs;
    },
  };
}
