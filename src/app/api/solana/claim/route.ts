import { NextRequest, NextResponse } from "next/server";
import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { promises as fs } from "fs";
import path from "path";

export async function POST(request: NextRequest) {
  const { offerAddress, beneficiary } = await request.json();

  if (!offerAddress || !beneficiary) {
    return NextResponse.json(
      { error: "offerAddress and beneficiary required" },
      { status: 400 },
    );
  }

  const SOLANA_RPC =
    process.env.NEXT_PUBLIC_SOLANA_RPC || "http://127.0.0.1:8899";
  const SOLANA_DESK = process.env.NEXT_PUBLIC_SOLANA_DESK;

  if (!SOLANA_DESK) {
    throw new Error("SOLANA_DESK not configured");
  }

  // Load desk keypair
  const deskKeypairPath = path.join(
    process.cwd(),
    "solana/otc-program/desk-keypair.json",
  );
  const deskKeypairData = JSON.parse(
    await fs.readFile(deskKeypairPath, "utf8"),
  );
  const deskKeypair = Keypair.fromSecretKey(Uint8Array.from(deskKeypairData));
  const desk = new PublicKey(SOLANA_DESK);

  // Load IDL
  const idlPath = path.join(
    process.cwd(),
    "solana/otc-program/target/idl/otc.json",
  );
  const idl = JSON.parse(await fs.readFile(idlPath, "utf8"));

  const connection = new Connection(SOLANA_RPC, "confirmed");

  const wallet = {
    publicKey: deskKeypair.publicKey,
    signTransaction: async (tx: any) => {
      tx.partialSign(deskKeypair);
      return tx;
    },
    signAllTransactions: async (txs: any[]) => {
      txs.forEach((tx) => tx.partialSign(deskKeypair));
      return txs;
    },
  };

  const provider = new anchor.AnchorProvider(connection, wallet as any, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const program = new (anchor as any).Program(idl, provider);

  // Fetch offer
  const offer = new PublicKey(offerAddress);
  const offerData = await program.account.offer.fetch(offer);

  if (offerData.fulfilled) {
    return NextResponse.json({
      success: true,
      alreadyClaimed: true,
      message: "Offer already claimed",
    });
  }

  if (!offerData.paid) {
    return NextResponse.json({ error: "Offer not paid yet" }, { status: 400 });
  }

  const now = Math.floor(Date.now() / 1000);
  if (now < offerData.unlockTime) {
    console.log(
      `[Solana Claim] Lockup not expired yet. Will auto-claim at unlock time.`,
    );
    return NextResponse.json(
      {
        success: true,
        scheduled: true,
        message:
          "Tokens will be automatically distributed after lockup expires",
        unlockTime: offerData.unlockTime,
        secondsRemaining: offerData.unlockTime - now,
      },
      { status: 200 },
    );
  }

  // Get token accounts
  const deskData = await program.account.desk.fetch(desk);
  const tokenMint = new PublicKey(deskData.tokenMint);
  const deskTokenTreasury = await getAssociatedTokenAddress(
    tokenMint,
    desk,
    true,
  );
  const beneficiaryPk = new PublicKey(beneficiary);
  const beneficiaryTokenAta = await getAssociatedTokenAddress(
    tokenMint,
    beneficiaryPk,
    false,
  );

  // Claim tokens (desk signs because it holds the tokens)
  const tx = await program.methods
    .claim(new (anchor as any).BN(offerData.id))
    .accounts({
      desk,
      deskSigner: deskKeypair.publicKey,
      offer,
      deskTokenTreasury,
      beneficiaryTokenAta,
      beneficiary: beneficiaryPk,
      tokenProgram: new PublicKey(
        "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      ),
    })
    .signers([deskKeypair])
    .rpc();

  console.log(`[Solana Claim] ✅ Claimed ${offerAddress}, tx: ${tx}`);

  return NextResponse.json({
    success: true,
    tx,
    offerAddress,
    beneficiary,
  });
}
