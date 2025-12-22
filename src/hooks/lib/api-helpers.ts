/**
 * Shared API helpers for React Query hooks
 *
 * Consolidates common patterns for error handling and response parsing
 */

/**
 * Extract error message from API response
 * Handles various error response formats consistently
 */
export function extractErrorMessage(errorData: Record<string, unknown>, fallback: string): string {
  if (typeof errorData.error === "string" && errorData.error.trim() !== "") {
    return errorData.error;
  }
  if (typeof errorData.message === "string" && errorData.message.trim() !== "") {
    return errorData.message;
  }
  return fallback;
}

/**
 * Parse API error response and throw with message
 * Always throws - the error is extracted from JSON body if possible,
 * otherwise uses fallbackMessage
 */
export async function throwApiError(response: Response, fallbackMessage: string): Promise<never> {
  // If JSON parsing fails (empty body, malformed), fall back to empty object
  // The error will still be thrown with fallbackMessage
  const errorData = await response.json().catch(() => ({}));
  // Handle null/undefined responses by treating them as empty objects
  const safeErrorData = errorData && typeof errorData === "object" ? errorData : {};
  throw new Error(extractErrorMessage(safeErrorData as Record<string, unknown>, fallbackMessage));
}
