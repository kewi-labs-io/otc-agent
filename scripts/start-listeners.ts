#!/usr/bin/env bun

/**
 * Listener Startup Script
 *
 * This script initializes blockchain event listeners for token registration.
 * It can be run manually or automatically during application startup.
 */

import { startBaseListener, backfillBaseEvents } from '../src/services/token-registration-listener-base';
import { startSolanaListener, backfillSolanaEvents } from '../src/services/token-registration-listener-solana';
import { getRegistrationHelperForChain, getSolanaConfig } from '../src/config/contracts';
import { getNetwork } from '../src/config/env';

async function main() {
  console.log('🚀 Starting token registration listeners...\n');

  const network = getNetwork();
  const registrationHelperBaseMainnet = getRegistrationHelperForChain(8453);
  const solana = getSolanaConfig(network);

  console.log('Config:');
  console.log(`  • network: ${network}`);
  console.log(
    `  • base RegistrationHelper (8453): ${registrationHelperBaseMainnet ?? '(not configured)'}`
  );
  console.log(`  • solana programId: ${solana.programId}`);
  console.log(`  • solana desk: ${solana.desk}`);
  console.log(`  • solana rpc: ${solana.rpc}`);
  console.log();

  // Start Base listener
  console.log('📡 Starting Base listener...');
  await startBaseListener();
  console.log('✅ Base listener started\n');

  // Start Solana listener
  console.log('📡 Starting Solana listener...');
  await startSolanaListener();
  console.log('✅ Solana listener started\n');

  console.log('🎯 All listeners initialized successfully!');
  console.log('\n📝 Available endpoints:');
  console.log('  • POST /api/listeners/start - Start specific listeners');
  console.log('  • POST /api/listeners/backfill - Backfill historical events');
  console.log('\n💡 Use Ctrl+C to stop all listeners');

  // Keep the process running
  process.on('SIGINT', () => {
    console.log('\n👋 Shutting down listeners...');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\n👋 Shutting down listeners...');
    process.exit(0);
  });
}

// Run if called directly
if (import.meta.main) {
  main().catch(console.error);
}

export default main;