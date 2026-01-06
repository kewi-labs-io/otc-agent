import { NextResponse } from "next/server";

export async function GET() {
  try {
    // Use dynamic import to ensure proper bundling
    const idl = await import("../../../../contracts/solana-otc.idl.json");
    return NextResponse.json(idl.default ?? idl);
  } catch (err) {
    console.error("[Solana IDL API] Failed to load IDL:", err);
    return NextResponse.json(
      { error: "Failed to load Solana IDL", details: String(err) },
      { status: 500 },
    );
  }
}
