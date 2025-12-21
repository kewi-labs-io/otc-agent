import { NextResponse } from "next/server";
import type { Memory, UUID, Media } from "@elizaos/core";
import { agentRuntime } from "@/lib/agent-runtime";
import {
  validateRouteParams,
  validateQueryParams,
  parseOrThrow,
  validationErrorResponse,
} from "@/lib/validation/helpers";
import {
  GetRoomParamsSchema,
  GetRoomMessagesQuerySchema,
  RoomMessagesResponseSchema,
  SendMessageRequestSchema,
  SendMessageResponseSchema,
} from "@/types/validation/api-schemas";
import { z } from "zod";
import type { MemoryWithTimestamp, RouteContext } from "@/types/api";

// POST /api/rooms/[roomId]/messages - Send a message
export async function POST(request: Request, ctx: RouteContext) {
  const { roomId } = await ctx.params;

  // FAIL-FAST: Validate route params
  if (!roomId) {
    console.error("[Messages API] Missing roomId");
    return NextResponse.json({ error: "roomId is required" }, { status: 400 });
  }

  const body = await request.json();
  const data = parseOrThrow(SendMessageRequestSchema, body);

  const { entityId, text, attachments } = data;

  // Handle the message - pass wallet address directly
  // The action handlers will convert to UUID for cache storage when needed
  // Attachments type from @elizaos/core Media[] - cast from Zod unknown[] to Media[]
  // FAIL-FAST: attachments should be validated by schema, but ensure it's an array
  if (attachments !== undefined && !Array.isArray(attachments)) {
    throw new Error("attachments must be an array");
  }
  // attachments is optional - use empty array as default if not provided
  const attachmentsArray = Array.isArray(attachments) ? attachments : [];
  const message = (await agentRuntime.handleMessage(roomId, entityId, {
    text,
    attachments: attachmentsArray as Media[],
  })) as MemoryWithTimestamp;

  console.log(`[Messages API] Message sent successfully`, {
    roomId,
    entityId,
    messageId: message.id,
  });

  // FAIL-FAST: entityId and agentId are required fields
  if (!message.entityId) {
    throw new Error("Message missing required entityId field");
  }
  if (!message.agentId) {
    throw new Error("Message missing required agentId field");
  }

  // Validate and return the created message
  const response = {
    success: true as const,
    message: {
      id: message.id,
      entityId: message.entityId,
      agentId: message.agentId,
      content: message.content,
      createdAt: message.createdAt,
      roomId,
    },
    // Include polling hint for the client
    pollForResponse: true,
    pollDuration: 30000, // 30 seconds
    pollInterval: 1000, // 1 second
  };
  const validatedResponse = SendMessageResponseSchema.parse(response);
  return NextResponse.json(validatedResponse);
}

// GET /api/rooms/[roomId]/messages - Get messages (for polling)
export async function GET(request: Request, ctx: RouteContext) {
  const { roomId } = await ctx.params;
  const { searchParams } = new URL(request.url);
  const limit = searchParams.get("limit");
  const afterTimestamp = searchParams.get("afterTimestamp");

  if (!roomId) {
    return NextResponse.json({ error: "roomId is required" }, { status: 400 });
  }

  const runtime = await agentRuntime.getRuntime();
  const messages = (await runtime.getMemories({
    tableName: "messages",
    roomId: roomId as UUID,
    count: limit ? parseInt(limit) : 100, // Higher count for polling to catch all new messages
    unique: false,
  })) as MemoryWithTimestamp[];

  // Filter messages by timestamp if provided (for polling)
  const afterTimestampNum = afterTimestamp ? parseInt(afterTimestamp) : 0;
  const filteredMessages = afterTimestamp
    ? messages.filter((msg) => {
        // FAIL-FAST: createdAt should always exist for messages
        if (msg.createdAt == null) {
          throw new Error(`Message ${msg.id} missing createdAt timestamp`);
        }
        return msg.createdAt > afterTimestampNum;
      })
    : messages;

  const simple = filteredMessages.map((msg) => {
    // Content can be string or object - parse if string, otherwise use as-is
    let parsedContent: string | Record<string, unknown> = msg.content;
    if (typeof msg.content === "string") {
      parsedContent = JSON.parse(msg.content) as Record<string, unknown>;
    }
    // FAIL-FAST: createdAt should always exist
    if (msg.createdAt === undefined || msg.createdAt === null) {
      throw new Error(`Message ${msg.id} missing createdAt timestamp`);
    }

    return {
      id: msg.id,
      entityId: msg.entityId,
      agentId: msg.agentId,
      content: parsedContent,
      createdAt: msg.createdAt,
      isAgent: msg.entityId === msg.agentId,
    };
  });

  const response = {
    success: true as const,
    messages: simple,
    hasMore: false,
    lastTimestamp:
      simple.length > 0 ? simple[simple.length - 1].createdAt : Date.now(),
  };
  const validatedResponse = RoomMessagesResponseSchema.parse(response);
  return NextResponse.json(validatedResponse, {
    headers: { "Cache-Control": "no-store" },
  });
}
