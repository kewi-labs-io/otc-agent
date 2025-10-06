import { NextResponse } from "next/server";
import { agentRuntime } from "@/lib/agent-runtime";

// GET /api/rooms/[roomId] - Get conversation details and messages
export async function GET(request: Request, { params }: any) {
  try {
    const { roomId } = params;
    const { searchParams } = new URL(request.url);
    const limit = searchParams.get("limit");

    if (!roomId) {
      return NextResponse.json(
        { error: "roomId is required" },
        { status: 400 },
      );
    }

    const runtime = await agentRuntime.getRuntime();
    const rawMessages = await runtime.getMemories({
      tableName: "messages",
      roomId: roomId as any,
      count: limit ? parseInt(limit) : 50,
      unique: false,
    });
    const simple = rawMessages.map((msg) => {
      let parsedContent: any = msg.content;
      try {
        if (typeof msg.content === "string")
          parsedContent = JSON.parse(msg.content);
      } catch {
        parsedContent = msg.content;
      }
      return {
        id: msg.id,
        entityId: msg.entityId,
        agentId: msg.agentId,
        content: parsedContent,
        createdAt: (msg as any).createdAt,
        isAgent: msg.entityId === msg.agentId,
      };
    });

    return NextResponse.json(
      {
        success: true,
        roomId,
        messages: simple,
        count: simple.length,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[Conversation API] Error getting conversation:", error);
    return NextResponse.json(
      {
        error: "Failed to get conversation",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
