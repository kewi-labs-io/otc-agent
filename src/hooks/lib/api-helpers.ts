/**
 * Shared API helpers for React Query hooks
 *
 * Consolidates common patterns for error handling and response parsing
 */

/**
 * Extract error message from API response
 * Handles various error response formats consistently
 */
export function extractErrorMessage(
  errorData: Record<string, unknown>,
  fallback: string,
): string {
  if (typeof errorData.error === "string" && errorData.error.trim() !== "") {
    return errorData.error;
  }
  if (
    typeof errorData.message === "string" &&
    errorData.message.trim() !== ""
  ) {
    return errorData.message;
  }
  return fallback;
}

/**
 * Parse API error response and throw with message
 */
export async function throwApiError(
  response: Response,
  fallbackMessage: string,
): Promise<never> {
  const errorData = await response.json().catch(() => ({}));
  throw new Error(extractErrorMessage(errorData, fallbackMessage));
}
