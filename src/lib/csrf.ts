import { type NextRequest, NextResponse } from "next/server";

/**
 * Validates CSRF by checking Origin/Referer headers against allowed origins.
 * Returns null if valid, or a NextResponse error if invalid.
 */
export function validateCSRF(request: NextRequest): NextResponse | null {
  // Skip CSRF for GET/HEAD/OPTIONS
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    return null;
  }

  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");

  // Must have at least one
  if (!origin && !referer) {
    return NextResponse.json({ error: "Missing origin header" }, { status: 403 });
  }

  // Get allowed origins from environment
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL;
  
  // Build list of allowed origins
  // Include localhost, VERCEL_URL, and custom domains
  const allowedOrigins = [
    // Local development
    "http://localhost:4444",
    "http://127.0.0.1:4444",
    // Vercel preview URLs
    appUrl ? `https://${appUrl}` : null,
    appUrl,
    // Production custom domains
    "https://tradingdesk.fun",
    "https://www.tradingdesk.fun",
    "https://otc-agent.vercel.app",
    // Additional custom origins from environment
    ...(process.env.ALLOWED_ORIGINS?.split(",").map((o) => o.trim()) || []),
  ].filter(Boolean) as string[];

  // Check origin
  if (origin && !allowedOrigins.some((allowed) => origin.startsWith(allowed))) {
    console.warn(`[CSRF] Rejected request from origin: ${origin}`);
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }

  // Check referer if no origin
  if (!origin && referer) {
    const refererOrigin = new URL(referer).origin;
    if (!allowedOrigins.some((allowed) => refererOrigin.startsWith(allowed))) {
      console.warn(`[CSRF] Rejected request from referer: ${referer}`);
      return NextResponse.json({ error: "Invalid referer" }, { status: 403 });
    }
  }

  return null; // Valid
}
