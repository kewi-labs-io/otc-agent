import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { exec } from "child_process";

function readAddressFromFile(root: string): Promise<string | undefined> {
  return fs
    .readFile(
      path.join(
        root,
        "contracts/ignition/deployments/chain-31337/deployed_addresses.json",
      ),
      "utf8",
    )
    .then((raw) => {
      const json = JSON.parse(raw);
      return (
        json?.["OTCModule#OTC"] ||
        json?.["OTCDeskModule#OTC"] ||
        json?.["ElizaOTCModule#ElizaOTC"] ||
        json?.["OTCModule#desk"]
      );
    })
    .catch(() => undefined);
}

export async function POST() {
  try {
    const override = process.env.NEXT_PUBLIC_OTC_ADDRESS;
    if (override) return NextResponse.json({ address: override });

    const root = process.cwd();
    let addr = await readAddressFromFile(root);
    if (addr) return NextResponse.json({ address: addr });

    await new Promise<void>((resolve, reject) => {
      const child = exec("cd contracts && npm run deploy:local", { cwd: root });
      child.on("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`deploy exited ${code}`)),
      );
      child.on("error", reject);
    });

    addr = await readAddressFromFile(root);
    if (!addr)
      return NextResponse.json({ error: "deploy failed" }, { status: 500 });
    return NextResponse.json({ address: addr });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || String(e) },
      { status: 500 },
    );
  }
}
