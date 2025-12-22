/**
 * useSolanaBalance - React Query hook for fetching Solana wallet balances
 *
 * Fetches:
 * - Native SOL balance
 * - SPL token balances (USDC, etc.)
 *
 * Used by:
 * - accept-quote-modal for showing user's payment currency balance
 */

import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { type Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { useQuery } from "@tanstack/react-query";
import { getSolanaConfig } from "@/config/contracts";
import { createSolanaConnection } from "@/utils/solana-otc";
import { walletTokenKeys } from "./queryKeys";

/**
 * Balance data returned by the hook
 */
interface SolanaBalanceData {
  /** Balance in lamports (SOL) or smallest unit (SPL tokens) */
  value: bigint;
  /** Human-readable formatted balance */
  formatted: string;
  /** Number of decimals (9 for SOL, varies for SPL tokens) */
  decimals: number;
  /** Symbol for display */
  symbol: string;
}

/**
 * Fetch native SOL balance
 */
async function fetchSolBalance(
  connection: Connection,
  publicKey: PublicKey,
): Promise<SolanaBalanceData> {
  const lamports = await connection.getBalance(publicKey);

  return {
    value: BigInt(lamports),
    formatted: (lamports / LAMPORTS_PER_SOL).toFixed(4),
    decimals: 9,
    symbol: "SOL",
  };
}

/**
 * Fetch SPL token balance (e.g., USDC)
 */
async function fetchSplTokenBalance(
  connection: Connection,
  walletPublicKey: PublicKey,
  mintPublicKey: PublicKey,
  decimals: number,
  symbol: string,
): Promise<SolanaBalanceData> {
  const associatedTokenAddress = await getAssociatedTokenAddress(
    mintPublicKey,
    walletPublicKey,
    false,
    TOKEN_PROGRAM_ID,
  );

  const accountInfo = await connection.getAccountInfo(associatedTokenAddress);

  if (!accountInfo) {
    // No token account exists - balance is 0
    return {
      value: BigInt(0),
      formatted: "0",
      decimals,
      symbol,
    };
  }

  // Parse token account data to get balance
  // Token account data layout: mint (32) + owner (32) + amount (8) + ...
  const data = accountInfo.data;
  const amountOffset = 64; // After mint and owner
  const amountBytes = data.slice(amountOffset, amountOffset + 8);
  const amount = new DataView(
    amountBytes.buffer,
    amountBytes.byteOffset,
    amountBytes.byteLength,
  ).getBigUint64(0, true);

  const divisor = 10 ** decimals;
  const formatted = (Number(amount) / divisor).toFixed(decimals > 4 ? 4 : 2);

  return {
    value: amount,
    formatted,
    decimals,
    symbol,
  };
}

/**
 * Hook to fetch native SOL balance
 *
 * Features:
 * - 30s stale time (balances can change with transactions)
 * - 5min cache time
 * - Automatic refetch on window focus
 *
 * @param publicKey - Solana public key as string or PublicKey
 * @returns { data, isLoading, error }
 */
export function useSolBalance(publicKey: string | PublicKey | null | undefined) {
  const pubkeyString = typeof publicKey === "string" ? publicKey : (publicKey?.toBase58() ?? null);

  return useQuery({
    queryKey: pubkeyString ? walletTokenKeys.solBalance(pubkeyString) : ["sol-balance", "none"],
    queryFn: async (): Promise<SolanaBalanceData> => {
      if (!pubkeyString) {
        throw new Error("No public key provided");
      }

      const connection = createSolanaConnection();
      const pk = new PublicKey(pubkeyString);

      return fetchSolBalance(connection, pk);
    },
    staleTime: 30_000, // 30 seconds
    gcTime: 300_000, // 5 minutes
    enabled: !!pubkeyString,
    refetchOnWindowFocus: true,
  });
}

/**
 * Hook to fetch USDC balance on Solana
 *
 * Features:
 * - Uses USDC mint from deployment config
 * - 30s stale time
 * - 5min cache time
 *
 * @param publicKey - Solana public key as string or PublicKey
 * @returns { data, isLoading, error }
 */
export function useSolanaUsdcBalance(publicKey: string | PublicKey | null | undefined) {
  const pubkeyString = typeof publicKey === "string" ? publicKey : (publicKey?.toBase58() ?? null);

  const solanaConfig = getSolanaConfig();
  const usdcMint = solanaConfig.usdcMint;

  return useQuery({
    queryKey: pubkeyString
      ? walletTokenKeys.solUsdcBalance(pubkeyString)
      : ["sol-usdc-balance", "none"],
    queryFn: async (): Promise<SolanaBalanceData> => {
      if (!pubkeyString) {
        throw new Error("No public key provided");
      }

      if (!usdcMint) {
        throw new Error("USDC mint not configured for Solana");
      }

      const connection = createSolanaConnection();
      const walletPk = new PublicKey(pubkeyString);
      const mintPk = new PublicKey(usdcMint);

      // USDC on Solana has 6 decimals
      return fetchSplTokenBalance(connection, walletPk, mintPk, 6, "USDC");
    },
    staleTime: 30_000,
    gcTime: 300_000,
    enabled: !!pubkeyString && !!usdcMint,
    refetchOnWindowFocus: true,
  });
}

/**
 * Hook to fetch any SPL token balance
 *
 * @param publicKey - Wallet public key
 * @param mintAddress - Token mint address
 * @param decimals - Token decimals
 * @param symbol - Token symbol for display
 * @returns { data, isLoading, error }
 */
export function useSplTokenBalance(
  publicKey: string | PublicKey | null | undefined,
  mintAddress: string | null | undefined,
  decimals: number,
  symbol: string,
) {
  const pubkeyString = typeof publicKey === "string" ? publicKey : (publicKey?.toBase58() ?? null);

  return useQuery({
    queryKey:
      pubkeyString && mintAddress
        ? walletTokenKeys.splBalance(pubkeyString, mintAddress)
        : ["spl-balance", "none"],
    queryFn: async (): Promise<SolanaBalanceData> => {
      if (!pubkeyString) {
        throw new Error("No public key provided");
      }
      if (!mintAddress) {
        throw new Error("No mint address provided");
      }

      const connection = createSolanaConnection();
      const walletPk = new PublicKey(pubkeyString);
      const mintPk = new PublicKey(mintAddress);

      return fetchSplTokenBalance(connection, walletPk, mintPk, decimals, symbol);
    },
    staleTime: 30_000,
    gcTime: 300_000,
    enabled: !!pubkeyString && !!mintAddress,
    refetchOnWindowFocus: true,
  });
}

/**
 * Combined hook for payment currency balance (SOL or USDC)
 *
 * This is the main hook for accept-quote-modal to display
 * the user's balance of their selected payment currency.
 *
 * @param publicKey - Wallet public key
 * @param currency - "SOL" or "USDC"
 * @returns { data, isLoading, error }
 */
export function useSolanaPaymentBalance(
  publicKey: string | PublicKey | null | undefined,
  currency: "SOL" | "USDC",
) {
  const solBalance = useSolBalance(currency === "SOL" ? publicKey : null);
  const usdcBalance = useSolanaUsdcBalance(currency === "USDC" ? publicKey : null);

  if (currency === "SOL") {
    return solBalance;
  }
  return usdcBalance;
}
