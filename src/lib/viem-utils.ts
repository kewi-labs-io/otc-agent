/**
 * Type-safe viem utilities for contract interactions
 *
 * viem 2.x has very strict generic types for readContract that require
 * exact ABI type inference. When using dynamic ABIs (loaded from JSON artifacts),
 * this causes type errors. This module provides type-safe wrappers.
 *
 * NOTE ON `unknown` TYPES:
 * This module uses `unknown` in specific places where viem's strict type system
 * cannot infer types from dynamic ABIs:
 * 1. `abi: Abi | readonly unknown[]` - ABI loaded from JSON at runtime
 * 2. `args?: readonly unknown[]` - Solidity supports complex nested types
 * 3. Return type casts - The caller must know the expected return type
 *
 * These are not violations of the "no unknown" rule - they are necessary
 * adaptations to viem's type system when using runtime-loaded ABIs.
 */

import type { Abi, AbiEvent, Address, Log, PublicClient } from "viem";

/**
 * Parameters for reading a contract with a dynamic ABI
 *
 * Note: Both abi and args use flexible types for viem compatibility:
 * - abi: `Abi | readonly unknown[]` because viem sometimes infers unknown[] from JSON
 * - args: `readonly unknown[]` because Solidity supports complex nested types
 */
export interface ReadContractParams {
  address: Address;
  abi: Abi | readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
}

/**
 * Transaction log with decoded args (matches viem's Log type structure)
 */
interface TransactionLog {
  address: Address;
  blockHash: `0x${string}`;
  blockNumber: bigint;
  data: `0x${string}`;
  logIndex: number;
  transactionHash: `0x${string}`;
  transactionIndex: number;
  removed: boolean;
  topics: readonly `0x${string}`[];
  // Decoded args if ABI was provided - uses primitive types common in events
  args?: Record<string, string | number | bigint | boolean | Address>;
  eventName?: string;
}

/**
 * Minimal public client interface to avoid viem's "excessively deep" type issues.
 * Use this instead of PublicClient when you only need these methods.
 *
 * Return types use `unknown` for viem compatibility - callers should cast results
 * to expected types using safeReadContract<T>().
 */
export interface MinimalPublicClient {
  readContract: (params: ReadContractParams) => Promise<unknown>;
  getBlockNumber?: () => Promise<bigint>;
  getLogs?: (params: {
    address: Address;
    event: AbiEvent;
    fromBlock: bigint;
    toBlock: bigint | "latest";
  }) => Promise<Log[]>;
  getTransactionReceipt?: (params: { hash: `0x${string}` }) => Promise<{
    status: "success" | "reverted";
    logs: TransactionLog[];
    blockNumber: bigint;
  }>;
}

/**
 * Any client with a readContract method - avoids viem's deep type incompatibilities
 * across different chain configurations.
 */
type AnyReadContractClient = {
  readContract: (...args: never[]) => Promise<unknown>;
};

/**
 * Type-safe wrapper for readContract that works with dynamic ABIs.
 *
 * Use this when the ABI is loaded from a JSON artifact at runtime,
 * which prevents TypeScript from inferring the exact return type.
 *
 * The type parameter T should match the expected return type of the
 * contract function being called. This is a trusted cast since the
 * ABI defines what the function returns.
 *
 * @example
 * ```ts
 * const result = await safeReadContract<bigint>(client, {
 *   address: contractAddress,
 *   abi: artifact.abi as Abi,
 *   functionName: "balanceOf",
 *   args: [userAddress],
 * });
 * ```
 */
export async function safeReadContract<T>(
  client: AnyReadContractClient,
  params: ReadContractParams,
): Promise<T> {
  // The cast is necessary because viem's readContract has strict generics
  // that require compile-time ABI type inference. With dynamic ABIs,
  // we must bypass this and rely on runtime behavior.
  const result = await (client.readContract as (params: ReadContractParams) => Promise<unknown>)(
    params,
  );
  return result as T;
}

/**
 * ERC-20 ABI for common token operations
 * Defined as const for full type inference
 */
export const ERC20_ABI = [
  {
    name: "symbol",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    name: "name",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

/**
 * Type-safe ERC-20 token info reader
 */
export async function readERC20Info(
  client: PublicClient,
  tokenAddress: Address,
): Promise<{ symbol: string; name: string; decimals: number }> {
  const [symbol, name, decimals] = await Promise.all([
    safeReadContract<string>(client, {
      address: tokenAddress,
      abi: ERC20_ABI as Abi,
      functionName: "symbol",
    }),
    safeReadContract<string>(client, {
      address: tokenAddress,
      abi: ERC20_ABI as Abi,
      functionName: "name",
    }),
    safeReadContract<number>(client, {
      address: tokenAddress,
      abi: ERC20_ABI as Abi,
      functionName: "decimals",
    }),
  ]);
  return { symbol, name, decimals };
}

/**
 * Type-safe ERC-20 balance reader
 */
export async function readERC20Balance(
  client: PublicClient,
  tokenAddress: Address,
  account: Address,
): Promise<bigint> {
  return safeReadContract<bigint>(client, {
    address: tokenAddress,
    abi: ERC20_ABI as Abi,
    functionName: "balanceOf",
    args: [account],
  });
}
