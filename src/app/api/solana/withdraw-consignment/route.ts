import { NextRequest, NextResponse } from "next/server";
import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
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
    const { consignmentAddress, consignerAddress, signedTransaction } =
      await request.json();

    if (!consignmentAddress || !consignerAddress || !signedTransaction) {
      return NextResponse.json(
        { error: "consignmentAddress, consignerAddress, and signedTransaction required" },
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

    const connection = new Connection(SOLANA_RPC, "confirmed");

    // Load desk keypair (supports env var and file-based)
    let deskKeypair: Keypair;
    try {
      deskKeypair = await loadDeskKeypair();
    } catch (error) {
      console.error("[Withdraw Consignment API] Failed to load desk keypair:", error);
      return NextResponse.json(
        { error: "Desk keypair not configured" },
        { status: 500 },
      );
    }
    const desk = new PublicKey(SOLANA_DESK);

    // Load IDL
    const idlPath = path.join(
      process.cwd(),
      "solana/otc-program/target/idl/otc.json",
    );
    const idl = JSON.parse(await fs.readFile(idlPath, "utf8"));

    // Deserialize the signed transaction from the client
    let transaction: Transaction;
    try {
      transaction = Transaction.from(
        Buffer.from(signedTransaction, "base64"),
      );
    } catch (error) {
      return NextResponse.json(
        { error: "Invalid transaction data" },
        { status: 400 },
      );
    }

    // Verify the consigner signed it
    const consignerPubkey = new PublicKey(consignerAddress);
    // Check if consigner's signature exists (signature is a Buffer when signed, null when unsigned)
    const consignerSig = transaction.signatures.find(
      (sig) => sig.publicKey.equals(consignerPubkey),
    );
    
    if (!consignerSig || !consignerSig.signature) {
      return NextResponse.json(
        { error: "Transaction not signed by consigner" },
        { status: 400 },
      );
    }

    // Fetch consignment account to get token mint
    const consignmentPubkey = new PublicKey(consignmentAddress);
    
    // Create provider and program
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const programAccounts = program.account as any;
    const consignmentData = await programAccounts.consignment.fetch(
      consignmentPubkey,
    );

    if (!consignmentData) {
      return NextResponse.json(
        { error: "Consignment not found" },
        { status: 404 },
      );
    }

    // Verify consigner matches
    if (consignmentData.consigner.toString() !== consignerAddress) {
      return NextResponse.json(
        { error: "Consigner address mismatch" },
        { status: 403 },
      );
    }

    // Verify consignment belongs to expected desk
    if (consignmentData.desk.toString() !== desk.toString()) {
      return NextResponse.json(
        { error: "Consignment does not belong to this desk" },
        { status: 400 },
      );
    }

    // Verify consignment is active and has remaining amount
    if (!consignmentData.isActive) {
      return NextResponse.json(
        { error: "Consignment is not active" },
        { status: 400 },
      );
    }

    // consignmentData.remainingAmount is a BN, convert to string for comparison
    const remainingAmountStr = consignmentData.remainingAmount.toString();
    if (remainingAmountStr === "0") {
      return NextResponse.json(
        { error: "Nothing to withdraw" },
        { status: 400 },
      );
    }

    // Verify desk public key matches
    if (!deskKeypair.publicKey.equals(desk)) {
      return NextResponse.json(
        { error: "Desk keypair mismatch" },
        { status: 500 },
      );
    }

    // Add desk signature (partial sign)
    console.log("[Withdraw Consignment API] Adding desk signature...");
    transaction.partialSign(deskKeypair);
    console.log("[Withdraw Consignment API] Desk signature added");

    // Verify all required signatures are present
    const deskSig = transaction.signatures.find(
      (sig) => sig.publicKey.equals(deskKeypair.publicKey),
    );
    const consignerSigFinal = transaction.signatures.find(
      (sig) => sig.publicKey.equals(consignerPubkey),
    );

    if (!deskSig || !deskSig.signature) {
      return NextResponse.json(
        { error: "Desk signature missing" },
        { status: 500 },
      );
    }
    if (!consignerSigFinal || !consignerSigFinal.signature) {
      return NextResponse.json(
        { error: "Consigner signature missing" },
        { status: 400 },
      );
    }

    // Send transaction
    console.log("[Withdraw Consignment API] Sending transaction...");
    const signature = await connection.sendRawTransaction(
      transaction.serialize(),
      {
        skipPreflight: false,
        maxRetries: 3,
      },
    );
    console.log("[Withdraw Consignment API] Transaction sent:", signature);

    // Wait for confirmation
    console.log("[Withdraw Consignment API] Waiting for confirmation...");
    await connection.confirmTransaction(signature, "confirmed");
    console.log("[Withdraw Consignment API] Transaction confirmed");

    return NextResponse.json({
      success: true,
      signature,
    });
  } catch (error) {
    console.error("[Withdraw Consignment API] Error:", error);
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

