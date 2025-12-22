import { promises as fs } from "node:fs";
import path from "node:path";
import * as anchor from "@coral-xyz/anchor";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import { type NextRequest, NextResponse } from "next/server";
import { getSolanaConfig } from "@/config/contracts";
import { getHeliusRpcUrl, getNetwork } from "@/config/env";
import { validationErrorResponse } from "@/lib/validation/helpers";
import {
  SolanaClaimRequestSchema,
  SolanaClaimResponseSchema,
} from "@/types/validation/api-schemas";
import { createAnchorWallet, loadDeskKeypair } from "@/utils/solana-keypair";
import { getTokenProgramId } from "@/utils/solana-otc";

export async function POST(request: NextRequest) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate request body - return 400 on invalid params
  const parseResult = SolanaClaimRequestSchema.safeParse(body);
  if (!parseResult.success) {
    return validationErrorResponse(parseResult.error, 400);
  }
  const data = parseResult.data;

  const { offerAddress, beneficiary } = data;

  // Get Solana config from deployment
  const network = getNetwork();
  const solanaConfig = getSolanaConfig();
  const SOLANA_RPC = network === "local" ? "http://127.0.0.1:8899" : getHeliusRpcUrl();
  const SOLANA_DESK = solanaConfig.desk;

  if (!SOLANA_DESK) {
    return NextResponse.json(
      { error: "SOLANA_DESK not configured in deployment" },
      { status: 500 },
    );
  }

  console.log(`[Solana Claim API] Using Helius RPC`);

  // Load desk keypair (supports env var and file-based)
  const deskKeypair = await loadDeskKeypair();
  const desk = new PublicKey(SOLANA_DESK);

  // Verify desk keypair matches expected desk public key
  if (!deskKeypair.publicKey.equals(desk)) {
    console.error(
      "[Solana Claim API] Desk keypair mismatch. Expected:",
      SOLANA_DESK,
      "Got:",
      deskKeypair.publicKey.toBase58(),
    );
    return NextResponse.json({ error: "Desk keypair mismatch" }, { status: 500 });
  }

  // Load IDL
  const idlPath = path.join(process.cwd(), "solana/otc-program/target/idl/otc.json");
  const idl = JSON.parse(await fs.readFile(idlPath, "utf8"));

  const connection = new Connection(SOLANA_RPC, "confirmed");

  const wallet = createAnchorWallet(deskKeypair);

  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const program = new anchor.Program(idl, provider);

  interface OfferAccountProgram {
    offer: {
      fetch: (pubkey: PublicKey) => Promise<{
        fulfilled: boolean;
        paid: boolean;
        tokenMint: PublicKey;
        unlockTime: number;
        id: { toString(): string };
      }>;
    };
  }

  const programAccounts = program.account as OfferAccountProgram;
  const offer = new PublicKey(offerAddress);

  let offerData;
  try {
    offerData = await programAccounts.offer.fetch(offer);
  } catch (err) {
    // Handle "Invalid account discriminator" and other fetch errors
    const message = err instanceof Error ? err.message : String(err);
    if (
      message.includes("Invalid account discriminator") ||
      message.includes("Account does not exist")
    ) {
      return NextResponse.json(
        {
          error: `Offer not found or invalid: ${offerAddress}. The offer may not exist or may have been closed.`,
        },
        { status: 404 },
      );
    }
    console.error("[Solana Claim API] Error fetching offer:", message);
    return NextResponse.json({ error: `Failed to fetch offer: ${message}` }, { status: 500 });
  }

  // Check offer state
  if (!offerData) {
    return NextResponse.json({ error: `Offer account is empty: ${offerAddress}` }, { status: 404 });
  }

  if (offerData.fulfilled) {
    const alreadyClaimedResponse = {
      success: true,
      alreadyClaimed: true,
      message: "Offer already claimed",
    };
    const validatedAlreadyClaimed = SolanaClaimResponseSchema.parse(alreadyClaimedResponse);
    return NextResponse.json(validatedAlreadyClaimed);
  }

  if (!offerData.paid) {
    return NextResponse.json(
      { error: "Offer not paid yet - cannot claim tokens before payment" },
      { status: 400 },
    );
  }

  // FAIL-FAST: Verify token mint exists
  if (!offerData.tokenMint) {
    return NextResponse.json(
      { error: "Offer missing tokenMint - data corruption" },
      { status: 500 },
    );
  }

  const now = Math.floor(Date.now() / 1000);
  if (now < offerData.unlockTime) {
    console.log(`[Solana Claim] Lockup not expired yet. Will auto-claim at unlock time.`);
    return NextResponse.json(
      {
        success: true,
        scheduled: true,
        message: "Tokens will be automatically distributed after lockup expires",
        unlockTime: offerData.unlockTime,
        secondsRemaining: offerData.unlockTime - now,
      },
      { status: 200 },
    );
  }

  // Get token accounts - use offer.tokenMint for multi-token support
  // In token-agnostic architecture, each offer stores its own token_mint
  const tokenMint = new PublicKey(offerData.tokenMint);

  // Detect token program (Token or Token-2022)
  const tokenProgramId = await getTokenProgramId(connection, tokenMint);
  console.log(`[Solana Claim] Using token program: ${tokenProgramId.toString()}`);

  const deskTokenTreasury = await getAssociatedTokenAddress(tokenMint, desk, true, tokenProgramId);
  const beneficiaryPk = new PublicKey(beneficiary);
  const beneficiaryTokenAta = await getAssociatedTokenAddress(
    tokenMint,
    beneficiaryPk,
    false,
    tokenProgramId,
  );

  // Claim tokens (desk signs because it holds the tokens)
  const tx = await program.methods
    .claim(new anchor.BN(offerData.id))
    .accounts({
      desk,
      deskSigner: deskKeypair.publicKey,
      offer,
      tokenMint, // Required for TransferChecked
      deskTokenTreasury,
      beneficiaryTokenAta,
      beneficiary: beneficiaryPk,
      tokenProgram: tokenProgramId, // Token or Token-2022
    })
    .signers([deskKeypair])
    .rpc();

  console.log(`[Solana Claim] ✅ Claimed ${offerAddress}, tx: ${tx}`);

  const claimResponse = {
    success: true,
    tx,
    offerAddress,
    beneficiary,
  };
  const validatedClaimResponse = SolanaClaimResponseSchema.parse(claimResponse);
  return NextResponse.json(validatedClaimResponse);
}
