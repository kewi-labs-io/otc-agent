import pkg from "@coral-xyz/anchor";
import type { Program } from "@coral-xyz/anchor";
import type { Otc } from "../target/types/otc";
const anchor: any = pkg as any;
const { BN } = anchor;
import { PublicKey, SystemProgram, Keypair } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { expect } from "chai";

describe("otc flows", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = (anchor.workspace as any).Otc as Program<Otc>;

  const airdrop = async (pk: any, lamports: number) => {
    const sig = await provider.connection.requestAirdrop(pk, lamports);
    await provider.connection.confirmTransaction(sig, "confirmed");
  };

  let owner: Keypair;
  let agent: Keypair;
  let tokenMint: PublicKey;
  let usdcMint: PublicKey;
  let desk: PublicKey;
  let deskTokenTreasury: PublicKey;
  let deskUsdcTreasury: PublicKey;

  before(async () => {
    owner = Keypair.generate();
    await airdrop(owner.publicKey, 2e9);
    agent = Keypair.generate();
    await airdrop(agent.publicKey, 2e9);
    tokenMint = await createMint(provider.connection, owner, owner.publicKey, null, 9);
    usdcMint = await createMint(provider.connection, owner, owner.publicKey, null, 6);

    [desk] = PublicKey.findProgramAddressSync([Buffer.from("desk"), owner.publicKey.toBuffer()], program.programId);
    deskTokenTreasury = getAssociatedTokenAddressSync(tokenMint, desk, true);
    deskUsdcTreasury = getAssociatedTokenAddressSync(usdcMint, desk, true);
    await getOrCreateAssociatedTokenAccount(provider.connection, owner, tokenMint, desk, true);
    await getOrCreateAssociatedTokenAccount(provider.connection, owner, usdcMint, desk, true);

    await program.methods
      .initDesk(new BN(500000000), new BN("1000000000000000"), new BN(1800), new BN(0), new BN(365*24*3600))
      .accounts({ owner: owner.publicKey, agent: agent.publicKey, tokenMint, usdcMint, desk, deskTokenTreasury, deskUsdcTreasury, payer: owner.publicKey, systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID })
      .signers([owner])
      .rpc();

    await program.methods.setPrices(new BN(1_000_000_000), new BN(100_000_000_00), new BN(0), new BN(3600)).accounts({ desk, owner: owner.publicKey }).signers([owner]).rpc();

    // mint and deposit token inventory
    const ownerTokenAta = getAssociatedTokenAddressSync(tokenMint, owner.publicKey);
    await getOrCreateAssociatedTokenAccount(provider.connection, owner, tokenMint, owner.publicKey);
    await mintTo(provider.connection, owner, tokenMint, ownerTokenAta, owner, BigInt(1_000_000_000000000) as any);
    await program.methods.depositTokens(new BN("500000000000000")).accounts({ desk, owner: owner.publicKey, ownerTokenAta, deskTokenTreasury, tokenProgram: TOKEN_PROGRAM_ID }).signers([owner]).rpc();
  });

  it("USDC: create -> approve -> fulfill -> claim", async () => {
    const beneficiary = Keypair.generate();
    await airdrop(beneficiary.publicKey, 2e9);
    const deskAccount = await program.account.desk.fetch(desk);
    const id = new BN(deskAccount.nextOfferId.toString());
    const idBuf = Buffer.alloc(8);
    idBuf.writeBigUInt64LE(BigInt(id.toString()));
    const [offer] = PublicKey.findProgramAddressSync([Buffer.from("offer"), desk.toBuffer(), idBuf], program.programId);

    // ensure offer PDA doesn't exist yet in ledger (createOffer uses init_if_needed)
    const infoBefore1 = await provider.connection.getAccountInfo(offer);
    if (infoBefore1) {
      await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(owner.publicKey, 1e9), "confirmed");
      // do nothing, it will be overwritten
    }
    await program.methods
      .createOffer(id, new BN("1000000000"), 0, 1, new BN(0))
      .accountsStrict({ desk, deskTokenTreasury, beneficiary: beneficiary.publicKey, offer, systemProgram: SystemProgram.programId })
      .signers([beneficiary])
      .rpc();

    await program.methods.setApprover(beneficiary.publicKey, true).accounts({ desk, owner: owner.publicKey }).signers([owner]).rpc();
    await program.methods.approveOffer(id).accounts({ desk, offer, approver: beneficiary.publicKey }).signers([beneficiary]).rpc();

    const payerUsdc = await getOrCreateAssociatedTokenAccount(provider.connection, owner, usdcMint, beneficiary.publicKey);
    await mintTo(provider.connection, owner, usdcMint, payerUsdc.address, owner, BigInt(1_000_000_000) as any);
    await program.methods.fulfillOfferUsdc(id).accounts({ desk, offer, deskTokenTreasury, deskUsdcTreasury, payerUsdcAta: payerUsdc.address, payer: beneficiary.publicKey, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId }).signers([beneficiary]).rpc();

    const beneficiaryTokenAta = getAssociatedTokenAddressSync(tokenMint, beneficiary.publicKey);
    await getOrCreateAssociatedTokenAccount(provider.connection, owner, tokenMint, beneficiary.publicKey);
    await program.methods.claim(id).accounts({ desk, offer, deskTokenTreasury, beneficiaryTokenAta, beneficiary: beneficiary.publicKey, tokenProgram: TOKEN_PROGRAM_ID }).signers([beneficiary]).rpc();

    const bal = await provider.connection.getTokenAccountBalance(beneficiaryTokenAta);
    expect(parseInt(bal.value.amount)).to.be.greaterThan(0);
  });

  it("SOL: create -> approve -> fulfill -> claim", async () => {
    const user = Keypair.generate();
    await airdrop(user.publicKey, 2e9);
    const deskAccount2 = await program.account.desk.fetch(desk);
    const id2 = new BN(deskAccount2.nextOfferId.toString());
    const idBuf2 = Buffer.alloc(8);
    idBuf2.writeBigUInt64LE(BigInt(id2.toString()));
    const [offer] = PublicKey.findProgramAddressSync([Buffer.from("offer"), desk.toBuffer(), idBuf2], program.programId);

    const infoBefore2 = await provider.connection.getAccountInfo(offer);
    if (infoBefore2) {
      await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(owner.publicKey, 1e9), "confirmed");
    }
    await program.methods
      .createOffer(id2, new BN("500000000"), 0, 0, new BN(0))
      .accountsStrict({ desk, deskTokenTreasury, beneficiary: user.publicKey, offer, systemProgram: SystemProgram.programId })
      .signers([user])
      .rpc();
    await program.methods.setApprover(user.publicKey, true).accounts({ desk, owner: owner.publicKey }).signers([owner]).rpc();
    await program.methods.approveOffer(id2).accounts({ desk, offer, approver: user.publicKey }).signers([user]).rpc();

    await program.methods.fulfillOfferSol(id2).accounts({ desk, offer, deskTokenTreasury, payer: user.publicKey, systemProgram: SystemProgram.programId }).signers([user]).rpc();

    const userTokenAta = getAssociatedTokenAddressSync(tokenMint, user.publicKey);
    await getOrCreateAssociatedTokenAccount(provider.connection, owner, tokenMint, user.publicKey);
    await program.methods.claim(id2).accounts({ desk, offer, deskTokenTreasury, beneficiaryTokenAta: userTokenAta, beneficiary: user.publicKey, tokenProgram: TOKEN_PROGRAM_ID }).signers([user]).rpc();

    const bal = await provider.connection.getTokenAccountBalance(userTokenAta);
    expect(parseInt(bal.value.amount)).to.be.greaterThan(0);
  });
});


