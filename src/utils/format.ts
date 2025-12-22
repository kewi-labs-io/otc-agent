/**
 * Shared formatting utilities
 * Used across pages for consistent date, number, and token formatting
 */

/**
 * Format a timestamp (in seconds) to a localized date string
 */
export function formatDate(tsSeconds: bigint | number): string {
  const ts = typeof tsSeconds === "bigint" ? Number(tsSeconds) : tsSeconds;
  const d = new Date(ts * 1000);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Format a timestamp to a full date/time string
 */
export function formatDateTime(tsSeconds: bigint | number): string {
  const ts = typeof tsSeconds === "bigint" ? Number(tsSeconds) : tsSeconds;
  const d = new Date(ts * 1000);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Format a token amount with K/M/B suffixes for readability
 * Input is expected to be in human-readable form (not wei)
 * Accepts bigint, number, or string (parses string to number)
 */
export function formatTokenAmount(amount: bigint | number | string): string {
  let num: number;
  if (typeof amount === "bigint") {
    num = Number(amount);
  } else if (typeof amount === "string") {
    num = parseFloat(amount);
  } else {
    num = amount;
  }

  if (Number.isNaN(num)) return "0";
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(2)}B`;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(2)}K`;
  return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * Format a raw token amount (string or bigint) with decimals
 * Converts from raw (wei-like) format to human-readable with K/M suffixes
 */
export function formatRawTokenAmount(amount: string | bigint, decimals: number): string {
  const num = Number(amount) / 10 ** decimals;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(2)}K`;
  return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * Format a token amount with full precision
 */
export function formatTokenAmountFull(amount: bigint | number, decimals = 2): string {
  const num = typeof amount === "bigint" ? Number(amount) : amount;
  return num.toLocaleString(undefined, { maximumFractionDigits: decimals });
}

/**
 * Format a USD amount
 */
export function formatUsd(amount: number, includeSign = true): string {
  const formatted = amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return includeSign ? `$${formatted}` : formatted;
}

/**
 * Format a USD amount with K/M suffixes for compact display
 */
export function formatUsdCompact(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(2)}K`;
  return `$${amount.toFixed(2)}`;
}

/**
 * Format market cap with B/M/K suffixes
 */
export function formatMarketCap(mc: number | null | undefined): string {
  if (mc == null) return "—";
  if (mc >= 1e9) return `$${(mc / 1e9).toFixed(2)}B`;
  if (mc >= 1e6) return `$${(mc / 1e6).toFixed(2)}M`;
  if (mc >= 1e3) return `$${(mc / 1e3).toFixed(2)}K`;
  return `$${mc.toFixed(2)}`;
}

/**
 * Format price with appropriate precision based on magnitude
 */
export function formatPrice(price: number | null | undefined): string {
  if (price == null) return "—";
  if (price < 0.0001) return price.toExponential(2);
  if (price < 1) return price.toFixed(6);
  return price.toFixed(4);
}

/**
 * Format a percentage (input is basis points, e.g., 1000 = 10%)
 */
export function formatPercentFromBps(bps: bigint | number): string {
  const num = typeof bps === "bigint" ? Number(bps) : bps;
  return `${(num / 100).toFixed(0)}%`;
}

/**
 * Format a percentage from a decimal (e.g., 0.1 = 10%)
 */
export function formatPercent(decimal: number): string {
  return `${(decimal * 100).toFixed(0)}%`;
}

/**
 * Get a lockup label from createdAt and unlockTime timestamps
 */
export function getLockupLabel(createdAt: bigint | number, unlockTime: bigint | number): string {
  const created = typeof createdAt === "bigint" ? Number(createdAt) : createdAt;
  const unlock = typeof unlockTime === "bigint" ? Number(unlockTime) : unlockTime;
  const seconds = Math.max(0, unlock - created);
  const months = Math.max(1, Math.round(seconds / (30 * 24 * 60 * 60)));
  return `${months} month${months === 1 ? "" : "s"}`;
}

/**
 * Format a wallet address for display (truncated)
 */
export function formatAddress(address: string, chars = 6): string {
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars + 2)}`;
}

/**
 * Format a transaction hash for display
 */
export function formatTxHash(hash: string, chars = 8): string {
  return formatAddress(hash, chars);
}

/**
 * Format time remaining until a timestamp
 */
export function formatTimeRemaining(unlockTimestamp: bigint | number): string {
  const unlock = typeof unlockTimestamp === "bigint" ? Number(unlockTimestamp) : unlockTimestamp;
  const now = Math.floor(Date.now() / 1000);
  const remaining = unlock - now;

  if (remaining <= 0) return "Ready";

  const days = Math.floor(remaining / 86400);
  const hours = Math.floor((remaining % 86400) / 3600);

  if (days > 30) {
    const months = Math.round(days / 30);
    return `${months} month${months === 1 ? "" : "s"}`;
  }
  if (days > 0) {
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

/**
 * Check if an offer/deal has matured (unlock time has passed)
 */
export function isMatured(unlockTimestamp: bigint | number): boolean {
  const unlock = typeof unlockTimestamp === "bigint" ? Number(unlockTimestamp) : unlockTimestamp;
  const now = Math.floor(Date.now() / 1000);
  return unlock <= now;
}

/**
 * Format native token amount (ETH, SOL, BNB) with appropriate precision
 */
export function formatNativeAmount(amount: bigint | number, symbol = "ETH"): string {
  const num = typeof amount === "bigint" ? Number(amount) / 1e18 : amount;
  const formatted = num.toLocaleString(undefined, {
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  });
  return `${formatted} ${symbol}`;
}

/**
 * Get block explorer URL for a transaction
 * Supports EVM chains (Ethereum, Base, BSC) and Solana
 */
export function getExplorerTxUrl(
  txHash: string,
  chain: "ethereum" | "base" | "bsc" | "solana",
  isTestnet = false,
): string {
  switch (chain) {
    case "solana":
      return `https://solscan.io/tx/${txHash}`;
    case "ethereum":
      return isTestnet
        ? `https://sepolia.etherscan.io/tx/${txHash}`
        : `https://etherscan.io/tx/${txHash}`;
    case "bsc":
      return isTestnet
        ? `https://testnet.bscscan.com/tx/${txHash}`
        : `https://bscscan.com/tx/${txHash}`;
    case "base":
      return isTestnet
        ? `https://sepolia.basescan.org/tx/${txHash}`
        : `https://basescan.org/tx/${txHash}`;
  }
}
