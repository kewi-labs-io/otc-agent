/**
 * Validation helper functions
 * Provides convenient wrappers around Zod for common validation patterns
 */

import { NextResponse } from "next/server";
import { z } from "zod";

/**
 * Parse data with a Zod schema, throwing an error if validation fails
 * Use this for fail-fast validation at boundaries (I/O, HTTP, RPC)
 */
export function parseOrThrow<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const errorMessage = result.error.issues
      .map((e) => `${e.path.join(".")}: ${e.message}`)
      .join("; ");
    throw new Error(`Validation failed: ${errorMessage}`);
  }
  return result.data;
}

/**
 * Parse data with a Zod schema, returning null if validation fails
 *
 * NOTE: This is defensive programming - prefer parseOrThrow for fail-fast validation.
 * Only use this when invalid data is truly acceptable (e.g., optional user input).
 * For API boundaries and required data, use parseOrThrow instead.
 */
export function parseOrNull<T>(schema: z.ZodSchema<T>, data: unknown): T | null {
  const result = schema.safeParse(data);
  if (!result.success) {
    return null;
  }
  return result.data;
}

/**
 * Validate and transform data
 * Useful when you need to transform validated data
 */
export function validateAndTransform<T, U>(
  schema: z.ZodSchema<T>,
  transform: (data: T) => U,
  data: unknown,
): U {
  const parsed = parseOrThrow(schema, data);
  return transform(parsed);
}

/**
 * Create a NextResponse error for validation failures
 * Returns detailed error information in development, simplified in production
 */
export function validationErrorResponse(error: z.ZodError, status: number = 400): NextResponse {
  const isDev = process.env.NODE_ENV === "development";

  if (isDev) {
    // Detailed error in development
    return NextResponse.json(
      {
        error: "Validation failed",
        details: error.issues.map((e) => ({
          path: e.path.join("."),
          message: e.message,
          code: e.code,
        })),
      },
      { status },
    );
  }

  // Simplified error in production
  const firstError = error.issues[0];
  if (!firstError) {
    return NextResponse.json(
      {
        error: "Validation failed: Invalid data",
      },
      { status },
    );
  }
  return NextResponse.json(
    {
      error: `Validation failed: ${firstError.path.join(".")} - ${firstError.message}`,
    },
    { status },
  );
}

/**
 * Wrap an async handler function with automatic validation error handling
 * Catches ZodErrors and returns appropriate error responses
 */
export function withValidation<T extends unknown[]>(
  handler: (...args: T) => Promise<NextResponse>,
) {
  return async (...args: T): Promise<NextResponse> => {
    try {
      return await handler(...args);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return validationErrorResponse(error);
      }
      // Re-throw non-validation errors
      throw error;
    }
  };
}

/**
 * Validate query parameters from URLSearchParams
 * Converts URLSearchParams to an object and validates it
 */
export function validateQueryParams<T>(schema: z.ZodSchema<T>, searchParams: URLSearchParams): T {
  const params: Record<string, string | string[]> = {};
  for (const [key, value] of searchParams.entries()) {
    if (params[key]) {
      // Multiple values - convert to array
      const existing = params[key];
      params[key] = Array.isArray(existing) ? [...existing, value] : [existing as string, value];
    } else {
      params[key] = value;
    }
  }
  return parseOrThrow(schema, params);
}

/**
 * Validate route parameters (from Next.js dynamic routes)
 */
export function validateRouteParams<T>(
  schema: z.ZodSchema<T>,
  params: Record<string, string | string[] | undefined>,
): T {
  return parseOrThrow(schema, params);
}
