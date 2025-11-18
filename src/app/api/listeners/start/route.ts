import { NextRequest, NextResponse } from 'next/server';
import { startBaseListener } from '@/services/token-registration-listener-base';
import { startSolanaListener } from '@/services/token-registration-listener-solana';

export async function POST(request: NextRequest) {
  try {
    const { chain } = await request.json();

    if (chain === 'base' || chain === 'all') {
      console.log('[API] Starting Base listener...');
      await startBaseListener();
    }

    if (chain === 'solana' || chain === 'all') {
      console.log('[API] Starting Solana listener...');
      await startSolanaListener();
    }

    return NextResponse.json({
      success: true,
      message: `Listeners started for: ${chain}`
    });

  } catch (error) {
    console.error('[API] Failed to start listeners:', error);
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
    message: 'Use POST /api/listeners/start with { chain: "base" | "solana" | "all" } to start listeners',
    example: {
      method: 'POST',
      body: { chain: 'all' }
    }
  });
}