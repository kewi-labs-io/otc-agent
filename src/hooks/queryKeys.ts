/**
 * Centralized Query Key Factory
 *
 * All React Query keys in one place for:
 * - Type-safe key generation
 * - Easy cache invalidation
 * - Consistent key structure
 *
 * Pattern: [domain, scope?, ...params]
 */

import type { Chain } from "@/config/chains";
import type { ConsignmentsFilters } from "@/types/validation/hook-schemas";

/**
 * Token query keys
 */
export const tokenKeys = {
  all: ["tokens"] as const,
  lists: () => [...tokenKeys.all, "list"] as const,
  batches: () => [...tokenKeys.all, "batch"] as const,
  batch: (ids: string[]) =>
    [...tokenKeys.batches(), ids.sort().join(",")] as const,
  single: (id: string) => [...tokenKeys.all, "single", id] as const,
  marketData: (id: string) => [...tokenKeys.all, "marketData", id] as const,
  lookup: (address: string, chain: Chain) =>
    [...tokenKeys.all, "lookup", chain, address] as const,
  decimals: (address: string, chain: Chain) =>
    [...tokenKeys.all, "decimals", chain, address] as const,
};

/**
 * Consignment query keys
 * Single source of truth for all consignment-related cache keys
 */
export const consignmentKeys = {
  all: ["consignments"] as const,
  lists: () => [...consignmentKeys.all, "list"] as const,
  list: (filters: ConsignmentsFilters) =>
    [...consignmentKeys.lists(), filters] as const,
  single: (id: string) => [...consignmentKeys.all, "single", id] as const,
  byConsigner: (address: string) =>
    [...consignmentKeys.lists(), { consigner: address }] as const,
  byToken: (tokenId: string) =>
    [...consignmentKeys.lists(), { tokenId }] as const,
};

/**
 * Deal query keys
 */
export const dealKeys = {
  all: ["deals"] as const,
  lists: () => [...dealKeys.all, "list"] as const,
  byWallet: (wallet: string) => [...dealKeys.lists(), wallet] as const,
};

/**
 * Quote query keys
 */
export const quoteKeys = {
  all: ["quotes"] as const,
  executed: (id: string) => [...quoteKeys.all, "executed", id] as const,
  byOffer: (offerId: string) => [...quoteKeys.all, "byOffer", offerId] as const,
  latest: (quoteId: string) => [...quoteKeys.all, "latest", quoteId] as const,
};

/**
 * Pool query keys
 */
export const poolKeys = {
  all: ["pools"] as const,
  check: (address: string, chain: Chain) =>
    [...poolKeys.all, "check", chain, address] as const,
};

/**
 * Wallet token query keys
 */
export const walletTokenKeys = {
  all: ["walletTokens"] as const,
  byChain: (chain: Chain) => [...walletTokenKeys.all, chain] as const,
  byWallet: (address: string, chain: Chain) =>
    [...walletTokenKeys.byChain(chain), address] as const,
};

/**
 * Price query keys
 */
export const priceKeys = {
  all: ["prices"] as const,
  native: () => [...priceKeys.all, "native"] as const,
  token: (tokenId: string) => [...priceKeys.all, "token", tokenId] as const,
  tokenByMint: (mint: string) =>
    [...priceKeys.all, "tokenByMint", mint] as const,
};

/**
 * Chat/Room query keys
 */
export const chatKeys = {
  all: ["chat"] as const,
  rooms: () => [...chatKeys.all, "rooms"] as const,
  room: (roomId: string) => [...chatKeys.all, "room", roomId] as const,
  messages: (roomId: string) => [...chatKeys.all, "messages", roomId] as const,
  messagesAfter: (roomId: string, afterTimestamp: number) =>
    [...chatKeys.messages(roomId), "after", afterTimestamp] as const,
};
