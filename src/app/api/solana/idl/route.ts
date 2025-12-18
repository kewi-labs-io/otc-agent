import { NextResponse } from "next/server";
import idl from "@/contracts/solana-otc.idl.json";

export async function GET() {
  return NextResponse.json(idl);
}
