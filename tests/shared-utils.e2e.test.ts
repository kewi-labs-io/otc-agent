/**
 * Shared Utilities E2E Tests
 *
 * Tests formatting utilities, deal transformations, and address validation.
 * Uses fail-fast patterns with strong typing.
 *
 * Run: bun test tests/shared-utils.e2e.test.ts
 */

import { describe, test, expect } from "bun:test";
import {
  formatDate,
  formatDateTime,
  formatTokenAmount,
  formatTokenAmountFull,
  formatUsd,
  formatPercentFromBps,
  formatPercent,
  getLockupLabel,
  formatAddress,
  formatTxHash,
  formatTimeRemaining,
  isMatured,
  formatNativeAmount,
} from "@/utils/format";
import {
  transformSolanaDeal,
  transformEvmDeal,
  sortOffersByDate,
  filterActiveOffers,
  type OfferWithMetadata,
} from "@/utils/deal-transforms";
import { isEvmAddress, isSolanaAddress, normalizeAddress } from "@/utils/address-utils";
import { expectDefined, expectEqual } from "./test-utils";

// ==========================================================================
// FORMAT UTILITIES
// ==========================================================================
describe("Format Utilities", () => {
  describe("formatDate", () => {
    test("formats timestamp to date string", () => {
      // Jan 1, 2024 00:00:00 UTC
      const ts = 1704067200;
      const result = formatDate(ts);
      expectDefined(result, "formatted date");
      expect(result).toContain("2024");
      expect(result).toContain("Jan");
    });

    test("handles bigint timestamps", () => {
      const ts = BigInt(1704067200);
      const result = formatDate(ts);
      expectDefined(result, "formatted date from bigint");
      expect(result).toContain("2024");
    });
  });

  describe("formatDateTime", () => {
    test("formats timestamp to date/time string", () => {
      const ts = 1704067200;
      const result = formatDateTime(ts);
      expectDefined(result, "formatted datetime");
      expect(result).toContain("2024");
      expect(result).toContain("Jan");
    });
  });

  describe("formatTokenAmount", () => {
    test("formats millions with M suffix", () => {
      expectEqual(formatTokenAmount(1500000), "1.50M", "1.5M");
      expectEqual(formatTokenAmount(2000000), "2.00M", "2M");
    });

    test("formats thousands with K suffix", () => {
      expectEqual(formatTokenAmount(1500), "1.50K", "1.5K");
      expect(formatTokenAmount(999)).not.toContain("K");
    });

    test("formats small amounts without suffix", () => {
      expectEqual(formatTokenAmount(500), "500", "500");
    });

    test("handles bigint", () => {
      expectEqual(formatTokenAmount(BigInt(1500000)), "1.50M", "bigint 1.5M");
    });
  });

  describe("formatTokenAmountFull", () => {
    test("formats with specified decimals", () => {
      const result = formatTokenAmountFull(1234.5678, 4);
      expect(result).toContain("1,234");
    });
  });

  describe("formatUsd", () => {
    test("formats USD with sign", () => {
      expectEqual(formatUsd(1234.56), "$1,234.56", "USD with sign");
    });

    test("formats USD without sign when requested", () => {
      expectEqual(formatUsd(1234.56, false), "1,234.56", "USD without sign");
    });
  });

  describe("formatPercentFromBps", () => {
    test("converts basis points to percent", () => {
      expectEqual(formatPercentFromBps(1000), "10%", "1000 bps");
      expectEqual(formatPercentFromBps(500), "5%", "500 bps");
    });

    test("handles bigint", () => {
      expectEqual(formatPercentFromBps(BigInt(1000)), "10%", "bigint 1000 bps");
    });
  });

  describe("formatPercent", () => {
    test("converts decimal to percent", () => {
      expectEqual(formatPercent(0.1), "10%", "0.1 to 10%");
      expectEqual(formatPercent(0.05), "5%", "0.05 to 5%");
    });
  });

  describe("getLockupLabel", () => {
    test("calculates months from timestamps", () => {
      const created = 1704067200; // Jan 1, 2024
      const unlock = created + 90 * 24 * 60 * 60; // ~3 months later
      const result = getLockupLabel(created, unlock);
      expectEqual(result, "3 months", "3 months lockup");
    });

    test("handles singular month", () => {
      const created = 1704067200;
      const unlock = created + 30 * 24 * 60 * 60; // ~1 month later
      const result = getLockupLabel(created, unlock);
      expectEqual(result, "1 month", "1 month lockup");
    });
  });

  describe("formatAddress", () => {
    test("truncates long addresses", () => {
      const addr = "0x1234567890abcdef1234567890abcdef12345678";
      const result = formatAddress(addr);
      expect(result).toContain("...");
      expect(result.length).toBeLessThan(addr.length);
    });

    test("returns short addresses unchanged", () => {
      const addr = "0x1234";
      expectEqual(formatAddress(addr), addr, "short address");
    });
  });

  describe("formatTxHash", () => {
    test("truncates transaction hashes", () => {
      const hash = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
      const result = formatTxHash(hash);
      expect(result).toContain("...");
    });
  });

  describe("formatTimeRemaining", () => {
    test("returns Ready for past timestamps", () => {
      const pastTs = Math.floor(Date.now() / 1000) - 1000;
      expectEqual(formatTimeRemaining(pastTs), "Ready", "past timestamp");
    });

    test("returns days for future timestamps", () => {
      const futureTs = Math.floor(Date.now() / 1000) + 5 * 86400;
      const result = formatTimeRemaining(futureTs);
      expect(result).toContain("day");
    });

    test("returns months for long periods", () => {
      const futureTs = Math.floor(Date.now() / 1000) + 90 * 86400;
      const result = formatTimeRemaining(futureTs);
      expect(result).toContain("month");
    });
  });

  describe("isMatured", () => {
    test("returns true for past timestamps", () => {
      const pastTs = Math.floor(Date.now() / 1000) - 1000;
      expect(isMatured(pastTs)).toBe(true);
    });

    test("returns false for future timestamps", () => {
      const futureTs = Math.floor(Date.now() / 1000) + 100000;
      expect(isMatured(futureTs)).toBe(false);
    });
  });

  describe("formatNativeAmount", () => {
    test("formats ETH with appropriate precision", () => {
      const result = formatNativeAmount(1.5, "ETH");
      expect(result).toContain("ETH");
      expect(result).toContain("1.5");
    });

    test("handles bigint (wei)", () => {
      // 1 ETH = 1e18 wei
      const result = formatNativeAmount(BigInt("1000000000000000000"), "ETH");
      expect(result).toContain("ETH");
    });
  });
});

// ==========================================================================
// DEAL TRANSFORMATION UTILITIES
// ==========================================================================
describe("Deal Transformation Utilities", () => {
  const mockSolanaDeal = {
    id: "deal-1",
    quoteId: "quote-123",
    consignmentId: "cons-1",
    tokenId: "token-solana-abc",
    buyerAddress: "BuyerPubKey111111111111111111111111111111111",
    tokenAmount: "1000",
    discountBps: 1500,
    lockupDays: 180,
    lockupMonths: undefined,
    createdAt: new Date("2024-01-15").toISOString(),
    offerId: "123",
    status: "executed" as const,
    beneficiary: "BeneficiaryPubKey11111111111111111111111111",
    payer: "PayerPubKey1111111111111111111111111111111111",
    priceUsdPerToken: 2.5,
    ethUsdPrice: undefined,
    paymentCurrency: "SOL",
    paymentAmount: "10",
    tokenSymbol: "TEST",
    tokenName: "Test Token",
    tokenLogoUrl: "https://example.com/logo.png",
    chain: "solana" as const,
  };

  const mockEvmDeal = {
    id: "deal-2",
    quoteId: "quote-456",
    consignmentId: "cons-2",
    tokenId: "token-base-xyz",
    buyerAddress: "0x1234567890abcdef1234567890abcdef12345678",
    tokenAmount: "5000",
    discountBps: 1000,
    lockupDays: 180, // Required field - 6 months in days
    lockupMonths: 6,
    createdAt: new Date("2024-02-01").toISOString(),
    offerId: "456",
    status: "executed" as const,
    beneficiary: "0xabcdef1234567890abcdef1234567890abcdef12",
    payer: "0x9876543210fedcba9876543210fedcba98765432",
    priceUsdPerToken: 1.25,
    ethUsdPrice: 3000,
    paymentCurrency: "ETH",
    paymentAmount: "1",
    tokenSymbol: "DEMO",
    tokenName: "Demo Token",
    tokenLogoUrl: "https://example.com/demo.png",
    chain: "base" as const,
  };

  describe("transformSolanaDeal", () => {
    test("transforms Solana deal to OfferWithMetadata", () => {
      const result = transformSolanaDeal(mockSolanaDeal, "WalletPubKey111111111111111111111111111111");

      expect(result.id).toBe(BigInt(123));
      expect(result.tokenAmount).toBe(BigInt(1000));
      expect(result.discountBps).toBe(BigInt(1500));
      expectEqual(result.quoteId, "quote-123", "quoteId");
      expectEqual(result.tokenSymbol, "TEST", "tokenSymbol");
      expectEqual(result.chain, "solana", "chain");
      expect(result.currency).toBe(0); // SOL = native = 0
    });

    test("throws when beneficiary is missing (fail-fast)", () => {
      const dealWithoutBeneficiary = { ...mockSolanaDeal, beneficiary: "" };

      expect(() => transformSolanaDeal(dealWithoutBeneficiary)).toThrow(
        "missing beneficiary"
      );
    });
  });

  describe("transformEvmDeal", () => {
    test("transforms EVM deal to OfferWithMetadata", () => {
      const result = transformEvmDeal(mockEvmDeal);

      expect(result.id).toBe(BigInt(456));
      expect(result.tokenAmount).toBe(BigInt(5000));
      expect(result.discountBps).toBe(BigInt(1000));
      expectEqual(result.quoteId, "quote-456", "quoteId");
      expectEqual(result.tokenSymbol, "DEMO", "tokenSymbol");
      expectEqual(result.chain, "base", "chain");
      expect(result.ethUsdPrice).toBe(BigInt(300000000000)); // 3000 * 1e8
    });
  });

  describe("sortOffersByDate", () => {
    test("sorts offers by creation date descending", () => {
      const offers: OfferWithMetadata[] = [
        createMockOffer({ id: 1n, createdAt: 1000n }),
        createMockOffer({ id: 2n, createdAt: 3000n }),
      ];

      const sorted = sortOffersByDate(offers);
      expect(Number(sorted[0].createdAt)).toBe(3000);
      expect(Number(sorted[1].createdAt)).toBe(1000);
    });
  });

  describe("filterActiveOffers", () => {
    test("filters out cancelled offers", () => {
      const offers: OfferWithMetadata[] = [
        createMockOffer({ id: 1n, cancelled: true }),
        createMockOffer({ id: 2n, cancelled: false }),
      ];

      const filtered = filterActiveOffers(offers);
      expect(filtered.length).toBe(1);
      expect(Number(filtered[0].id)).toBe(2);
    });

    test("filters out fulfilled offers", () => {
      const offers: OfferWithMetadata[] = [createMockOffer({ id: 1n, fulfilled: true })];

      const filtered = filterActiveOffers(offers);
      expect(filtered.length).toBe(0);
    });
  });
});

// ==========================================================================
// ADDRESS VALIDATION UTILITIES
// ==========================================================================
describe("Address Utilities", () => {
  describe("isEvmAddress", () => {
    test("validates correct EVM addresses", () => {
      expect(isEvmAddress("0x1234567890abcdef1234567890abcdef12345678")).toBe(true);
      expect(isEvmAddress("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045")).toBe(true);
    });

    test("rejects invalid EVM addresses", () => {
      expect(isEvmAddress("not-an-address")).toBe(false);
      expect(isEvmAddress("0x123")).toBe(false); // too short
      expect(isEvmAddress("1234567890abcdef1234567890abcdef12345678")).toBe(false); // missing 0x
    });
  });

  describe("isSolanaAddress", () => {
    test("validates correct Solana addresses", () => {
      expect(isSolanaAddress("So11111111111111111111111111111111111111112")).toBe(true);
      expect(isSolanaAddress("E6K5x45Bxfmci6FmKRQ2YJMpLz7fCdLm7r7ReCq6P5vP")).toBe(true);
    });

    test("rejects invalid Solana addresses", () => {
      expect(isSolanaAddress("not-an-address")).toBe(false);
      expect(isSolanaAddress("0x1234567890abcdef1234567890abcdef12345678")).toBe(false); // EVM format
      expect(isSolanaAddress("abc")).toBe(false); // too short
    });
  });

  describe("normalizeAddress", () => {
    test("normalizes EVM addresses to lowercase", () => {
      expectEqual(
        normalizeAddress("0xD8DA6BF26964AF9D7EED9E03E53415D37AA96045"),
        "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
        "lowercase EVM",
      );
    });

    test("preserves Solana addresses (case-sensitive)", () => {
      const solanaAddr = "So11111111111111111111111111111111111111112";
      expectEqual(normalizeAddress(solanaAddr), solanaAddr, "preserve Solana");
    });

    test("trims whitespace", () => {
      expectEqual(
        normalizeAddress("  0xd8da6bf26964af9d7eed9e03e53415d37aa96045  "),
        "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
        "trim whitespace",
      );
    });
  });
});

// ==========================================================================
// HELPER FUNCTIONS
// ==========================================================================

function createMockOffer(overrides: Partial<OfferWithMetadata>): OfferWithMetadata {
  return {
    id: BigInt(1),
    beneficiary: "0x1",
    tokenAmount: BigInt(100),
    discountBps: BigInt(500),
    createdAt: BigInt(1000),
    unlockTime: BigInt(2000),
    priceUsdPerToken: BigInt(0),
    ethUsdPrice: BigInt(0),
    currency: 0,
    approved: true,
    paid: true,
    fulfilled: false,
    cancelled: false,
    payer: "0x1",
    amountPaid: BigInt(0),
    ...overrides,
  };
}
