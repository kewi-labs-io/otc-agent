/**
 * Solana OTC Program Runtime E2E Test
 * 
 * Tests the complete Solana OTC flow:
 * 1. Initialize desk
 * 2. Create offer
 * 3. Approve offer
 * 4. Fulfill with SOL/USDC
 * 5. Claim tokens
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as anchor from '@coral-xyz/anchor';
import { Program, AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { 
  TOKEN_PROGRAM_ID, 
  getAssociatedTokenAddressSync, 
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo 
} from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';

const SOLANA_RPC = 'http://127.0.0.1:8899';
const TEST_TIMEOUT = 180000;

interface TestContext {
  provider?: AnchorProvider;
  program?: Program<any>;
  owner?: Keypair;
  agent?: Keypair;
  tokenMint?: PublicKey;
  usdcMint?: PublicKey;
  desk?: PublicKey;
  deskTokenTreasury?: PublicKey;
  deskUsdcTreasury?: PublicKey;
}

const ctx: TestContext = {};

async function airdrop(connection: Connection, pk: PublicKey, lamports: number) {
  const sig = await connection.requestAirdrop(pk, lamports);
  await connection.confirmTransaction(sig, 'confirmed');
}

describe('Solana OTC Program E2E Tests', () => {
  beforeAll(async () => {
    console.log('\n🔷 Solana Program E2E Test Setup\n');
    
    // Check if validator is running
    const connection = new Connection(SOLANA_RPC, 'confirmed');
    try {
      const version = await connection.getVersion();
      console.log(`✅ Solana validator connected (v${version['solana-core']})`);
    } catch (error) {
      console.error('❌ Solana validator not running');
      console.error('   Start with: npm run sol:validator');
      throw error;
    }

    // Load IDL
    const idlPath = path.join(
      process.cwd(),
      'solana/otc-program/target/idl/otc.json'
    );
    
    if (!fs.existsSync(idlPath)) {
      console.error('❌ IDL not found. Run: cd solana/otc-program && anchor build');
      throw new Error('IDL not found');
    }

    const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));
    console.log('✅ IDL loaded');

    // Load deployer key
    const keyPath = path.join(
      process.cwd(),
      'solana/otc-program/id.json'
    );
    const keyData = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
    const deployerKeypair = Keypair.fromSecretKey(Uint8Array.from(keyData));

    // Setup provider
    const wallet = new Wallet(deployerKeypair);
    ctx.provider = new AnchorProvider(connection, wallet, {
      commitment: 'confirmed',
    });
    anchor.setProvider(ctx.provider);

    // Get program
    const programId = new PublicKey(idl.address || idl.metadata?.address);
    ctx.program = new Program(idl, programId, ctx.provider);
    console.log(`✅ Program loaded: ${programId.toBase58()}\n`);

    // Generate test accounts
    ctx.owner = Keypair.generate();
    ctx.agent = Keypair.generate();
    
    console.log('💰 Airdropping SOL to test accounts...');
    await airdrop(connection, ctx.owner.publicKey, 2e9);
    await airdrop(connection, ctx.agent.publicKey, 2e9);
    console.log('✅ Test accounts funded\n');

    // Create mints
    console.log('🪙 Creating token mints...');
    ctx.tokenMint = await createMint(
      connection,
      ctx.owner,
      ctx.owner.publicKey,
      null,
      9 // 9 decimals for test token
    );
    console.log(`  Token mint: ${ctx.tokenMint.toBase58()}`);

    ctx.usdcMint = await createMint(
      connection,
      ctx.owner,
      ctx.owner.publicKey,
      null,
      6 // 6 decimals for USDC
    );
    console.log(`  USDC mint: ${ctx.usdcMint.toBase58()}\n`);

    // Find desk PDA
    const [deskPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('desk'), ctx.owner.publicKey.toBuffer()],
      ctx.program.programId
    );
    ctx.desk = deskPDA;

    // Get associated token accounts for desk
    ctx.deskTokenTreasury = getAssociatedTokenAddressSync(
      ctx.tokenMint,
      ctx.desk,
      true
    );
    ctx.deskUsdcTreasury = getAssociatedTokenAddressSync(
      ctx.usdcMint,
      ctx.desk,
      true
    );

    // Create ATAs
    await getOrCreateAssociatedTokenAccount(
      connection,
      ctx.owner,
      ctx.tokenMint,
      ctx.desk,
      true
    );
    await getOrCreateAssociatedTokenAccount(
      connection,
      ctx.owner,
      ctx.usdcMint,
      ctx.desk,
      true
    );

    console.log('📋 Initializing desk...');
    await ctx.program.methods
      .initDesk(
        new anchor.BN(500000000), // min $5 (8 decimals)
        new anchor.BN('1000000000000000'), // max tokens
        new anchor.BN(1800), // 30 min expiry
        new anchor.BN(0), // no default unlock
        new anchor.BN(365 * 24 * 3600) // max 1 year lockup
      )
      .accounts({
        owner: ctx.owner.publicKey,
        agent: ctx.agent.publicKey,
        tokenMint: ctx.tokenMint,
        usdcMint: ctx.usdcMint,
        desk: ctx.desk,
        deskTokenTreasury: ctx.deskTokenTreasury,
        deskUsdcTreasury: ctx.deskUsdcTreasury,
        payer: ctx.owner.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([ctx.owner])
      .rpc();

    console.log('✅ Desk initialized\n');

    // Set prices
    console.log('💱 Setting prices...');
    await ctx.program.methods
      .setPrices(
        new anchor.BN(10_000_000), // token price $0.10 (8d)
        new anchor.BN(100_000_000_00), // SOL price $100 (8d)
        new anchor.BN(Math.floor(Date.now() / 1000)),
        new anchor.BN(3600)
      )
      .accounts({
        desk: ctx.desk,
        owner: ctx.owner.publicKey,
      })
      .signers([ctx.owner])
      .rpc();

    console.log('✅ Prices set\n');

    // Mint and deposit tokens
    console.log('💰 Minting and depositing tokens to desk...');
    const ownerTokenAta = getAssociatedTokenAddressSync(
      ctx.tokenMint,
      ctx.owner.publicKey
    );
    await getOrCreateAssociatedTokenAccount(
      connection,
      ctx.owner,
      ctx.tokenMint,
      ctx.owner.publicKey
    );

    await mintTo(
      connection,
      ctx.owner,
      ctx.tokenMint,
      ownerTokenAta,
      ctx.owner,
      BigInt(1_000_000_000000000) as any
    );

    await ctx.program.methods
      .depositTokens(new anchor.BN('500000000000000'))
      .accounts({
        desk: ctx.desk,
        owner: ctx.owner.publicKey,
        ownerTokenAta,
        deskTokenTreasury: ctx.deskTokenTreasury,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([ctx.owner])
      .rpc();

    console.log('✅ Tokens deposited\n');
    console.log('═══════════════════════════════════════════════════════\n');
  }, TEST_TIMEOUT);

  it('should complete USDC payment flow', async () => {
    if (!ctx.program || !ctx.owner || !ctx.desk || !ctx.tokenMint || !ctx.usdcMint) {
      throw new Error('Test context not initialized');
    }

    console.log('📝 USDC Flow: create → approve → fulfill → claim\n');

    const beneficiary = Keypair.generate();
    await airdrop(ctx.provider!.connection, beneficiary.publicKey, 2e9);

    // Get next offer ID
    const deskAccount = await ctx.program.account.desk.fetch(ctx.desk);
    const offerId = new anchor.BN(deskAccount.nextOfferId.toString());
    
    console.log(`  Offer ID: ${offerId.toString()}`);

    // Derive offer PDA
    const idBuf = Buffer.alloc(8);
    idBuf.writeBigUInt64LE(BigInt(offerId.toString()));
    const [offer] = PublicKey.findProgramAddressSync(
      [Buffer.from('offer'), ctx.desk.toBuffer(), idBuf],
      ctx.program.programId
    );

    // Create offer
    console.log('  1️⃣  Creating offer...');
    await ctx.program.methods
      .createOffer(
        offerId,
        new anchor.BN('1000000000'), // 1 token
        0, // no discount for test
        1, // USDC currency
        new anchor.BN(0) // no lockup for test
      )
      .accountsStrict({
        desk: ctx.desk,
        deskTokenTreasury: ctx.deskTokenTreasury!,
        beneficiary: beneficiary.publicKey,
        offer,
        systemProgram: SystemProgram.programId,
      })
      .signers([beneficiary])
      .rpc();

    console.log('     ✅ Offer created');

    // Set approver and approve
    console.log('  2️⃣  Approving offer...');
    await ctx.program.methods
      .setApprover(beneficiary.publicKey, true)
      .accounts({
        desk: ctx.desk,
        owner: ctx.owner.publicKey,
      })
      .signers([ctx.owner])
      .rpc();

    await ctx.program.methods
      .approveOffer(offerId)
      .accounts({
        desk: ctx.desk,
        offer,
        approver: beneficiary.publicKey,
      })
      .signers([beneficiary])
      .rpc();

    console.log('     ✅ Offer approved');

    // Mint USDC to payer and fulfill
    console.log('  3️⃣  Fulfilling with USDC...');
    const payerUsdc = await getOrCreateAssociatedTokenAccount(
      ctx.provider!.connection,
      ctx.owner!,
      ctx.usdcMint,
      beneficiary.publicKey
    );

    await mintTo(
      ctx.provider!.connection,
      ctx.owner!,
      ctx.usdcMint,
      payerUsdc.address,
      ctx.owner!,
      BigInt(1_000_000_000) as any
    );

    await ctx.program.methods
      .fulfillOfferUsdc(offerId)
      .accounts({
        desk: ctx.desk,
        offer,
        deskTokenTreasury: ctx.deskTokenTreasury!,
        deskUsdcTreasury: ctx.deskUsdcTreasury!,
        payerUsdcAta: payerUsdc.address,
        payer: beneficiary.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([beneficiary])
      .rpc();

    console.log('     ✅ USDC payment complete');

    // Claim tokens
    console.log('  4️⃣  Claiming tokens...');
    const beneficiaryTokenAta = getAssociatedTokenAddressSync(
      ctx.tokenMint!,
      beneficiary.publicKey
    );
    await getOrCreateAssociatedTokenAccount(
      ctx.provider!.connection,
      ctx.owner!,
      ctx.tokenMint!,
      beneficiary.publicKey
    );

    await ctx.program.methods
      .claim(offerId)
      .accounts({
        desk: ctx.desk,
        offer,
        deskTokenTreasury: ctx.deskTokenTreasury!,
        beneficiaryTokenAta,
        beneficiary: beneficiary.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([beneficiary])
      .rpc();

    console.log('     ✅ Tokens claimed');

    // Verify balance
    const bal = await ctx.provider!.connection.getTokenAccountBalance(
      beneficiaryTokenAta
    );
    expect(parseInt(bal.value.amount)).toBeGreaterThan(0);

    console.log(`     ✅ Balance verified: ${bal.value.amount}\n`);
  }, TEST_TIMEOUT);

  it('should complete SOL payment flow', async () => {
    if (!ctx.program || !ctx.owner || !ctx.desk || !ctx.tokenMint) {
      throw new Error('Test context not initialized');
    }

    console.log('📝 SOL Flow: create → approve → fulfill → claim\n');

    const user = Keypair.generate();
    await airdrop(ctx.provider!.connection, user.publicKey, 2e9);

    // Get next offer ID
    const deskAccount = await ctx.program.account.desk.fetch(ctx.desk);
    const offerId = new anchor.BN(deskAccount.nextOfferId.toString());
    
    console.log(`  Offer ID: ${offerId.toString()}`);

    // Derive offer PDA
    const idBuf = Buffer.alloc(8);
    idBuf.writeBigUInt64LE(BigInt(offerId.toString()));
    const [offer] = PublicKey.findProgramAddressSync(
      [Buffer.from('offer'), ctx.desk.toBuffer(), idBuf],
      ctx.program.programId
    );

    // Create offer
    console.log('  1️⃣  Creating offer...');
    await ctx.program.methods
      .createOffer(
        offerId,
        new anchor.BN('500000000'), // 0.5 token
        0, // no discount
        0, // SOL currency
        new anchor.BN(0) // no lockup
      )
      .accountsStrict({
        desk: ctx.desk,
        deskTokenTreasury: ctx.deskTokenTreasury!,
        beneficiary: user.publicKey,
        offer,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    console.log('     ✅ Offer created');

    // Set approver and approve
    console.log('  2️⃣  Approving offer...');
    await ctx.program.methods
      .setApprover(user.publicKey, true)
      .accounts({
        desk: ctx.desk,
        owner: ctx.owner.publicKey,
      })
      .signers([ctx.owner])
      .rpc();

    await ctx.program.methods
      .approveOffer(offerId)
      .accounts({
        desk: ctx.desk,
        offer,
        approver: user.publicKey,
      })
      .signers([user])
      .rpc();

    console.log('     ✅ Offer approved');

    // Fulfill with SOL
    console.log('  3️⃣  Fulfilling with SOL...');
    await ctx.program.methods
      .fulfillOfferSol(offerId)
      .accounts({
        desk: ctx.desk,
        offer,
        deskTokenTreasury: ctx.deskTokenTreasury!,
        payer: user.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    console.log('     ✅ SOL payment complete');

    // Claim tokens
    console.log('  4️⃣  Claiming tokens...');
    const userTokenAta = getAssociatedTokenAddressSync(
      ctx.tokenMint!,
      user.publicKey
    );
    await getOrCreateAssociatedTokenAccount(
      ctx.provider!.connection,
      ctx.owner!,
      ctx.tokenMint!,
      user.publicKey
    );

    await ctx.program.methods
      .claim(offerId)
      .accounts({
        desk: ctx.desk,
        offer,
        deskTokenTreasury: ctx.deskTokenTreasury!,
        beneficiaryTokenAta: userTokenAta,
        beneficiary: user.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();

    console.log('     ✅ Tokens claimed');

    // Verify balance
    const bal = await ctx.provider!.connection.getTokenAccountBalance(
      userTokenAta
    );
    expect(parseInt(bal.value.amount)).toBeGreaterThan(0);

    console.log(`     ✅ Balance verified: ${bal.value.amount}\n`);
  }, TEST_TIMEOUT);
});


