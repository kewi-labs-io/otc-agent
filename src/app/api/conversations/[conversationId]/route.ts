import { NextRequest, NextResponse } from "next/server";
import { agentRuntime } from "@/lib/agent-runtime";

// GET /api/conversations/[conversationId] - Get conversation details and messages
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  try {
    const resolvedParams = await params;
    const { conversationId } = resolvedParams;
    const { searchParams } = new URL(request.url);
    const afterTimestamp = searchParams.get("afterTimestamp");
    const limit = searchParams.get("limit");

    if (!conversationId) {
      return NextResponse.json(
        { error: "conversationId is required" },
        { status: 400 },
      );
    }

    const rawMessages = await agentRuntime.getConversationMessages(
      conversationId,
      limit ? parseInt(limit) : 50,
      afterTimestamp ? parseInt(afterTimestamp) : undefined,
    );
    const simple = rawMessages.map((msg) => {
      let parsedContent: any = msg.content;
      try {
        if (typeof msg.content === "string") parsedContent = JSON.parse(msg.content);
      } catch {
        parsedContent = msg.content;
      }
      return {
        id: msg.id,
        userId: msg.userId,
        agentId: msg.agentId,
        content: parsedContent,
        createdAt: (msg as any).createdAt,
        isAgent: msg.isAgent || msg.userId === "otc-desk-agent",
      };
    });

    return NextResponse.json(
      {
        success: true,
        conversationId,
        messages: simple,
        count: simple.length,
      },
      { headers: { 'Cache-Control': 'no-store' } },
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
