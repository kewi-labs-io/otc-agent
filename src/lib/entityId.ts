// Entity ID utilities using Eliza's stringToUuid

import { stringToUuid } from "@elizaos/core";

/**
 * Convert wallet address to deterministic UUID entity ID
 * Uses Eliza's built-in stringToUuid for consistency with runtime
 */
export function walletToEntityId(address: string): string {
  const normalized = address.toLowerCase().trim();
  return stringToUuid(normalized) as string;
}

/**
 * Validate entity ID format
 */
export function isValidEntityId(entityId: string): boolean {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(entityId);
}
