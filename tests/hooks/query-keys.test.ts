/**
 * Query Keys Unit Tests
 *
 * Tests for the centralized query key factory functions.
 * Verifies key structure, uniqueness, and consistency.
 *
 * Run: bun test tests/hooks/query-keys.test.ts
 */

import { describe, expect, test } from "bun:test";
import {
  chatKeys,
  consignmentKeys,
  dealKeys,
  poolKeys,
  priceKeys,
  quoteKeys,
  tokenKeys,
  walletTokenKeys,
} from "@/hooks/queryKeys";

describe("queryKeys", () => {
  describe("tokenKeys", () => {
    test("all returns base key", () => {
      expect(tokenKeys.all).toEqual(["tokens"]);
    });

    test("lists extends all with list scope", () => {
      const key = tokenKeys.lists();
      expect(key).toEqual(["tokens", "list"]);
    });

    test("batches extends all with batch scope", () => {
      const key = tokenKeys.batches();
      expect(key).toEqual(["tokens", "batch"]);
    });

    test("batch creates unique key for token IDs", () => {
      const key1 = tokenKeys.batch(["token-a", "token-b"]);
      const key2 = tokenKeys.batch(["token-b", "token-a"]);

      // Keys should be equal regardless of order (sorted)
      expect(key1).toEqual(key2);
      expect(key1).toEqual(["tokens", "batch", "token-a,token-b"]);
    });

    test("single creates unique key per token ID", () => {
      const key = tokenKeys.single("token-base-0x123");
      expect(key).toEqual(["tokens", "single", "token-base-0x123"]);
    });

    test("marketData creates unique key per token ID", () => {
      const key = tokenKeys.marketData("token-base-0x123");
      expect(key).toEqual(["tokens", "marketData", "token-base-0x123"]);
    });

    test("lookup creates unique key per address and chain", () => {
      const key = tokenKeys.lookup("0x123", "base");
      expect(key).toEqual(["tokens", "lookup", "base", "0x123"]);
    });

    test("decimals creates unique key per address and chain", () => {
      const key = tokenKeys.decimals("0x123", "ethereum");
      expect(key).toEqual(["tokens", "decimals", "ethereum", "0x123"]);
    });

    test("keys are distinct for different operations", () => {
      const singleKey = tokenKeys.single("token-base-0x123");
      const marketKey = tokenKeys.marketData("token-base-0x123");
      const lookupKey = tokenKeys.lookup("0x123", "base");

      expect(singleKey).not.toEqual(marketKey);
      expect(singleKey).not.toEqual(lookupKey);
      expect(marketKey).not.toEqual(lookupKey);
    });
  });

  describe("consignmentKeys", () => {
    test("all returns base key", () => {
      expect(consignmentKeys.all).toEqual(["consignments"]);
    });

    test("lists extends all with list scope", () => {
      const key = consignmentKeys.lists();
      expect(key).toEqual(["consignments", "list"]);
    });

    test("list creates key with filters", () => {
      const key = consignmentKeys.list({ chain: "base", status: "active" });
      expect(key).toEqual(["consignments", "list", { chain: "base", status: "active" }]);
    });

    test("single creates unique key per ID", () => {
      const key = consignmentKeys.single("uuid-123");
      expect(key).toEqual(["consignments", "single", "uuid-123"]);
    });

    test("byConsigner creates filter key", () => {
      const key = consignmentKeys.byConsigner("0xabc");
      expect(key).toEqual(["consignments", "list", { consigner: "0xabc" }]);
    });

    test("byToken creates filter key", () => {
      const key = consignmentKeys.byToken("token-base-0x123");
      expect(key).toEqual(["consignments", "list", { tokenId: "token-base-0x123" }]);
    });
  });

  describe("dealKeys", () => {
    test("all returns base key", () => {
      expect(dealKeys.all).toEqual(["deals"]);
    });

    test("lists extends all with list scope", () => {
      const key = dealKeys.lists();
      expect(key).toEqual(["deals", "list"]);
    });

    test("byWallet creates unique key per wallet", () => {
      const key = dealKeys.byWallet("0xabc123");
      expect(key).toEqual(["deals", "list", "0xabc123"]);
    });
  });

  describe("quoteKeys", () => {
    test("all returns base key", () => {
      expect(quoteKeys.all).toEqual(["quotes"]);
    });

    test("executed creates unique key per quote ID", () => {
      const key = quoteKeys.executed("quote-uuid-123");
      expect(key).toEqual(["quotes", "executed", "quote-uuid-123"]);
    });

    test("byOffer creates unique key per offer ID", () => {
      const key = quoteKeys.byOffer("offer-456");
      expect(key).toEqual(["quotes", "byOffer", "offer-456"]);
    });

    test("latest creates unique key per quote ID", () => {
      const key = quoteKeys.latest("quote-uuid-789");
      expect(key).toEqual(["quotes", "latest", "quote-uuid-789"]);
    });
  });

  describe("poolKeys", () => {
    test("all returns base key", () => {
      expect(poolKeys.all).toEqual(["pools"]);
    });

    test("check creates unique key per address and chain", () => {
      const key = poolKeys.check("0x123", "base");
      expect(key).toEqual(["pools", "check", "base", "0x123"]);
    });

    test("different chains produce different keys", () => {
      const baseKey = poolKeys.check("0x123", "base");
      const ethKey = poolKeys.check("0x123", "ethereum");

      expect(baseKey).not.toEqual(ethKey);
    });
  });

  describe("walletTokenKeys", () => {
    test("all returns base key", () => {
      expect(walletTokenKeys.all).toEqual(["walletTokens"]);
    });

    test("byChain creates key for chain", () => {
      const key = walletTokenKeys.byChain("solana");
      expect(key).toEqual(["walletTokens", "solana"]);
    });

    test("byWallet creates key for wallet and chain", () => {
      const key = walletTokenKeys.byWallet("0xabc", "base");
      expect(key).toEqual(["walletTokens", "base", "0xabc"]);
    });
  });

  describe("priceKeys", () => {
    test("all returns base key", () => {
      expect(priceKeys.all).toEqual(["prices"]);
    });

    test("native creates key for native prices", () => {
      const key = priceKeys.native();
      expect(key).toEqual(["prices", "native"]);
    });

    test("token creates key per token ID", () => {
      const key = priceKeys.token("token-base-0x123");
      expect(key).toEqual(["prices", "token", "token-base-0x123"]);
    });

    test("tokenByMint creates key per mint address", () => {
      const key = priceKeys.tokenByMint("So11111111111111111111111111111111111111112");
      expect(key).toEqual(["prices", "tokenByMint", "So11111111111111111111111111111111111111112"]);
    });
  });

  describe("chatKeys", () => {
    test("all returns base key", () => {
      expect(chatKeys.all).toEqual(["chat"]);
    });

    test("rooms creates key for rooms list", () => {
      const key = chatKeys.rooms();
      expect(key).toEqual(["chat", "rooms"]);
    });

    test("room creates key per room ID", () => {
      const key = chatKeys.room("room-123");
      expect(key).toEqual(["chat", "room", "room-123"]);
    });

    test("messages creates key per room ID", () => {
      const key = chatKeys.messages("room-123");
      expect(key).toEqual(["chat", "messages", "room-123"]);
    });

    test("messagesAfter creates key with timestamp", () => {
      const key = chatKeys.messagesAfter("room-123", 1234567890);
      expect(key).toEqual(["chat", "messages", "room-123", "after", 1234567890]);
    });
  });

  describe("Key Isolation", () => {
    test("different domains have distinct root keys", () => {
      const roots = [
        tokenKeys.all,
        consignmentKeys.all,
        dealKeys.all,
        quoteKeys.all,
        poolKeys.all,
        walletTokenKeys.all,
        priceKeys.all,
        chatKeys.all,
      ];

      const uniqueRoots = new Set(roots.map((r) => JSON.stringify(r)));
      expect(uniqueRoots.size).toBe(roots.length);
    });

    test("nested keys share parent prefix", () => {
      const singleKey = tokenKeys.single("test");
      const allKey = tokenKeys.all;

      expect(singleKey[0]).toBe(allKey[0]);
    });
  });
});
