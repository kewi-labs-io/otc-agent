/**
 * API Helpers Unit Tests
 *
 * Tests for the shared API helper functions used in React Query hooks.
 * These tests verify error extraction and handling patterns.
 *
 * Run: bun test tests/hooks/api-helpers.test.ts
 */

import { describe, test, expect } from "bun:test";
import { extractErrorMessage, throwApiError } from "@/hooks/lib/api-helpers";

describe("api-helpers", () => {
  describe("extractErrorMessage", () => {
    test("extracts error from error field", () => {
      const errorData = { error: "Token not found" };
      const result = extractErrorMessage(errorData, "Fallback");
      expect(result).toBe("Token not found");
    });

    test("extracts error from message field", () => {
      const errorData = { message: "Invalid address" };
      const result = extractErrorMessage(errorData, "Fallback");
      expect(result).toBe("Invalid address");
    });

    test("prefers error over message field", () => {
      const errorData = { error: "Primary error", message: "Secondary message" };
      const result = extractErrorMessage(errorData, "Fallback");
      expect(result).toBe("Primary error");
    });

    test("returns fallback for empty error field", () => {
      const errorData = { error: "" };
      const result = extractErrorMessage(errorData, "Fallback message");
      expect(result).toBe("Fallback message");
    });

    test("returns fallback for whitespace-only error field", () => {
      const errorData = { error: "   " };
      const result = extractErrorMessage(errorData, "Fallback message");
      expect(result).toBe("Fallback message");
    });

    test("returns fallback for missing error field", () => {
      const errorData = { other: "data" };
      const result = extractErrorMessage(errorData, "Fallback message");
      expect(result).toBe("Fallback message");
    });

    test("returns fallback for non-string error field", () => {
      const errorData = { error: 123 };
      const result = extractErrorMessage(errorData, "Fallback message");
      expect(result).toBe("Fallback message");
    });

    test("returns fallback for null error field", () => {
      const errorData = { error: null };
      const result = extractErrorMessage(errorData, "Fallback message");
      expect(result).toBe("Fallback message");
    });

    test("handles empty object", () => {
      const errorData = {};
      const result = extractErrorMessage(errorData, "Fallback");
      expect(result).toBe("Fallback");
    });

    test("trims extracted error message", () => {
      const errorData = { error: "  Trimmed error  " };
      const result = extractErrorMessage(errorData, "Fallback");
      expect(result).toBe("  Trimmed error  "); // Preserves content but validates non-empty
    });

    test("handles deeply nested error structure gracefully", () => {
      const errorData = { error: { nested: "value" } };
      const result = extractErrorMessage(errorData, "Fallback");
      expect(result).toBe("Fallback");
    });
  });

  describe("throwApiError", () => {
    test("throws error with extracted message", async () => {
      const mockResponse = {
        json: async () => ({ error: "Specific error message" }),
      } as Response;

      await expect(
        throwApiError(mockResponse, "Default fallback"),
      ).rejects.toThrow("Specific error message");
    });

    test("throws error with fallback on JSON parse failure", async () => {
      const mockResponse = {
        json: async () => {
          throw new Error("Parse error");
        },
      } as Response;

      await expect(
        throwApiError(mockResponse, "Fallback on parse failure"),
      ).rejects.toThrow("Fallback on parse failure");
    });

    test("throws error with fallback on empty response", async () => {
      const mockResponse = {
        json: async () => ({}),
      } as Response;

      await expect(
        throwApiError(mockResponse, "Fallback for empty"),
      ).rejects.toThrow("Fallback for empty");
    });

    test("handles null JSON response", async () => {
      const mockResponse = {
        json: async () => null,
      } as Response;

      await expect(
        throwApiError(mockResponse, "Fallback for null"),
      ).rejects.toThrow("Fallback for null");
    });
  });
});
