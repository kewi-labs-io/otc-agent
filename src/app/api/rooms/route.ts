import { NextRequest, NextResponse } from "next/server";
import { agentRuntime } from "@/lib/agent-runtime";
import { v4 as uuidv4 } from "uuid";
import { quoteAction } from "@/lib/plugin-otc-desk/actions/quote";
import { stringToUuid } from "@elizaos/core";

// GET /api/rooms - Get user's rooms
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const entityId = searchParams.get("entityId");

    if (!entityId) {
      return NextResponse.json(
        { error: "entityId is required" },
        { status: 400 },
      );
    }

    const runtime = await agentRuntime.getRuntime();
    const roomIds = await runtime.getRoomsForParticipants([
      stringToUuid(entityId) as any,
    ]);

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

    return NextResponse.json({
      success: true,
      rooms,
    });
  } catch (error) {
    console.error("[Rooms API] Error getting rooms:", error);
    return NextResponse.json(
      {
        error: "Failed to get rooms",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

// POST /api/rooms - Create new room
export async function POST(request: NextRequest) {
  try {
    console.log("[Rooms API] POST request received");
    const body = await request.json();
    const { entityId } = body;
    console.log("[Rooms API] entityId:", entityId);

    if (!entityId) {
      return NextResponse.json(
        { error: "entityId is required" },
        { status: 400 },
      );
    }

    const runtime = await agentRuntime.getRuntime();
    const roomId = uuidv4();

    // Ensure room exists
    await runtime.ensureRoomExists({
      id: roomId as any,
      source: "web",
      type: "DM" as any,
      channelId: roomId,
      serverId: "otc-desk-server",
      worldId: stringToUuid("otc-desk-world") as any,
      agentId: runtime.agentId,
    });

    console.log("[Rooms API] Created room:", roomId, "for entity:", entityId);

    // Create initial default quote for this user
    try {
      console.log("[Rooms API] Creating initial quote for wallet:", entityId);
      
      const memory: any = {
        id: uuidv4(),
        content: {
          text: "create quote for 200000 ElizaOS at 10% discount payable in USDC",
        },
        entityId,
        agentId: runtime.agentId,
        roomId: roomId,
        createdAt: Date.now(),
      };

      let agentResponseText = "";
      let quoteCreated = false;
      
      await (quoteAction.handler as any)(
        runtime as any,
        memory,
        undefined as any,
        {},
        (async (result: { text?: string }) => {
          agentResponseText = result?.text || "";
          quoteCreated = true;
          console.log("[Rooms API] Initial quote created, response length:", agentResponseText.length);
          return [] as any;
        }) as any,
      );

      if (agentResponseText && agentResponseText.trim().length > 0) {
        const agentMessage = {
          id: uuidv4(),
          roomId,
          entityId: runtime.agentId,
          agentId: runtime.agentId,
          content: {
            text: agentResponseText,
            type: "agent",
          },
          createdAt: Date.now(),
        } as any;

        await runtime.createMemory(agentMessage, "messages");
        console.log("[Rooms API] Initial quote message saved to room");
      }
      
      if (quoteCreated) {
        console.log("[Rooms API] ✅ Initial quote successfully created for", entityId);
      }
    } catch (initErr) {
      console.error("[Rooms API] Failed to create initial quote:", initErr);
    }

    return NextResponse.json({
      success: true,
      roomId,
      createdAt: Date.now(),
    });
  } catch (error) {
    console.error("[Rooms API] Detailed error:", error);
    console.error(
      "[Rooms API] Error stack:",
      error instanceof Error ? error.stack : "No stack",
    );
    return NextResponse.json(
      {
        error: "Failed to create room",
        details: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 },
    );
  }
}
