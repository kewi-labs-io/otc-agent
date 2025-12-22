/**
 * Next.js Instrumentation - runs once on server startup
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // Only validate on server-side
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateProductionSecrets, logEnvironmentConfig, isProduction } = await import(
      "@/config/env"
    );

    // Log environment configuration (no secrets)
    logEnvironmentConfig();

    // Validate required secrets in production
    if (isProduction()) {
      const { valid, missing } = validateProductionSecrets();
      if (!valid) {
        console.error("[STARTUP] CRITICAL: Missing required secrets:", missing.join(", "));
        // In production, fail fast - don't start with missing secrets
        throw new Error(`Missing required production secrets: ${missing.join(", ")}`);
      }
      console.log("[STARTUP] All required production secrets validated");
    }
  }
}
