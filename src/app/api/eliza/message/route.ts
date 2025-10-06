import { NextRequest, NextResponse } from "next/server";

// Compatibility endpoint to support older tests calling /api/eliza/message
// Proxies to the new conversation APIs: creates a conversation if missing,
// then posts the message and returns the agent's text (if any) and raw payload.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { entityId, message } = body || {};

    if (!entityId || !message || typeof message !== "string") {
      return NextResponse.json(
        { error: "entityId and message are required" },
        { status: 400 },
      );
    }

    const origin = request.nextUrl.origin;
    // Create conversation
    const createRes = await fetch(`${origin}/api/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entityId }),
      cache: "no-store",
    });
    if (!createRes.ok) {
      const text = await createRes.text();
      return NextResponse.json(
        { error: "Failed to create conversation", details: text },
        { status: 500 },
      );
    }
    const createData = await createRes.json();
    const roomId = createData.roomId;

    // Send message
    const msgRes = await fetch(`${origin}/api/rooms/${roomId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entityId, text: message }),
      cache: "no-store",
    });
    if (!msgRes.ok) {
      const text = await msgRes.text();
      return NextResponse.json(
        { error: "Failed to send message", details: text },
        { status: 500 },
      );
    }
    const msgData = await msgRes.json();

    return NextResponse.json({
      success: true,
      roomId,
      message: msgData?.message,
      text: (msgData?.message?.content?.text as string) || "",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Compat endpoint failed",
        details: error instanceof Error ? error.message : "Unknown",
      },
      { status: 500 },
    );
  }
}
