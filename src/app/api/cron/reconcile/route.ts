import { NextRequest, NextResponse } from "next/server";
import { runReconciliationTask } from "@/services/reconciliation";

/**
 * Automated Reconciliation Cron Job
 *
 * Runs every 5 minutes to sync database state with blockchain state
 *
 * Set up in vercel.json or external cron service:
 * - Vercel: Add to vercel.json crons array
 * - AWS: Use EventBridge rule
 * - External: Use cron-job.org or similar
 */

const CRON_SECRET =
  process.env.CRON_SECRET || process.env.RECONCILIATION_SECRET;

export async function GET(request: NextRequest) {
  // Verify authorization
  const authHeader = request.headers.get("authorization");

  // Always require auth in production
  if (process.env.NODE_ENV === "production" && !CRON_SECRET) {
    console.error(
      "[Reconciliation Cron] No CRON_SECRET configured in production",
    );
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 },
    );
  }

  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    console.warn("[Reconciliation Cron] Unauthorized access attempt", {
      ip:
        request.headers.get("x-forwarded-for") ||
        request.headers.get("x-real-ip"),
      timestamp: new Date().toISOString(),
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    console.log("[Reconciliation Cron] Starting reconciliation task...");

    const startTime = Date.now();
    await runReconciliationTask();
    const duration = Date.now() - startTime;

    console.log(`[Reconciliation Cron] Completed in ${duration}ms`);

    return NextResponse.json({
      success: true,
      action: "reconcile_all",
      duration,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[Reconciliation Cron] Error:", error);

    // Still return 200 to prevent cron service from retrying immediately
    // Log the error for monitoring systems to catch
    return NextResponse.json({
      success: false,
      error: "Reconciliation task failed",
      details: error instanceof Error ? error.message : "Unknown error",
      timestamp: new Date().toISOString(),
    });
  }
}

// Support POST for some cron services
export async function POST(request: NextRequest) {
  return GET(request);
}
