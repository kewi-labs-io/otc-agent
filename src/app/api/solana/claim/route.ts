import { NextRequest, NextResponse } from "next/server";
import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { promises as fs } from "fs";
import path from "path";
import bs58 from "bs58";

// Wallet interface for Anchor (matches @coral-xyz/anchor's Wallet type)
interface AnchorWallet {
  publicKey: PublicKey;
  signTransaction<T extends Transaction | VersionedTransaction>(
    tx: T,
  ): Promise<T>;
  signAllTransactions<T extends Transaction | VersionedTransaction>(
    txs: T[],
  ): Promise<T[]>;
}

// Load desk keypair from env var (mainnet) or file (localnet)
async function loadDeskKeypair(): Promise<Keypair> {
  // 1. Try environment variable first (production/mainnet)
  const privateKeyStr = process.env.SOLANA_DESK_PRIVATE_KEY;
  if (privateKeyStr) {
    // Support both base58 and JSON array formats
    if (privateKeyStr.startsWith("[")) {
      const secretKey = Uint8Array.from(JSON.parse(privateKeyStr));
      return Keypair.fromSecretKey(secretKey);
    }
    const secretKey = bs58.decode(privateKeyStr);
    return Keypair.fromSecretKey(secretKey);
  }

  // 2. Try file-based keypair (localnet/development)
  const possiblePaths = [
    path.join(process.cwd(), "solana/otc-program/desk-keypair.json"),
    path.join(process.cwd(), "solana/otc-program/desk-mainnet-keypair.json"),
    path.join(process.cwd(), "solana/otc-program/desk-devnet-keypair.json"),
  ];

  for (const keypairPath of possiblePaths) {
    try {
      const keypairData = JSON.parse(await fs.readFile(keypairPath, "utf8"));
      return Keypair.fromSecretKey(Uint8Array.from(keypairData));
    } catch {
      // File doesn't exist, try next
    }
  }

  throw new Error(
    "Desk keypair not found. Set SOLANA_DESK_PRIVATE_KEY env var or create desk-keypair.json",
  );
}

export async function POST(request: NextRequest) {
  try {
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
      return NextResponse.json(
        { error: "SOLANA_DESK not configured" },
        { status: 500 },
      );
    }

    // Load desk keypair (supports env var and file-based)
    let deskKeypair: Keypair;
    try {
      deskKeypair = await loadDeskKeypair();
    } catch (error) {
      console.error("[Solana Claim API] Failed to load desk keypair:", error);
      return NextResponse.json(
        { error: "Desk keypair not configured" },
        { status: 500 },
      );
    }
    const desk = new PublicKey(SOLANA_DESK);

    // Verify desk keypair matches expected desk public key
    if (!deskKeypair.publicKey.equals(desk)) {
      console.error(
        "[Solana Claim API] Desk keypair mismatch. Expected:",
        SOLANA_DESK,
        "Got:",
        deskKeypair.publicKey.toBase58(),
      );
      return NextResponse.json(
        { error: "Desk keypair mismatch" },
        { status: 500 },
      );
    }

    // Load IDL
    const idlPath = path.join(
      process.cwd(),
      "solana/otc-program/target/idl/otc.json",
    );
    const idl = JSON.parse(await fs.readFile(idlPath, "utf8"));

    const connection = new Connection(SOLANA_RPC, "confirmed");

    const wallet: AnchorWallet = {
      publicKey: deskKeypair.publicKey,
      signTransaction: async <T extends Transaction | VersionedTransaction>(
        tx: T,
      ) => {
        (tx as Transaction).partialSign(deskKeypair);
        return tx;
      },
      signAllTransactions: async <T extends Transaction | VersionedTransaction>(
        txs: T[],
      ) => {
        txs.forEach((tx) => (tx as Transaction).partialSign(deskKeypair));
        return txs;
      },
    };

    const provider = new anchor.AnchorProvider(connection, wallet, {
      commitment: "confirmed",
    });
    anchor.setProvider(provider);

    const program = new anchor.Program(idl, provider);

    // Fetch offer
    // Type assertion needed as anchor's account namespace types are dynamic
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const programAccounts = program.account as any;
    const offer = new PublicKey(offerAddress);
    const offerData = await programAccounts.offer.fetch(offer);

    if (offerData.fulfilled) {
      return NextResponse.json({
        success: true,
        alreadyClaimed: true,
        message: "Offer already claimed",
      });
    }

    if (!offerData.paid) {
      return NextResponse.json(
        { error: "Offer not paid yet" },
        { status: 400 },
      );
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

    // Get token accounts - use offer.tokenMint for multi-token support
    // In token-agnostic architecture, each offer stores its own token_mint
    const tokenMint = new PublicKey(offerData.tokenMint);
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
      .claim(new anchor.BN(offerData.id))
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
  } catch (error) {
    console.error("[Solana Claim API] Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
