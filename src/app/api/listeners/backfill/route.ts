import { NextRequest, NextResponse } from 'next/server';
import { backfillBaseEvents } from '@/services/token-registration-listener-base';
import { backfillSolanaEvents } from '@/services/token-registration-listener-solana';

export async function POST(request: NextRequest) {
  try {
    const { chain, fromBlock, signatures } = await request.json();

    const results = {
      base: { success: false, events: 0, error: null },
      solana: { success: false, events: 0, error: null }
    };

    if (chain === 'base' || chain === 'all') {
      try {
        console.log('[API] Backfilling Base events...');
        const fromBlockNum = fromBlock ? BigInt(fromBlock) : undefined;
        await backfillBaseEvents(fromBlockNum);
        results.base.success = true;
        results.base.events = 0; // Events count would come from backfill function
      } catch (error) {
        results.base.error = error instanceof Error ? error.message : 'Unknown error';
        console.error('[API] Base backfill failed:', error);
      }
    }

    if (chain === 'solana' || chain === 'all') {
      try {
        console.log('[API] Backfilling Solana events...');
        const sigs = signatures || undefined;
        await backfillSolanaEvents(sigs);
        results.solana.success = true;
        results.solana.events = 0; // Events count would come from backfill function
      } catch (error) {
        results.solana.error = error instanceof Error ? error.message : 'Unknown error';
        console.error('[API] Solana backfill failed:', error);
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Backfill completed',
      results
    });

  } catch (error) {
    console.error('[API] Failed to backfill events:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'Use POST /api/listeners/backfill to backfill historical events',
    example: {
      method: 'POST',
      body: {
        chain: 'all',
        fromBlock: '12345678', // Optional: start block for Base
        signatures: ['sig1', 'sig2'] // Optional: specific Solana signatures
      }
    }
  });
}