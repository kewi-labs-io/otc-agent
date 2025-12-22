import { Configuration, NeynarAPIClient } from "@neynar/nodejs-sdk";
import { type NextRequest, NextResponse } from "next/server";
import { parseOrThrow } from "@/lib/validation/helpers";
import {
  NotificationResponseSchema,
  SendNotificationRequestSchema,
} from "@/types/validation/api-schemas";

let neynarClient: NeynarAPIClient | null = null;

async function getNeynarClient(): Promise<NeynarAPIClient> {
  if (!neynarClient) {
    const apiKey = process.env.NEYNAR_API_KEY;
    if (!apiKey) throw new Error("NEYNAR_API_KEY not configured");

    const config = new Configuration({ apiKey });
    neynarClient = new NeynarAPIClient(config);
  }
  return neynarClient;
}

export async function POST(request: NextRequest) {
  const rawBody = await request.json();
  const { fid, title, body } = parseOrThrow(SendNotificationRequestSchema, rawBody);

  // Dev mode simulation when API key is not configured
  if (!process.env.NEYNAR_API_KEY) {
    console.log("[Dev] Simulating notification:", { fid, title, body });
    return NextResponse.json({ state: "success", simulated: true });
  }

  const client = await getNeynarClient();

  // Use publishFrameNotifications API
  // See: https://docs.neynar.com/reference/publish-frame-notifications
  const result = await client.publishFrameNotifications({
    targetFids: [Number(fid)],
    notification: {
      title,
      body,
      target_url: process.env.NEXT_PUBLIC_APP_URL || "https://otc.party",
    },
  });

  const notificationResponse = {
    state: "success",
    deliveries: result.notification_deliveries,
  };
  const validatedNotification = NotificationResponseSchema.parse(notificationResponse);
  return NextResponse.json(validatedNotification);
}
