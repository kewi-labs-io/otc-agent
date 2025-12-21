import { NextRequest, NextResponse } from "next/server";
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { promises as fs } from "fs";
import path from "path";
import { getSolanaConfig } from "@/config/contracts";
import { getHeliusRpcUrl, getNetwork } from "@/config/env";
import { loadDeskKeypair, createAnchorWallet } from "@/utils/solana-keypair";
import {
  parseOrThrow,
  validationErrorResponse,
} from "@/lib/validation/helpers";
import {
  SolanaWithdrawConsignmentRequestWithSignedTxSchema,
  SolanaWithdrawConsignmentResponseSchema,
} from "@/types/validation/api-schemas";
import { z } from "zod";

export async function POST(request: NextRequest) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate request body - return 400 on invalid params
  const parseResult =
    SolanaWithdrawConsignmentRequestWithSignedTxSchema.safeParse(body);
  if (!parseResult.success) {
    return validationErrorResponse(parseResult.error, 400);
  }
  const data = parseResult.data;

  const { consignmentAddress, consignerAddress, signedTransaction } = data;

  // Get Solana config from deployment
  const network = getNetwork();
  const solanaConfig = getSolanaConfig();
  const SOLANA_RPC =
    network === "local" ? "http://127.0.0.1:8899" : getHeliusRpcUrl();
  const SOLANA_DESK = solanaConfig.desk;

  if (!SOLANA_DESK) {
    return NextResponse.json(
      { error: "SOLANA_DESK not configured in deployment" },
      { status: 500 },
    );
  }

  console.log(`[Withdraw Consignment API] Using Helius RPC`);
  const connection = new Connection(SOLANA_RPC, "confirmed");

  // Load desk keypair (supports env var and file-based)
  const deskKeypair = await loadDeskKeypair();
  console.log(
    "[Withdraw Consignment API] Loaded desk keypair:",
    deskKeypair.publicKey.toBase58(),
  );
  const desk = new PublicKey(SOLANA_DESK);

  // Load IDL
  const idlPath = path.join(
    process.cwd(),
    "solana/otc-program/target/idl/otc.json",
  );
  const idl = JSON.parse(await fs.readFile(idlPath, "utf8"));

  // Deserialize the signed transaction from the client
  const transaction = Transaction.from(
    Buffer.from(signedTransaction, "base64"),
  );

  // Verify the consigner signed it
  const consignerPubkey = new PublicKey(consignerAddress);
  // Check if consigner's signature exists (signature is a Buffer when signed, null when unsigned)
  const consignerSig = transaction.signatures.find((sig) =>
    sig.publicKey.equals(consignerPubkey),
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
  const wallet = createAnchorWallet(deskKeypair);

  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const program = new anchor.Program(idl, provider);

  interface ConsignmentAccountProgram {
    consignment: {
      fetch: (pubkey: PublicKey) => Promise<{
        consigner: PublicKey;
        desk: PublicKey;
        isActive: boolean;
        remainingAmount: { toString(): string };
      }>;
    };
  }

  const programAccounts = program.account as ConsignmentAccountProgram;
  const consignmentData =
    await programAccounts.consignment.fetch(consignmentPubkey);

  // FAIL-FAST: Consignment must exist on-chain
  if (!consignmentData) {
    throw new Error(`Consignment ${consignmentAddress} not found on-chain`);
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
    return NextResponse.json({ error: "Nothing to withdraw" }, { status: 400 });
  }

  // Verify desk public key matches
  if (!deskKeypair.publicKey.equals(desk)) {
    console.error(
      "[Withdraw Consignment API] Desk keypair mismatch. Expected:",
      desk.toBase58(),
      "Got:",
      deskKeypair.publicKey.toBase58(),
    );
    return NextResponse.json(
      {
        error: `Desk keypair mismatch. Expected: ${desk.toBase58()}, Got: ${deskKeypair.publicKey.toBase58()}`,
      },
      { status: 500 },
    );
  }

  // Add desk signature (partial sign)
  console.log("[Withdraw Consignment API] Adding desk signature...");
  transaction.partialSign(deskKeypair);
  console.log("[Withdraw Consignment API] Desk signature added");

  // Verify all required signatures are present
  const deskSig = transaction.signatures.find((sig) =>
    sig.publicKey.equals(deskKeypair.publicKey),
  );
  const consignerSigFinal = transaction.signatures.find((sig) =>
    sig.publicKey.equals(consignerPubkey),
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

  const withdrawResponse = { success: true, signature };
  const validatedWithdrawResponse =
    SolanaWithdrawConsignmentResponseSchema.parse(withdrawResponse);
  return NextResponse.json(validatedWithdrawResponse);
}
