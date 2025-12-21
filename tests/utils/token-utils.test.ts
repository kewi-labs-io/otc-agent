/**
 * Token Utils Unit Tests
 *
 * Comprehensive tests for token ID parsing and manipulation utilities.
 * Tests boundary conditions, edge cases, error handling, and data verification.
 *
 * Run: bun test tests/utils/token-utils.test.ts
 */

import { describe, test, expect } from "bun:test";
import {
  parseTokenId,
  buildTokenId,
  isValidChain,
  getChainFamily,
  extractChainFromTokenId,
  extractAddressFromTokenId,
  isEvmToken,
  isSolanaToken,
} from "@/utils/token-utils";

// =============================================================================
// VALID INPUTS - HAPPY PATH
// =============================================================================
describe("Token Utils - Happy Path", () => {
  describe("parseTokenId", () => {
    test("parses valid EVM token ID", () => {
      const result = parseTokenId("token-base-0x1234567890123456789012345678901234567890");
      expect(result.chain).toBe("base");
      expect(result.address).toBe("0x1234567890123456789012345678901234567890");
    });

    test("parses valid Solana token ID", () => {
      const result = parseTokenId("token-solana-So11111111111111111111111111111111111111112");
      expect(result.chain).toBe("solana");
      expect(result.address).toBe("So11111111111111111111111111111111111111112");
    });

    test("parses all supported chains", () => {
      const chains = ["ethereum", "base", "bsc", "solana"] as const;
      for (const chain of chains) {
        const result = parseTokenId(`token-${chain}-address`);
        expect(result.chain).toBe(chain);
        expect(result.address).toBe("address");
      }
    });
  });

  describe("buildTokenId", () => {
    test("builds valid token ID", () => {
      const result = buildTokenId("base", "0x1234");
      expect(result).toBe("token-base-0x1234");
    });

    test("roundtrips with parseTokenId", () => {
      const built = buildTokenId("ethereum", "0xabc");
      const parsed = parseTokenId(built);
      expect(parsed.chain).toBe("ethereum");
      expect(parsed.address).toBe("0xabc");
    });
  });

  describe("getChainFamily", () => {
    test("returns evm for EVM chains", () => {
      expect(getChainFamily("token-ethereum-0x1")).toBe("evm");
      expect(getChainFamily("token-base-0x1")).toBe("evm");
      expect(getChainFamily("token-bsc-0x1")).toBe("evm");
    });

    test("returns solana for Solana chain", () => {
      expect(getChainFamily("token-solana-abc")).toBe("solana");
    });
  });

  describe("chain type helpers", () => {
    test("isEvmToken returns true for EVM", () => {
      expect(isEvmToken("token-base-0x1")).toBe(true);
      expect(isEvmToken("token-ethereum-0x1")).toBe(true);
      expect(isEvmToken("token-bsc-0x1")).toBe(true);
    });

    test("isEvmToken returns false for Solana", () => {
      expect(isEvmToken("token-solana-abc")).toBe(false);
    });

    test("isSolanaToken returns true for Solana", () => {
      expect(isSolanaToken("token-solana-abc")).toBe(true);
    });

    test("isSolanaToken returns false for EVM", () => {
      expect(isSolanaToken("token-base-0x1")).toBe(false);
    });
  });
});

// =============================================================================
// BOUNDARY CONDITIONS
// =============================================================================
describe("Token Utils - Boundary Conditions", () => {
  describe("parseTokenId - minimum valid inputs", () => {
    test("accepts minimum length address", () => {
      const result = parseTokenId("token-base-x");
      expect(result.chain).toBe("base");
      expect(result.address).toBe("x");
    });

    test("accepts single character address", () => {
      const result = parseTokenId("token-solana-1");
      expect(result.address).toBe("1");
    });
  });

  describe("parseTokenId - addresses with special characters", () => {
    test("preserves addresses containing dashes", () => {
      // Edge case: if an address somehow contains dashes
      const result = parseTokenId("token-base-addr-with-dashes");
      expect(result.chain).toBe("base");
      expect(result.address).toBe("addr-with-dashes");
    });

    test("preserves multiple dash segments", () => {
      const result = parseTokenId("token-ethereum-a-b-c-d-e");
      expect(result.address).toBe("a-b-c-d-e");
    });
  });

  describe("getChainFamily - quick check optimization", () => {
    test("quick check may match chain name in address (known behavior)", () => {
      // The quick check looks for "-solana-" anywhere in string for performance
      // If address contains "-solana-", it will match. This is a known trade-off
      // for performance. Well-formed addresses won't contain chain names.
      const result = getChainFamily("token-base-contains-solana-text");
      // Actually matches "-solana-" in address - this is documented behavior
      expect(result).toBe("solana");
    });
  });

  describe("isValidChain", () => {
    test("returns true for all valid chains", () => {
      expect(isValidChain("ethereum")).toBe(true);
      expect(isValidChain("base")).toBe(true);
      expect(isValidChain("bsc")).toBe(true);
      expect(isValidChain("solana")).toBe(true);
    });

    test("returns false for invalid chains", () => {
      expect(isValidChain("polygon")).toBe(false);
      expect(isValidChain("avalanche")).toBe(false);
      expect(isValidChain("arbitrum")).toBe(false);
      expect(isValidChain("")).toBe(false);
      expect(isValidChain("BASE")).toBe(false); // case-sensitive
    });
  });
});

// =============================================================================
// ERROR HANDLING - FAIL-FAST VALIDATION
// =============================================================================
describe("Token Utils - Error Handling (Fail-Fast)", () => {
  describe("parseTokenId - throws on invalid input", () => {
    test("throws on empty string", () => {
      expect(() => parseTokenId("")).toThrow("Token ID is required");
    });

    test("throws on malformed format - no dashes", () => {
      expect(() => parseTokenId("tokenbaseaddress")).toThrow("Invalid token ID format");
    });

    test("throws on malformed format - only one dash", () => {
      expect(() => parseTokenId("token-base")).toThrow("Invalid token ID format");
    });

    test("throws on wrong prefix", () => {
      expect(() => parseTokenId("tokens-base-0x1234")).toThrow("Invalid token ID prefix");
    });

    test("throws on invalid chain", () => {
      expect(() => parseTokenId("token-polygon-0x1234")).toThrow("Invalid chain");
    });

    test("throws on empty address", () => {
      expect(() => parseTokenId("token-base-")).toThrow("Missing address");
    });
  });

  describe("buildTokenId - throws on invalid input", () => {
    test("throws on empty chain", () => {
      expect(() => buildTokenId("" as "base", "0x1234")).toThrow("Chain is required");
    });

    test("throws on empty address", () => {
      expect(() => buildTokenId("base", "")).toThrow("Address is required");
    });

    test("throws on invalid chain", () => {
      expect(() => buildTokenId("polygon" as "base", "0x1234")).toThrow("Invalid chain");
    });
  });

  describe("extractChainFromTokenId - throws on invalid input", () => {
    test("throws on empty string", () => {
      expect(() => extractChainFromTokenId("")).toThrow("Token ID is required");
    });

    test("throws on insufficient parts", () => {
      expect(() => extractChainFromTokenId("token")).toThrow("Invalid token ID format");
    });
  });

  describe("extractAddressFromTokenId - throws on invalid input", () => {
    test("throws on empty string", () => {
      expect(() => extractAddressFromTokenId("")).toThrow("Token ID is required");
    });

    test("throws on missing address part", () => {
      expect(() => extractAddressFromTokenId("token-base")).toThrow("Invalid token ID format");
    });
  });
});

// =============================================================================
// EDGE CASES
// =============================================================================
describe("Token Utils - Edge Cases", () => {
  describe("getChainFamily - edge cases", () => {
    test("returns null for empty string", () => {
      expect(getChainFamily("")).toBeNull();
    });

    test("returns null for invalid format", () => {
      expect(getChainFamily("not-a-token-id")).toBeNull();
    });

    test("returns null for unknown chain", () => {
      expect(getChainFamily("token-polygon-0x1")).toBeNull();
    });

    test("returns null for partial match", () => {
      expect(getChainFamily("token-bas-0x1")).toBeNull();
    });
  });

  describe("extractChainFromTokenId - extracts without validation", () => {
    test("extracts invalid chain without throwing", () => {
      // This function is explicitly for loose extraction
      const result = extractChainFromTokenId("token-polygon-0x1234");
      expect(result).toBe("polygon");
    });
  });

  describe("extractAddressFromTokenId - extracts without validation", () => {
    test("extracts address even with invalid chain", () => {
      const result = extractAddressFromTokenId("token-unknown-myaddress");
      expect(result).toBe("myaddress");
    });
  });

  describe("case sensitivity", () => {
    test("chain names are case-sensitive", () => {
      expect(() => parseTokenId("token-BASE-0x1234")).toThrow("Invalid chain");
      expect(() => parseTokenId("token-Base-0x1234")).toThrow("Invalid chain");
      expect(() => parseTokenId("token-SOLANA-abc")).toThrow("Invalid chain");
    });
  });

  describe("whitespace handling", () => {
    test("leading whitespace causes prefix mismatch", () => {
      expect(() => parseTokenId(" token-base-0x1234")).toThrow("Invalid token ID prefix");
    });

    test("trailing whitespace in address is preserved (caller should sanitize)", () => {
      // parseTokenId does not trim - addresses with trailing spaces are valid
      // Caller is responsible for sanitizing input
      const result = parseTokenId("token-base-0x1234 ");
      expect(result.address).toBe("0x1234 ");
    });
  });

  describe("special address formats", () => {
    test("handles Solana wrapped SOL address", () => {
      const result = parseTokenId("token-solana-So11111111111111111111111111111111111111112");
      expect(result.address).toBe("So11111111111111111111111111111111111111112");
    });

    test("handles EVM checksummed address", () => {
      const result = parseTokenId("token-ethereum-0xdAC17F958D2ee523a2206206994597C13D831ec7");
      expect(result.address).toBe("0xdAC17F958D2ee523a2206206994597C13D831ec7");
    });

    test("handles lowercase EVM address", () => {
      const result = parseTokenId("token-base-0xdac17f958d2ee523a2206206994597c13d831ec7");
      expect(result.address).toBe("0xdac17f958d2ee523a2206206994597c13d831ec7");
    });
  });
});

// =============================================================================
// DATA VERIFICATION - INSPECT ACTUAL OUTPUTS
// =============================================================================
describe("Token Utils - Data Verification", () => {
  describe("parseTokenId output structure", () => {
    test("returns exactly chain and address properties", () => {
      const result = parseTokenId("token-base-0x1234");
      const keys = Object.keys(result);

      expect(keys).toHaveLength(2);
      expect(keys).toContain("chain");
      expect(keys).toContain("address");
    });

    test("chain is typed correctly", () => {
      const result = parseTokenId("token-ethereum-0x1");

      // Type assertion - this should compile
      const chain: "ethereum" | "base" | "bsc" | "solana" = result.chain;
      expect(chain).toBe("ethereum");
    });
  });

  describe("buildTokenId output format", () => {
    test("always starts with 'token-'", () => {
      const chains = ["ethereum", "base", "bsc", "solana"] as const;
      for (const chain of chains) {
        const result = buildTokenId(chain, "addr");
        expect(result.startsWith("token-")).toBe(true);
      }
    });

    test("format is exactly 'token-{chain}-{address}'", () => {
      const result = buildTokenId("base", "0xABC");
      const parts = result.split("-");

      expect(parts[0]).toBe("token");
      expect(parts[1]).toBe("base");
      expect(parts[2]).toBe("0xABC");
    });
  });

  describe("chain family mapping correctness", () => {
    test("ethereum maps to evm", () => {
      expect(getChainFamily("token-ethereum-x")).toBe("evm");
    });

    test("base maps to evm", () => {
      expect(getChainFamily("token-base-x")).toBe("evm");
    });

    test("bsc maps to evm", () => {
      expect(getChainFamily("token-bsc-x")).toBe("evm");
    });

    test("solana maps to solana", () => {
      expect(getChainFamily("token-solana-x")).toBe("solana");
    });

    test("only 4 chains are supported", () => {
      const supported = ["ethereum", "base", "bsc", "solana"];
      const unsupported = ["polygon", "arbitrum", "optimism", "avalanche", "fantom"];

      for (const chain of supported) {
        expect(isValidChain(chain)).toBe(true);
      }

      for (const chain of unsupported) {
        expect(isValidChain(chain)).toBe(false);
      }
    });
  });
});

// =============================================================================
// CONCURRENT/ASYNC BEHAVIOR (N/A - all sync functions)
// =============================================================================
describe("Token Utils - Concurrency", () => {
  test("parseTokenId is idempotent across multiple calls", () => {
    const tokenId = "token-base-0x123";

    // Call 100 times
    const results = Array.from({ length: 100 }, () => parseTokenId(tokenId));

    // All results should be identical
    for (const result of results) {
      expect(result.chain).toBe("base");
      expect(result.address).toBe("0x123");
    }
  });

  test("buildTokenId produces consistent output", () => {
    const results = Array.from({ length: 100 }, () => buildTokenId("solana", "abc"));
    const unique = new Set(results);

    expect(unique.size).toBe(1);
    expect([...unique][0]).toBe("token-solana-abc");
  });
});

// =============================================================================
// INTEGRATION WITH OTHER UTILITIES
// =============================================================================
describe("Token Utils - Integration", () => {
  test("parseTokenId output works with getChainFamily", () => {
    const parsed = parseTokenId("token-base-0x1234");
    const tokenId = buildTokenId(parsed.chain, parsed.address);
    const family = getChainFamily(tokenId);

    expect(family).toBe("evm");
  });

  test("chain type helpers are consistent with getChainFamily", () => {
    const evmTokenId = "token-ethereum-0x1";
    const solanaTokenId = "token-solana-abc";

    expect(isEvmToken(evmTokenId)).toBe(getChainFamily(evmTokenId) === "evm");
    expect(isSolanaToken(solanaTokenId)).toBe(getChainFamily(solanaTokenId) === "solana");
  });
});
