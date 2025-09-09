import { NextRequest, NextResponse } from "next/server";
import { agentRuntime } from "@/lib/agent-runtime";

// POST /api/conversations/[conversationId]/messages - Send a message
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  try {
    const resolvedParams = await params;
    const { conversationId } = resolvedParams;
    const body = await request.json();
    const { userId, text, attachments, clientMessageId } = body;

    if (!conversationId) {
      console.error("[Messages API] Missing conversationId");
      return NextResponse.json(
        { error: "conversationId is required" },
        { status: 400 },
      );
    }

    if (!userId) {
      console.error("[Messages API] Missing userId");
      return NextResponse.json(
        { error: "userId is required" },
        { status: 400 },
      );
    }

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      console.error("[Messages API] Invalid or missing text", { text });
      return NextResponse.json(
        { error: "text is required and must be a non-empty string" },
        { status: 400 },
      );
    }

    // Handle the message
    const message = await agentRuntime.handleMessage(
      conversationId,
      userId,
      {
        text,
        attachments: attachments || [],
      },
      undefined,
      clientMessageId,
    );

    console.log(`[Messages API] Message sent successfully`, {
      conversationId,
      userId,
      messageId: message.id,
    });

    // Return the created message
    return NextResponse.json({
      success: true,
      message: {
        id: message.id,
        userId:
          (message as any).userId ||
          (message as any).userID ||
          (message as any).user_id ||
          "",
        agentId: (message as any).agentId,
        content: message.content,
        createdAt: message.createdAt,
        conversationId,
      },
      // Include polling hint for the client
      pollForResponse: true,
      pollDuration: 30000, // 30 seconds
      pollInterval: 1000, // 1 second
    });
  } catch (error) {
    console.error("[Messages API] Error sending message:", error);

    // Provide more specific error messages based on the error type
    if (error instanceof TypeError) {
      return NextResponse.json(
        {
          error: "Invalid request format",
          details: error.message,
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error: "Failed to send message",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

// GET /api/conversations/[conversationId]/messages - Get messages (for polling)
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

    const messages = await agentRuntime.getConversationMessages(
      conversationId,
      limit ? parseInt(limit) : 10,
      afterTimestamp ? parseInt(afterTimestamp) : undefined,
    );

    return NextResponse.json({
      success: true,
      messages: messages.map((msg) => {
        let parsedContent: any = msg.content;
        try {
          // Parse content if it's a JSON string
          if (typeof msg.content === "string") {
            parsedContent = JSON.parse(msg.content);
          }
        } catch {
          // If parsing fails, wrap string in text property
          parsedContent = { text: msg.content };
        }

        return {
          id: msg.id,
          userId: msg.userId,
          agentId: msg.agentId,
          content: parsedContent,
          createdAt: msg.createdAt,
          isAgent: msg.isAgent,
        };
      }),
      hasMore: false, // You could implement pagination logic here
      lastTimestamp:
        messages.length > 0
          ? Math.max(
              ...messages.map((m) =>
                m.createdAt ? new Date(m.createdAt).getTime() : 0,
              ),
            )
          : afterTimestamp
            ? parseInt(afterTimestamp)
            : Date.now(),
    });
  } catch (error) {
    console.error("[Messages API] Error getting messages:", error);
    return NextResponse.json(
      {
        error: "Failed to get messages",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
