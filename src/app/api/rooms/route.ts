import { ChannelType, type Memory, stringToUuid, type UUID } from "@elizaos/core";
import { type NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { agentRuntime } from "@/lib/agent-runtime";
import { walletToEntityId } from "@/lib/entityId";
import { parseOrThrow } from "@/lib/validation/helpers";
import { CreateRoomRequestSchema, RoomsResponseSchema } from "@/types/validation/api-schemas";

// GET /api/rooms - Get user's rooms
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const entityId = searchParams.get("entityId");

  if (!entityId) {
    return NextResponse.json({ error: "entityId is required" }, { status: 400 });
  }

  const runtime = await agentRuntime.getRuntime();
  const roomIds = await runtime.getRoomsForParticipants([stringToUuid(entityId)]);

  // Get room details
  const rooms = await Promise.all(
    roomIds.map(async (roomId) => {
      const room = await runtime.getRoom(roomId);
      return {
        id: roomId,
        ...room,
      };
    }),
  );

  const response = {
    success: true as const,
    rooms,
  };
  const validatedResponse = RoomsResponseSchema.parse(response);
  return NextResponse.json(validatedResponse);
}

// POST /api/rooms - Create new room
export async function POST(request: NextRequest) {
  console.log("[Rooms API] POST request received");
  const body = await request.json();
  const data = parseOrThrow(CreateRoomRequestSchema, body);

  const { entityId } = data;
  console.log("[Rooms API] entityId:", entityId);

  const runtime = await agentRuntime.getRuntime();
  const roomIdStr = uuidv4();
  const roomId = stringToUuid(roomIdStr);
  const worldId = stringToUuid("otc-desk-world");

  // Ensure room exists
  await runtime.ensureRoomExists({
    id: roomId,
    source: "web",
    type: ChannelType.DM,
    channelId: roomIdStr,
    worldId: worldId,
    agentId: runtime.agentId,
  });

  console.log("[Rooms API] Created room:", roomIdStr, "for entity:", entityId);

  // Create initial welcome message with default quote
  console.log("[Rooms API] Creating initial welcome message for wallet:", entityId);

  // FAIL-FAST: entityId is validated by Zod schema, but TypeScript needs assertion
  const validatedEntityId = entityId as string;

  // Ensure entity exists in database to prevent foreign key errors
  const userEntityId = stringToUuid(walletToEntityId(validatedEntityId));
  await runtime.ensureConnection({
    entityId: userEntityId,
    roomId: roomId,
    userName: validatedEntityId,
    name: validatedEntityId,
    source: "web",
    channelId: roomIdStr,
    type: ChannelType.DM,
    worldId: worldId,
  });

  // Save initial quote to cache with consistent ID generation
  const crypto = await import("node:crypto");
  const dayTimestamp = Math.floor(Date.now() / (24 * 60 * 60 * 1000));
  const hash = crypto
    .createHash("sha256")
    .update(`${userEntityId}-${dayTimestamp}`)
    .digest("hex")
    .substring(0, 12)
    .toUpperCase();
  const initialQuoteId = `OTC-${hash}`;

  // Worst possible deal for buyer (lowest discount, longest lockup)
  // Buyers can negotiate better terms from this starting point
  const DEFAULT_MIN_DISCOUNT_BPS = 100; // 1% - lowest discount
  const DEFAULT_MAX_LOCKUP_MONTHS = 12; // 12 months - longest lockup
  const DEFAULT_MAX_LOCKUP_DAYS = 365;

  const initialQuoteData = {
    id: uuidv4(),
    quoteId: initialQuoteId,
    entityId: userEntityId,
    beneficiary: validatedEntityId.toLowerCase(),
    tokenAmount: "0",
    discountBps: DEFAULT_MIN_DISCOUNT_BPS,
    apr: 0,
    lockupMonths: DEFAULT_MAX_LOCKUP_MONTHS,
    lockupDays: DEFAULT_MAX_LOCKUP_DAYS,
    paymentCurrency: "USDC",
    priceUsdPerToken: 0.00127,
    totalUsd: 0,
    discountUsd: 0,
    discountedUsd: 0,
    paymentAmount: "0",
    signature: "",
    status: "active",
    createdAt: Date.now(),
    executedAt: 0,
    rejectedAt: 0,
    approvedAt: 0,
    transactionHash: "",
    blockNumber: 0,
    rejectionReason: "",
    approvalNote: "",
  };

  await runtime.setCache(`quote:${initialQuoteId}`, initialQuoteData);

  // Add to indexes - initialize arrays if they don't exist
  const allQuotes = await runtime.getCache<string[]>("all_quotes");
  // allQuotes is optional - default to empty array if not present
  const allQuotesArray = Array.isArray(allQuotes) ? allQuotes : [];
  if (!allQuotesArray.includes(initialQuoteId)) {
    allQuotesArray.push(initialQuoteId);
    await runtime.setCache("all_quotes", allQuotesArray);
  }

  const entityQuoteIds = await runtime.getCache<string[]>(`entity_quotes:${userEntityId}`);
  // entityQuoteIds is optional - default to empty array if not present
  const entityQuoteIdsArray = Array.isArray(entityQuoteIds) ? entityQuoteIds : [];
  if (!entityQuoteIdsArray.includes(initialQuoteId)) {
    entityQuoteIdsArray.push(initialQuoteId);
    await runtime.setCache(`entity_quotes:${userEntityId}`, entityQuoteIdsArray);
  }

  console.log("[Rooms API] Initial quote saved to cache and indexed:", initialQuoteId);

  // Create a welcome message explaining base terms - no quote XML until user specifies a token
  // This prevents the Accept button from appearing before a real token is negotiated
  const discountPercent = (DEFAULT_MIN_DISCOUNT_BPS / 100).toFixed(2);
  const welcomeMessage = `Welcome! I can help you negotiate OTC deals for tokens.

**Default Terms (starting point):**
• Discount: ${discountPercent}%
• Lockup: ${DEFAULT_MAX_LOCKUP_MONTHS} months (${DEFAULT_MAX_LOCKUP_DAYS} days)

Tell me which token you're interested in, and we can negotiate better terms based on the amount and lockup period you prefer.

For example, try: "I want to buy tokens" or "What tokens are available?"`;

  const agentMessage: Memory = {
    id: uuidv4() as UUID,
    roomId: roomId as UUID,
    entityId: runtime.agentId,
    agentId: runtime.agentId,
    content: {
      text: welcomeMessage,
      type: "agent",
    },
    createdAt: Date.now(),
  };

  await runtime.createMemory(agentMessage, "messages");
  console.log("[Rooms API] ✅ Initial welcome message created");

  const postResponse = {
    success: true,
    roomId,
    createdAt: Date.now(),
  };
  const validatedPost = RoomsResponseSchema.parse(postResponse);
  return NextResponse.json(validatedPost);
}
