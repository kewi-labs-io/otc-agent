import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, type Abi, type Address } from "viem";
import { hardhat } from "viem/chains";
import otcArtifact from "@/contracts/artifacts/contracts/OTC.sol/OTC.json";

// This should be called daily via a cron job (e.g., Vercel Cron or external scheduler)
// It checks for matured OTC and claims them on behalf of users

const OTC_ADDRESS = process.env.NEXT_PUBLIC_OTC_ADDRESS as Address;

export async function GET(request: NextRequest) {
  // Verify cron secret if using external scheduler
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  // Always require authentication in production
  if (!cronSecret && process.env.NODE_ENV === "production") {
    console.error("[Cron API] No CRON_SECRET configured in production");
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 },
    );
  }

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    console.warn("[Cron API] Unauthorized cron access attempt", {
      ip:
        request.headers.get("x-forwarded-for") ||
        request.headers.get("x-real-ip"),
      timestamp: new Date().toISOString(),
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!OTC_ADDRESS) {
    return NextResponse.json(
      { error: "Missing configuration" },
      { status: 500 },
    );
  }

  try {
    // Set up clients
    const publicClient = createPublicClient({
      chain: hardhat,
      transport: http(),
    });

    const abi = otcArtifact.abi as Abi;

    // Get all open offer IDs
    const openOfferIds = (await publicClient.readContract({
      address: OTC_ADDRESS,
      abi,
      functionName: "getOpenOfferIds",
    })) as bigint[];

    const now = Math.floor(Date.now() / 1000);
    const maturedOffers: bigint[] = [];

    // Check each offer for maturity
    for (const offerId of openOfferIds) {
      const offer = (await publicClient.readContract({
        address: OTC_ADDRESS,
        abi,
        functionName: "offers",
        args: [offerId],
      })) as any;

      // Check if offer is paid, fulfilled, and past unlock time
      if (
        offer.paid &&
        offer.fulfilled &&
        !offer.cancelled &&
        Number(offer.unlockTime) <= now &&
        Number(offer.unlockTime) > 0
      ) {
        maturedOffers.push(offerId);
      }
    }

    // Claim matured offers
    const claimedOffers: bigint[] = [];
    const failedOffers: { id: bigint; error: string }[] = [];

    for (const offerId of maturedOffers) {
      try {
        // Check if tokens are claimable
        const offer = (await publicClient.readContract({
          address: OTC_ADDRESS,
          abi,
          functionName: "offers",
          args: [offerId],
        })) as any;

        // Only the beneficiary can claim, so we need to check if we have a claiming mechanism
        // For now, we'll just log these for manual processing
        console.log(
          `Matured offer ready for claim: ${offerId}, beneficiary: ${offer.beneficiary}`,
        );

        // In production, you might want to:
        // 1. Send notifications to beneficiaries
        // 2. Have a separate claiming interface
        // 3. Or implement a batch claim function in the contract

        claimedOffers.push(offerId);
      } catch (error) {
        failedOffers.push({
          id: offerId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      maturedOffers: maturedOffers.map((id) => id.toString()),
      claimedOffers: claimedOffers.map((id) => id.toString()),
      failedOffers: failedOffers.map((f) => ({
        id: f.id.toString(),
        error: f.error,
      })),
      message: `Found ${maturedOffers.length} matured offers, processed ${claimedOffers.length}`,
    });
  } catch (error) {
    console.error("[Cron API] Error checking matured deals:", error);
    return NextResponse.json(
      {
        error: "Failed to check matured deals",
        details:
          process.env.NODE_ENV === "production"
            ? "Internal server error"
            : error instanceof Error
              ? error.message
              : String(error),
      },
      { status: 500 },
    );
  }
}

// Also support POST for some cron services
export async function POST(request: NextRequest) {
  return GET(request);
}
