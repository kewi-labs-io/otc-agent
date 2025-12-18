import { NextRequest, NextResponse } from "next/server";

// Proxy RPC requests to Alchemy to keep API key server-side
// This prevents the Alchemy API key from being exposed in the browser

const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY;
const ALCHEMY_BASE_URL = `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;

export async function POST(request: NextRequest) {
  if (!ALCHEMY_API_KEY) {
    console.error("[RPC Proxy] ALCHEMY_API_KEY not configured");
    return NextResponse.json(
      { error: "RPC not configured" },
      { status: 500 },
    );
  }

  try {
    const body = await request.json();

    const response = await fetch(ALCHEMY_BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      console.error(
        "[RPC Proxy] Alchemy error:",
        response.status,
        response.statusText,
      );
      return NextResponse.json(
        { error: "RPC request failed" },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("[RPC Proxy] Error:", error);
    return NextResponse.json({ error: "RPC proxy error" }, { status: 500 });
  }
}
