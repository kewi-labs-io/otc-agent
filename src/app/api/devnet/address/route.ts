import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export async function GET() {
  try {
    const override = process.env.NEXT_PUBLIC_OTC_ADDRESS;
    if (override) return NextResponse.json({ address: override });

    const file = path.join(
      process.cwd(),
      "contracts/ignition/deployments/chain-31337/deployed_addresses.json",
    );
    const raw = await fs.readFile(file, "utf8");
    const json = JSON.parse(raw);
    const addr =
      json?.["OTCModule#OTC"] ||
      json?.["OTCDeskModule#OTC"] ||
      json?.["ElizaOTCModule#ElizaOTC"] ||
      json?.["OTCModule#desk"];
    if (!addr)
      return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ address: addr });
  } catch {
    return NextResponse.json({});
  }
}
