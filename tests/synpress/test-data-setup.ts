/**
 * Test Data Setup for E2E Tests
 * 
 * Seeds elizaOS tokens and consignments for testing.
 * Run before E2E tests: bun tests/synpress/test-data-setup.ts
 * 
 * Token Addresses:
 * - EVM: 0xea17df5cf6d172224892b5477a16acb111182478
 * - Solana: DuMbhu7mvQvqQHGcnikDgb4XegXJRyhUBfdU22uELiZA
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:4444';

// elizaOS token addresses
const ELIZAOS_EVM = '0xea17df5cf6d172224892b5477a16acb111182478';
const ELIZAOS_SOLANA = 'DuMbhu7mvQvqQHGcnikDgb4XegXJRyhUBfdU22uELiZA';

// Test wallet addresses (from seed phrase: test test test...)
const TEST_EVM_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
// Phantom test wallet address derived from same seed
const TEST_SOLANA_ADDRESS = 'oeYf6KAJkLYhBuR8CiGc6L4D4Xtfepr85fuDgA9kq96';

interface TokenData {
  symbol: string;
  name: string;
  contractAddress: string;
  chain: string;
  decimals: number;
  logoUrl: string;
  description: string;
}

interface ConsignmentData {
  tokenId: string;
  consignerAddress: string;
  amount: string;
  isNegotiable: boolean;
  minDiscountBps: number;
  maxDiscountBps: number;
  minLockupDays: number;
  maxLockupDays: number;
  minDealAmount: string;
  maxDealAmount: string;
  isFractionalized: boolean;
  isPrivate: boolean;
  chain: string;
  tokenSymbol: string;
  tokenName: string;
  tokenDecimals: number;
  tokenAddress: string;
}

async function registerToken(token: TokenData): Promise<boolean> {
  try {
    const response = await fetch(`${BASE_URL}/api/tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(token),
    });
    
    const result = await response.json();
    if (response.ok || result.error?.includes('already')) {
      console.log(`✅ Token registered: ${token.symbol} on ${token.chain}`);
      return true;
    } else {
      console.log(`⚠️ Token registration: ${result.error || 'unknown error'}`);
      return true; // May already exist
    }
  } catch (error) {
    console.log(`⚠️ Token ${token.symbol}: may already exist or API error`);
    return true;
  }
}

async function createConsignment(consignment: ConsignmentData): Promise<boolean> {
  try {
    const response = await fetch(`${BASE_URL}/api/consignments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(consignment),
    });
    
    const result = await response.json();
    if (response.ok) {
      console.log(`✅ Consignment created: ${consignment.tokenSymbol} on ${consignment.chain}`);
      return true;
    } else {
      console.log(`⚠️ Consignment: ${result.error || 'may already exist'}`);
      return true;
    }
  } catch (error) {
    console.log(`⚠️ Consignment creation error for ${consignment.tokenSymbol}`);
    return false;
  }
}

async function checkApiHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${BASE_URL}/api/tokens`);
    return response.ok;
  } catch {
    return false;
  }
}

async function main() {
  console.log('\n🌱 Setting up E2E test data...\n');
  console.log(`   API: ${BASE_URL}`);
  console.log(`   EVM Token: ${ELIZAOS_EVM}`);
  console.log(`   Solana Token: ${ELIZAOS_SOLANA}`);
  console.log('');

  // Check API health
  const isHealthy = await checkApiHealth();
  if (!isHealthy) {
    console.log('❌ API is not responding. Start the server first: bun run dev');
    process.exit(1);
  }

  console.log('✅ API is healthy\n');

  // Register elizaOS tokens on multiple chains
  const tokens: TokenData[] = [
    {
      symbol: 'ELIZA',
      name: 'elizaOS',
      contractAddress: ELIZAOS_EVM,
      chain: 'base-mainnet',
      decimals: 18,
      logoUrl: '/tokens/eliza.svg',
      description: 'elizaOS token on Base',
    },
    {
      symbol: 'ELIZA',
      name: 'elizaOS',
      contractAddress: ELIZAOS_EVM,
      chain: 'bsc-mainnet',
      decimals: 18,
      logoUrl: '/tokens/eliza.svg',
      description: 'elizaOS token on BSC',
    },
    {
      symbol: 'ELIZA',
      name: 'elizaOS',
      contractAddress: ELIZAOS_EVM,
      chain: 'ethereum-mainnet',
      decimals: 18,
      logoUrl: '/tokens/eliza.svg',
      description: 'elizaOS token on Ethereum',
    },
    {
      symbol: 'ELIZA',
      name: 'elizaOS',
      contractAddress: ELIZAOS_SOLANA,
      chain: 'solana-mainnet',
      decimals: 9,
      logoUrl: '/tokens/eliza.svg',
      description: 'elizaOS token on Solana',
    },
  ];

  console.log('📝 Registering tokens...');
  for (const token of tokens) {
    await registerToken(token);
  }
  console.log('');

  // Create test consignments (listings) for each chain
  const consignments: ConsignmentData[] = [
    // Base listing
    {
      tokenId: `token-base-mainnet-${ELIZAOS_EVM.toLowerCase()}`,
      consignerAddress: TEST_EVM_ADDRESS,
      amount: '10000000000000000000000', // 10,000 tokens
      isNegotiable: true,
      minDiscountBps: 500, // 5%
      maxDiscountBps: 2000, // 20%
      minLockupDays: 7,
      maxLockupDays: 90,
      minDealAmount: '100000000000000000000', // 100 tokens
      maxDealAmount: '5000000000000000000000', // 5,000 tokens
      isFractionalized: true,
      isPrivate: false,
      chain: 'base-mainnet',
      tokenSymbol: 'ELIZA',
      tokenName: 'elizaOS',
      tokenDecimals: 18,
      tokenAddress: ELIZAOS_EVM,
    },
    // BSC listing
    {
      tokenId: `token-bsc-mainnet-${ELIZAOS_EVM.toLowerCase()}`,
      consignerAddress: TEST_EVM_ADDRESS,
      amount: '5000000000000000000000', // 5,000 tokens
      isNegotiable: true,
      minDiscountBps: 1000, // 10%
      maxDiscountBps: 2500, // 25%
      minLockupDays: 14,
      maxLockupDays: 180,
      minDealAmount: '50000000000000000000', // 50 tokens
      maxDealAmount: '2500000000000000000000', // 2,500 tokens
      isFractionalized: true,
      isPrivate: false,
      chain: 'bsc-mainnet',
      tokenSymbol: 'ELIZA',
      tokenName: 'elizaOS',
      tokenDecimals: 18,
      tokenAddress: ELIZAOS_EVM,
    },
    // Solana listing
    {
      tokenId: `token-solana-mainnet-${ELIZAOS_SOLANA.toLowerCase()}`,
      consignerAddress: TEST_SOLANA_ADDRESS,
      amount: '10000000000000', // 10,000 tokens (9 decimals)
      isNegotiable: true,
      minDiscountBps: 500, // 5%
      maxDiscountBps: 1500, // 15%
      minLockupDays: 7,
      maxLockupDays: 60,
      minDealAmount: '100000000000', // 100 tokens
      maxDealAmount: '5000000000000', // 5,000 tokens
      isFractionalized: true,
      isPrivate: false,
      chain: 'solana-mainnet',
      tokenSymbol: 'ELIZA',
      tokenName: 'elizaOS',
      tokenDecimals: 9,
      tokenAddress: ELIZAOS_SOLANA,
    },
  ];

  console.log('📋 Creating consignments (listings)...');
  for (const consignment of consignments) {
    await createConsignment(consignment);
  }

  console.log('\n✅ Test data setup complete!\n');
  console.log('   Run E2E tests with:');
  console.log('   npx playwright test --config=synpress.config.ts tests/synpress/elizaos-e2e.test.ts');
  console.log('   npx playwright test --config=synpress.config.ts tests/synpress/elizaos-solana.test.ts');
  console.log('');
}

main().catch((err) => {
  console.error('❌ Setup error:', err);
  process.exit(1);
});


