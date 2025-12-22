/**
 * Core reusable Zod schemas for validation
 * These schemas are used across API routes, services, and hooks
 */

import { z } from "zod";

//==============================================================================
// CHAIN VALIDATION
//==============================================================================

export const ChainSchema = z.enum(["ethereum", "base", "bsc", "solana"]);
export type Chain = z.infer<typeof ChainSchema>;

export const ChainFamilySchema = z.enum(["evm", "solana"]);
export type ChainFamily = z.infer<typeof ChainFamilySchema>;

export const EVMChainSchema = z.enum(["base", "bsc", "ethereum"]);
export type EVMChain = z.infer<typeof EVMChainSchema>;

//==============================================================================
// ADDRESS VALIDATION
//==============================================================================

// EVM addresses: 0x followed by 40 hex characters (case-insensitive)
export const EvmAddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid EVM address format");

// Solana addresses: Base58 encoded, 32-44 characters (case-sensitive)
export const SolanaAddressSchema = z
  .string()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Invalid Solana address format");

// Union schema that accepts either EVM or Solana addresses
export const AddressSchema = z.union([EvmAddressSchema, SolanaAddressSchema]);

//==============================================================================
// NUMERIC VALIDATION
//==============================================================================

// BigInt string validation (for token amounts stored as strings)
// Must be a non-negative integer string
export const BigIntStringSchema = z
  .string()
  .regex(/^\d+$/, "Must be a non-negative integer string")
  .max(78, "Number exceeds maximum safe value (uint256 max is 78 digits)");

// Basis points: 0-10000 (0% to 100%)
export const BpsSchema = z.number().int().min(0).max(10000);

// Timestamps: positive integers
export const TimestampSchema = z.number().int().positive();

// Non-negative numbers
export const NonNegativeNumberSchema = z.number().nonnegative();

// Positive numbers
export const PositiveNumberSchema = z.number().positive();

//==============================================================================
// PAYMENT CURRENCY
//==============================================================================

export const PaymentCurrencySchema = z.enum(["ETH", "USDC", "BNB", "SOL"]);
export type PaymentCurrency = z.infer<typeof PaymentCurrencySchema>;

//==============================================================================
// QUOTE STATUS
//==============================================================================

export const QuoteStatusSchema = z.enum(["active", "expired", "executed", "rejected", "approved"]);
export type QuoteStatus = z.infer<typeof QuoteStatusSchema>;

//==============================================================================
// CONSIGNMENT STATUS
//==============================================================================

export const ConsignmentStatusSchema = z.enum(["active", "paused", "depleted", "withdrawn"]);
export type ConsignmentStatus = z.infer<typeof ConsignmentStatusSchema>;

//==============================================================================
// DEAL STATUS
//==============================================================================

export const DealStatusSchema = z.enum(["pending", "executed", "failed"]);
export type DealStatus = z.infer<typeof DealStatusSchema>;

//==============================================================================
// URL VALIDATION
//==============================================================================

// URL schema that accepts:
// - Valid absolute URLs (https://..., http://...)
// - Relative paths starting with / (e.g., /tokens/eliza.svg)
// - Empty string (no URL)
export const UrlSchema = z.union([z.string().url(), z.string().startsWith("/"), z.literal("")]);

//==============================================================================
// COMMON STRING VALIDATIONS
//==============================================================================

// Non-empty string
export const NonEmptyStringSchema = z.string().min(1);

// Optional non-empty string
export const OptionalNonEmptyStringSchema = z.string().min(1).optional();

// Hex string (for bytes32, transaction hashes, etc.)
export const HexStringSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]+$/, "Must be a valid hex string")
  .max(131072, "Hex string exceeds maximum allowed length"); // 64KB limit

// Bytes32 hex string (64 hex characters after 0x)
export const Bytes32Schema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{64}$/, "Must be a valid bytes32 hex string");

//==============================================================================
// ARRAY VALIDATIONS
//==============================================================================

// Array of addresses
export const AddressArraySchema = z.array(AddressSchema);

// Optional array of addresses
export const OptionalAddressArraySchema = z.array(AddressSchema).optional();

//==============================================================================
// UTILITY FUNCTIONS
//==============================================================================

/**
 * Create a schema that validates an address based on chain type
 */
export function createChainAddressSchema(chain: Chain) {
  if (chain === "solana") {
    return SolanaAddressSchema;
  }
  return EvmAddressSchema;
}

/**
 * Validate that a value is a valid BigInt string and convert to BigInt
 */
export function parseBigIntString(value: string): bigint {
  const validated = BigIntStringSchema.parse(value);
  return BigInt(validated);
}
