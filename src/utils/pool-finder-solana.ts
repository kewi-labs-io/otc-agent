import { Connection, PublicKey } from "@solana/web3.js";
import { getCoingeckoApiKey, getHeliusRpcUrl, getNetwork } from "@/config/env";
import { getCached, setCache } from "./retry-cache";

// Cache TTL for Solana pool info (30 seconds)
const SOLANA_POOL_CACHE_TTL_MS = 30_000;

// Cache for SOL price (60 seconds)
let cachedSolPrice: { price: number; timestamp: number } | null = null;
const SOL_PRICE_CACHE_TTL_MS = 60_000;

/**
 * Fetch SOL price from CoinGecko with API key support and caching
 * Falls back gracefully if rate limited
 */
async function fetchSolPriceUsd(): Promise<number> {
  // Check cache first
  if (
    cachedSolPrice &&
    Date.now() - cachedSolPrice.timestamp < SOL_PRICE_CACHE_TTL_MS
  ) {
    return cachedSolPrice.price;
  }

  const apiKey = getCoingeckoApiKey();
  const url = apiKey
    ? "https://pro-api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd"
    : "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd";

  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (apiKey) {
    headers["X-Cg-Pro-Api-Key"] = apiKey;
  }

  try {
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      // Rate limited - return cached price if available, otherwise use fallback
      if (cachedSolPrice) {
        console.warn(
          `[Pool Finder] CoinGecko rate limited (${response.status}), using cached SOL price: $${cachedSolPrice.price}`,
        );
        return cachedSolPrice.price;
      }
      // Fallback to a reasonable estimate (will be stale but better than crashing)
      console.warn(
        `[Pool Finder] CoinGecko rate limited (${response.status}), using fallback SOL price`,
      );
      return 125; // Approximate SOL price as fallback
    }

    const data = (await response.json()) as { solana?: { usd?: number } };
    if (!data.solana?.usd) {
      throw new Error("Invalid CoinGecko response - missing solana.usd");
    }

    // Update cache
    cachedSolPrice = { price: data.solana.usd, timestamp: Date.now() };
    return data.solana.usd;
  } catch {
    // On any error, try to use cached price
    if (cachedSolPrice) {
      console.warn(
        `[Pool Finder] CoinGecko error, using cached SOL price: $${cachedSolPrice.price}`,
      );
      return cachedSolPrice.price;
    }
    // Final fallback
    console.warn(`[Pool Finder] CoinGecko failed, using fallback SOL price`);
    return 125;
  }
}

// Rate limiting: delay between sequential RPC calls (ms)
const RPC_CALL_DELAY_MS = 500;

// Helper to delay between RPC calls
async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export interface SolanaPoolInfo {
  protocol: "Raydium" | "Meteora" | "Orca" | "PumpSwap";
  address: string;
  tokenA: string;
  tokenB: string;
  liquidity: number;
  tvlUsd: number;
  priceUsd?: number;
  baseToken: "SOL" | "USDC";
  // PumpSwap-specific vault addresses (for on-chain price updates)
  solVault?: string; // SOL vault account (lamports)
  tokenVault?: string; // Token vault account (SPL tokens)
}

const RAYDIUM_AMM_PROGRAM_MAINNET = new PublicKey(
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
);
const RAYDIUM_AMM_PROGRAM_DEVNET = new PublicKey(
  "HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8",
);

// PumpSwap AMM Program (same for mainnet/devnet) - for GRADUATED tokens
const PUMPSWAP_AMM_PROGRAM = new PublicKey(
  "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
);

// Pump.fun Bonding Curve Program - for UNBONDED tokens (original bonding curve)
const PUMPFUN_BONDING_CURVE_PROGRAM = new PublicKey(
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
);

// Meteora AMM Program (standard pools)
const METEORA_AMM_PROGRAM = new PublicKey(
  "Eo7WjKq67rjJQSZxS6z3YkapzY3eBj7eH5R8vMg6WP2r",
);

// Mainnet Mints
const USDC_MINT_MAINNET = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
);
const SOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

// Devnet Mints
const USDC_MINT_DEVNET = new PublicKey(
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
);

export async function findBestSolanaPool(
  tokenMint: string,
  cluster: "mainnet" | "devnet" = "mainnet",
  rpcConnection?: Connection,
): Promise<SolanaPoolInfo | null> {
  const cacheKey = `solana-pool:${cluster}:${tokenMint}`;

  // Check cache first
  const cached = getCached<SolanaPoolInfo | null>(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  // Use Helius for mainnet (via proxy on client, direct on server)
  const network = getNetwork();
  const rpcUrl =
    cluster === "mainnet"
      ? getHeliusRpcUrl() // Direct Helius (server-side only)
      : network === "local"
        ? "http://127.0.0.1:8899"
        : "https://api.devnet.solana.com";

  const connection = rpcConnection || new Connection(rpcUrl, "confirmed");
  const mint = new PublicKey(tokenMint);

  let pumpFunCurves: SolanaPoolInfo[] = [];
  let pumpSwapPools: SolanaPoolInfo[] = [];
  let raydiumPools: SolanaPoolInfo[] = [];
  let raydiumCpmmPools: SolanaPoolInfo[] = [];
  let meteoraPools: SolanaPoolInfo[] = [];

  // Strategy: Use Sequential execution by default to avoid 429 rate limits
  // Public RPCs are very restrictive, so sequential is more reliable

  // Try pump.fun bonding curve FIRST (for unbonded tokens)
  pumpFunCurves = await findPumpFunBondingCurve(connection, mint, cluster);
  await delay(RPC_CALL_DELAY_MS);

  // Then try PumpSwap AMM (for graduated tokens)
  pumpSwapPools = await findPumpSwapPools(connection, mint, cluster);
  await delay(RPC_CALL_DELAY_MS);

  // Then try Raydium
  await delay(RPC_CALL_DELAY_MS);
  raydiumPools = await findRaydiumPools(connection, mint, cluster);

  // Try Meteora pools (DLMM and standard AMM)
  await delay(RPC_CALL_DELAY_MS);
  meteoraPools = await findMeteoraPools(connection, mint, cluster);

  // Try Raydium CPMM pools (new constant product AMM)
  await delay(RPC_CALL_DELAY_MS);
  raydiumCpmmPools = await findRaydiumCpmmPools(connection, mint, cluster);

  const allPools = [
    ...pumpFunCurves,
    ...pumpSwapPools,
    ...raydiumPools,
    ...raydiumCpmmPools,
    ...meteoraPools,
  ];

  if (allPools.length === 0) {
    // Cache null result too
    setCache(cacheKey, null, SOLANA_POOL_CACHE_TTL_MS);
    return null;
  }

  // Sort by TVL descending, then by price (prefer pools with prices), then by liquidity
  allPools.sort((a, b) => {
    // Primary: TVL (higher is better)
    if (b.tvlUsd !== a.tvlUsd) {
      return b.tvlUsd - a.tvlUsd;
    }
    // Secondary: Prefer pools with non-zero prices
    const aHasPrice = (a.priceUsd ?? 0) > 0 ? 1 : 0;
    const bHasPrice = (b.priceUsd ?? 0) > 0 ? 1 : 0;
    if (bHasPrice !== aHasPrice) {
      return bHasPrice - aHasPrice;
    }
    // Tertiary: Liquidity amount
    return b.liquidity - a.liquidity;
  });

  const bestPool = allPools[0];

  // Log selection for debugging
  const priceDisplay =
    bestPool.priceUsd != null ? bestPool.priceUsd.toFixed(8) : "N/A";
  console.log(
    `[PoolFinder] Selected: ${bestPool.protocol} @ ${bestPool.address.slice(0, 8)}... (TVL: $${bestPool.tvlUsd.toFixed(2)}, Price: $${priceDisplay})`,
  );

  setCache(cacheKey, bestPool, SOLANA_POOL_CACHE_TTL_MS);
  return bestPool;
}

/**
 * Find pump.fun bonding curve for unbonded tokens
 * Bonding curve account is derived as PDA: [b"bonding-curve", mint]
 * Layout: https://github.com/nickshanks347/pumpfun-sdk
 */
async function findPumpFunBondingCurve(
  connection: Connection,
  mint: PublicKey,
  cluster: "mainnet" | "devnet",
): Promise<SolanaPoolInfo[]> {
  const pools: SolanaPoolInfo[] = [];

  // Derive bonding curve PDA
  const [bondingCurvePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), mint.toBuffer()],
    PUMPFUN_BONDING_CURVE_PROGRAM,
  );

  // Derive associated bonding curve token account
  const [associatedBondingCurve] = PublicKey.findProgramAddressSync(
    [
      bondingCurvePda.toBuffer(),
      new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").toBuffer(),
      mint.toBuffer(),
    ],
    new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
  );

  // Fetch bonding curve account
  const accountInfo = await connection.getAccountInfo(bondingCurvePda);
  if (!accountInfo || accountInfo.data.length < 41) {
    return [];
  }

  // Bonding curve layout (simplified):
  // offset 0: discriminator (8 bytes)
  // offset 8: virtual_token_reserves (u64) - 8 bytes
  // offset 16: virtual_sol_reserves (u64) - 8 bytes
  // offset 24: real_token_reserves (u64) - 8 bytes
  // offset 32: real_sol_reserves (u64) - 8 bytes
  // offset 40: complete (bool) - 1 byte
  const data = accountInfo.data;

  const virtualTokenReserves = data.readBigUInt64LE(8);
  const virtualSolReserves = data.readBigUInt64LE(16);
  // realTokenReserves at offset 24 - not used in price calculation
  const realSolReserves = data.readBigUInt64LE(32);
  const complete = data[40] === 1;

  // If complete, token has graduated to PumpSwap/Raydium
  if (complete) {
    console.log(
      `[PumpFun] Bonding curve ${bondingCurvePda.toBase58()} is complete (graduated)`,
    );
    return [];
  }

  // Calculate price using virtual reserves (pump.fun uses virtual AMM)
  // Price = virtualSolReserves / virtualTokenReserves
  const solReserves = Number(virtualSolReserves) / 1e9; // Convert lamports to SOL

  // Fetch token decimals from mint account (pump.fun uses 6, but verify)
  const mintInfo = await connection.getParsedAccountInfo(mint);
  if (!mintInfo.value) {
    throw new Error(`Mint account not found: ${mint.toBase58()}`);
  }
  if (!mintInfo.value.data || !("parsed" in mintInfo.value.data)) {
    throw new Error(`Mint account data is not parsed: ${mint.toBase58()}`);
  }
  const parsedData = mintInfo.value.data.parsed as {
    info?: { decimals?: number };
  };
  if (!parsedData.info || parsedData.info.decimals == null) {
    throw new Error(`Mint account missing decimals: ${mint.toBase58()}`);
  }
  const tokenDecimals = parsedData.info.decimals;

  const tokenReserves = Number(virtualTokenReserves) / 10 ** tokenDecimals;
  console.log(`[PumpFun] Token decimals: ${tokenDecimals}`);

  // Fetch real SOL price (cached, with API key support)
  const solPriceUsd = await fetchSolPriceUsd();

  const priceInSol = tokenReserves > 0 ? solReserves / tokenReserves : 0;
  const priceUsd = priceInSol * solPriceUsd;

  // TVL = real SOL reserves * 2 (both sides)
  const realSolAmount = Number(realSolReserves) / 1e9;
  const tvlUsd = realSolAmount * solPriceUsd * 2;

  console.log(
    `[PumpFun] Found bonding curve for ${mint.toBase58().slice(0, 8)}...`,
  );
  console.log(`  Token decimals: ${tokenDecimals}`);
  console.log(
    `  Raw virtual reserves: ${virtualTokenReserves.toString()} tokens / ${virtualSolReserves.toString()} lamports`,
  );
  console.log(
    `  Converted reserves: ${tokenReserves.toFixed(2)} tokens / ${solReserves.toFixed(4)} SOL`,
  );
  console.log(`  SOL price: $${solPriceUsd}`);
  console.log(`  Price in SOL: ${priceInSol.toFixed(10)}`);
  console.log(`  Price in USD: $${priceUsd.toFixed(8)}`);
  console.log(`  TVL: $${tvlUsd.toFixed(2)}`);

  pools.push({
    protocol: "PumpSwap", // Use PumpSwap as protocol since our on-chain handler supports it
    address: bondingCurvePda.toBase58(),
    tokenA: mint.toBase58(),
    tokenB: SOL_MINT.toBase58(),
    liquidity: realSolAmount,
    tvlUsd,
    priceUsd,
    baseToken: "SOL",
    // For pump.fun bonding curves:
    // - solVault is the bonding curve account itself (holds SOL)
    // - tokenVault is the associated token account
    solVault: bondingCurvePda.toBase58(),
    tokenVault: associatedBondingCurve.toBase58(),
  });

  return pools;
}

async function findPumpSwapPools(
  connection: Connection,
  mint: PublicKey,
  cluster: "mainnet" | "devnet",
): Promise<SolanaPoolInfo[]> {
  const pools: SolanaPoolInfo[] = [];
  const USDC_MINT =
    cluster === "mainnet" ? USDC_MINT_MAINNET : USDC_MINT_DEVNET;

  // PumpSwap pools use memcmp filters at offsets 43 (base_mint) and 75 (quote_mint)
  // Based on: https://github.com/AL-THE-BOT-FATHER/pump_swap_market_cap
  const mintBytes = mint.toBase58();

  // Try both directions: token as base, and token as quote
  const filtersBase = [
    { memcmp: { offset: 43, bytes: mintBytes } },
    { memcmp: { offset: 75, bytes: SOL_MINT.toBase58() } },
  ];

  const filtersQuote = [
    { memcmp: { offset: 75, bytes: mintBytes } },
    { memcmp: { offset: 43, bytes: SOL_MINT.toBase58() } },
  ];

  // Run sequentially to avoid rate limits
  const poolsBase = await connection.getProgramAccounts(PUMPSWAP_AMM_PROGRAM, {
    filters: filtersBase,
  });
  await delay(RPC_CALL_DELAY_MS);

  const poolsQuote = await connection.getProgramAccounts(PUMPSWAP_AMM_PROGRAM, {
    filters: filtersQuote,
  });

  const all = [
    ...(Array.isArray(poolsBase) ? poolsBase : []),
    ...(Array.isArray(poolsQuote) ? poolsQuote : []),
  ];

  // Process results
  // FAIL-FAST: Each account must be processed successfully
  for (const account of all) {
    const data = account.account.data;
    const readPubkey = (offset: number) =>
      new PublicKey(data.subarray(offset, offset + 32));

    // PumpSwap pool layout (from Python code):
    // offset 43: base_mint
    // offset 75: quote_mint
    // offset 139: pool_base_token_account
    // offset 171: pool_quote_token_account
    const baseMint = readPubkey(43);
    const quoteMint = readPubkey(75);
    const poolBaseTokenAccount = readPubkey(139);
    const poolQuoteTokenAccount = readPubkey(171);

    // PumpSwap typically pairs with WSOL (SOL)
    let baseToken: "SOL" | "USDC" | null = null;
    let otherMint: PublicKey | null = null;

    if (quoteMint.equals(USDC_MINT) || baseMint.equals(USDC_MINT)) {
      baseToken = "USDC";
      otherMint = baseMint.equals(USDC_MINT) ? quoteMint : baseMint;
    } else if (quoteMint.equals(SOL_MINT) || baseMint.equals(SOL_MINT)) {
      baseToken = "SOL";
      otherMint = baseMint.equals(SOL_MINT) ? quoteMint : baseMint;
    }

    if (baseToken && otherMint && otherMint.equals(mint)) {
      // Get token account balances sequentially to avoid rate limits
      let baseBalance: { value: { uiAmount: number | null } } = {
        value: { uiAmount: 0 },
      };
      let quoteBalance: { value: { uiAmount: number | null } } = {
        value: { uiAmount: 0 },
      };

      baseBalance =
        await connection.getTokenAccountBalance(poolBaseTokenAccount);
      await delay(RPC_CALL_DELAY_MS);

      quoteBalance = await connection.getTokenAccountBalance(
        poolQuoteTokenAccount,
      );
      await delay(RPC_CALL_DELAY_MS);

      // FAIL-FAST: Token account balances must be valid numbers
      if (baseBalance.value.uiAmount == null) {
        throw new Error(
          `Token account balance returned null for ${poolBaseTokenAccount.toBase58()}`,
        );
      }
      if (quoteBalance.value.uiAmount == null) {
        throw new Error(
          `Token account balance returned null for ${poolQuoteTokenAccount.toBase58()}`,
        );
      }
      const baseAmount = baseBalance.value.uiAmount;
      const quoteAmount = quoteBalance.value.uiAmount;

      // Determine SOL/USDC amount based on which mint is the base token
      // pool_base_token_account holds base_mint, pool_quote_token_account holds quote_mint
      const solOrUsdcAmount =
        baseMint.equals(SOL_MINT) || baseMint.equals(USDC_MINT)
          ? baseAmount // base_mint is SOL/USDC, so poolBaseTokenAccount holds it
          : quoteAmount; // quote_mint is SOL/USDC, so poolQuoteTokenAccount holds it

      // Fetch real SOL price for accurate calculations (cached, with API key support)
      const solPriceUsd = await fetchSolPriceUsd();

      // Calculate TVL: for SOL pairs, use SOL amount * price * 2 (both sides of pool)
      // For USDC pairs, use USDC amount * 2
      const tvlUsd =
        baseToken === "USDC"
          ? solOrUsdcAmount * 2 // USDC is 1:1 USD, pool has equal value on both sides
          : solOrUsdcAmount * solPriceUsd * 2;

      // Calculate Spot Price
      let priceUsd = 0;
      if (baseToken === "USDC") {
        const tokenAmount = baseMint.equals(USDC_MINT)
          ? quoteAmount
          : baseAmount;
        priceUsd = tokenAmount > 0 ? solOrUsdcAmount / tokenAmount : 0;
      } else {
        // Base is SOL. Price = SOL / Token * SolPrice
        const tokenAmount = baseMint.equals(SOL_MINT)
          ? quoteAmount
          : baseAmount;
        priceUsd =
          tokenAmount > 0 ? (solOrUsdcAmount / tokenAmount) * solPriceUsd : 0;
      }

      // Determine which vault is SOL and which is token
      // If baseMint is SOL/USDC, then poolBaseTokenAccount holds SOL/USDC
      const isSolBase = baseMint.equals(SOL_MINT);
      const isUsdcBase = baseMint.equals(USDC_MINT);

      // For price updates, we need the SOL vault and token vault
      // SOL vault: holds the SOL (lamports) - for SOL pairs
      // Token vault: holds the SPL tokens
      const solVault = isSolBase
        ? poolBaseTokenAccount.toBase58()
        : quoteMint.equals(SOL_MINT)
          ? poolQuoteTokenAccount.toBase58()
          : undefined;
      const tokenVault =
        isSolBase || isUsdcBase
          ? poolQuoteTokenAccount.toBase58()
          : poolBaseTokenAccount.toBase58();

      pools.push({
        protocol: "PumpSwap",
        address: account.pubkey.toBase58(),
        tokenA: baseMint.toBase58(),
        tokenB: quoteMint.toBase58(),
        liquidity: solOrUsdcAmount, // Base token (SOL/USDC) liquidity amount
        tvlUsd,
        priceUsd,
        baseToken,
        // PumpSwap-specific vault addresses for on-chain price updates
        solVault,
        tokenVault,
      });
    }
  }

  return pools;
}

async function findRaydiumPools(
  connection: Connection,
  mint: PublicKey,
  cluster: "mainnet" | "devnet",
): Promise<SolanaPoolInfo[]> {
  const pools: SolanaPoolInfo[] = [];
  const PROGRAM_ID =
    cluster === "mainnet"
      ? RAYDIUM_AMM_PROGRAM_MAINNET
      : RAYDIUM_AMM_PROGRAM_DEVNET;
  const USDC_MINT =
    cluster === "mainnet" ? USDC_MINT_MAINNET : USDC_MINT_DEVNET;

  // Alternative Strategy: Fetch multiple accounts in a batch if possible, or use getProgramAccounts with stricter filters
  // The public RPC nodes often block getProgramAccounts for large datasets like Raydium.
  // However, filtering by size (752) AND memcmp (mint at offset) is usually allowed as it's efficient.

  const filtersBase = [
    { dataSize: 752 },
    { memcmp: { offset: 400, bytes: mint.toBase58() } },
  ];

  const filtersQuote = [
    { dataSize: 752 },
    { memcmp: { offset: 432, bytes: mint.toBase58() } },
  ];

  // Run sequentially to avoid rate limits
  const poolsBase = await connection.getProgramAccounts(PROGRAM_ID, {
    filters: filtersBase,
  });
  await delay(RPC_CALL_DELAY_MS);

  const poolsQuote = await connection.getProgramAccounts(PROGRAM_ID, {
    filters: filtersQuote,
  });

  const all = [
    ...(Array.isArray(poolsBase) ? poolsBase : []),
    ...(Array.isArray(poolsQuote) ? poolsQuote : []),
  ];

  // Process results (same as before)
  for (const account of all) {
    const data = account.account.data;
    const readPubkey = (offset: number) =>
      new PublicKey(data.subarray(offset, offset + 32));

    const coinMint = readPubkey(400);
    const pcMint = readPubkey(432);

    let baseToken: "SOL" | "USDC" | null = null;
    let otherMint: PublicKey | null = null;

    if (coinMint.equals(USDC_MINT) || pcMint.equals(USDC_MINT)) {
      baseToken = "USDC";
      otherMint = coinMint.equals(USDC_MINT) ? pcMint : coinMint;
    } else if (coinMint.equals(SOL_MINT) || pcMint.equals(SOL_MINT)) {
      baseToken = "SOL";
      otherMint = coinMint.equals(SOL_MINT) ? pcMint : coinMint;
    }

    if (baseToken && otherMint && otherMint.equals(mint)) {
      // Raydium AMM v4 vault offsets (corrected)
      const coinVault = readPubkey(336);
      const pcVault = readPubkey(368);

      const vaultToCheck =
        baseToken === "USDC"
          ? coinMint.equals(USDC_MINT)
            ? coinVault
            : pcVault
          : coinMint.equals(SOL_MINT)
            ? coinVault
            : pcVault;

      let balance: { value: { uiAmount: number | null } } = {
        value: { uiAmount: 0 },
      };
      balance = await connection.getTokenAccountBalance(vaultToCheck);
      await delay(RPC_CALL_DELAY_MS);
      // FAIL-FAST: Token account balance must be valid
      if (
        balance.value.uiAmount === null ||
        balance.value.uiAmount === undefined
      ) {
        throw new Error(
          `Token account balance returned null for vault ${vaultToCheck.toBase58()}`,
        );
      }
      const amount = balance.value.uiAmount;

      // Fetch real SOL price for TVL and price calculations (cached, with API key support)
      const solPriceUsd = await fetchSolPriceUsd();

      const tvlUsd =
        baseToken === "USDC" ? amount * 2 : amount * solPriceUsd * 2;

      // Fetch the other vault to calculate price
      let priceUsd = 0;
      const otherVault =
        baseToken === "USDC"
          ? coinMint.equals(USDC_MINT)
            ? pcVault
            : coinVault
          : coinMint.equals(SOL_MINT)
            ? pcVault
            : coinVault;
      let otherBalance: { value: { uiAmount: number | null } } = {
        value: { uiAmount: 0 },
      };
      otherBalance = await connection.getTokenAccountBalance(otherVault);
      await delay(RPC_CALL_DELAY_MS);
      // FAIL-FAST: Token account balance must be valid
      if (otherBalance.value.uiAmount == null) {
        throw new Error(
          `Token account balance returned null for vault ${otherVault.toBase58()}`,
        );
      }
      const otherAmount = otherBalance.value.uiAmount;

      if (otherAmount > 0) {
        if (baseToken === "USDC") {
          priceUsd = amount / otherAmount;
        } else {
          priceUsd = (amount / otherAmount) * solPriceUsd;
        }
      }

      pools.push({
        protocol: "Raydium",
        address: account.pubkey.toBase58(),
        tokenA: coinMint.toBase58(),
        tokenB: pcMint.toBase58(),
        liquidity: amount,
        tvlUsd,
        priceUsd,
        baseToken,
      });
    }
  }

  return pools;
}

/**
 * Find Raydium CPMM (Constant Product Market Maker) pools
 * Uses DexScreener API for reliable pricing since CPMM layout is complex
 */
async function findRaydiumCpmmPools(
  connection: Connection,
  mint: PublicKey,
  cluster: "mainnet" | "devnet",
): Promise<SolanaPoolInfo[]> {
  const pools: SolanaPoolInfo[] = [];

  if (cluster !== "mainnet") {
    return [];
  }

  // Use DexScreener API to find pools for this token
  const mintStr = mint.toBase58();
  const response = await fetch(
    `https://api.dexscreener.com/latest/dex/tokens/${mintStr}`,
    { signal: AbortSignal.timeout(10000) },
  );

  if (!response.ok) {
    throw new Error(`DexScreener API error: ${response.status}`);
  }

  const data = await response.json();

  interface DexPair {
    chainId: string;
    dexId: string;
    pairAddress: string;
    baseToken: { address: string; symbol: string };
    quoteToken: { address: string; symbol: string };
    priceUsd: string;
    liquidity: { usd: number };
  }

  if (!data.pairs || !Array.isArray(data.pairs)) {
    return [];
  }

  // Filter for Raydium pools on Solana
  const raydiumPairs = (data.pairs as DexPair[]).filter(
    (p) => p.chainId === "solana" && p.dexId === "raydium",
  );

  for (const pair of raydiumPairs) {
    // Determine base token type
    let baseToken: "SOL" | "USDC" | null = null;
    const quoteAddr = pair.quoteToken.address;

    if (quoteAddr === SOL_MINT.toBase58()) {
      baseToken = "SOL";
    } else if (quoteAddr === USDC_MINT_MAINNET.toBase58()) {
      baseToken = "USDC";
    }

    if (!baseToken) continue;

    const priceUsd = parseFloat(pair.priceUsd);
    if (isNaN(priceUsd)) {
      throw new Error(`Invalid price value: ${pair.priceUsd}`);
    }
    if (!pair.liquidity) {
      throw new Error(
        `Raydium pair ${pair.pairAddress} missing liquidity field`,
      );
    }
    const tvlUsd = pair.liquidity.usd ?? 0;

    pools.push({
      protocol: "Raydium",
      address: pair.pairAddress,
      tokenA: pair.baseToken.address,
      tokenB: pair.quoteToken.address,
      liquidity: tvlUsd / 2 / (baseToken === "SOL" ? 125 : 1),
      tvlUsd,
      priceUsd,
      baseToken,
    });
  }

  return pools;
}

/**
 * Find Meteora DLMM and AMM pools for a token
 * Uses Meteora's public API for reliable pool discovery
 */
async function findMeteoraPools(
  connection: Connection,
  mint: PublicKey,
  cluster: "mainnet" | "devnet",
): Promise<SolanaPoolInfo[]> {
  const pools: SolanaPoolInfo[] = [];

  // Only search on mainnet (Meteora primarily operates on mainnet)
  if (cluster !== "mainnet") {
    return [];
  }

  const USDC_MINT = USDC_MINT_MAINNET;
  const mintStr = mint.toBase58();

  // Use Meteora's public API to find pools for this token
  // This is more reliable than parsing on-chain data for DLMM pools
  const apiUrl = `https://dlmm-api.meteora.ag/pair/all_by_groups?page=0&limit=10&search_term=${mintStr}`;

  const response = await fetch(apiUrl, {
    signal: AbortSignal.timeout(10000),
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Meteora API returned ${response.status}`);
  }

  const data = await response.json();

  // Also try the standard pairs endpoint (for completeness, but not currently used)
  const pairsUrl = `https://app.meteora.ag/amm/pools?token=${mintStr}`;
  const ammResponse = await fetch(pairsUrl, {
    signal: AbortSignal.timeout(5000),
  });
  // Note: ammResponse parsed but not used - kept for future expansion
  if (ammResponse.ok) {
    await ammResponse.json(); // consume response body
  }

  // Parse DLMM pools from API response
  interface MeteoraPool {
    address: string;
    name: string;
    mint_x: string;
    mint_y: string;
    reserve_x: string;
    reserve_y: string;
    reserve_x_amount: number;
    reserve_y_amount: number;
    bin_step: number;
    base_fee_percentage: string;
    liquidity: string;
    trade_volume_24h: number;
    fees_24h: number;
    current_price: number;
    apr: number;
    hide: boolean;
  }

  // FAIL-FAST: Validate API response structure
  if (!data) {
    throw new Error("Meteora API returned null or undefined response");
  }
  const dlmmPools: MeteoraPool[] = Array.isArray(data.groups)
    ? data.groups.flatMap((g: { pairs?: MeteoraPool[] }) => {
        if (!g.pairs || !Array.isArray(g.pairs)) {
          return [];
        }
        return g.pairs;
      })
    : Array.isArray(data.pairs)
      ? data.pairs
      : Array.isArray(data)
        ? data
        : [];

  // Fetch SOL price for TVL/price calculations (cached, with API key support)
  const solPriceUsd = await fetchSolPriceUsd();

  for (const pool of dlmmPools) {
    if (pool.hide) continue;

    const mintX = pool.mint_x;
    const mintY = pool.mint_y;

    // Check if this pool contains our target token
    const hasTargetToken = mintX === mintStr || mintY === mintStr;
    if (!hasTargetToken) continue;

    // Determine base token (SOL or USDC)
    let baseToken: "SOL" | "USDC" | null = null;
    if (mintX === SOL_MINT.toBase58() || mintY === SOL_MINT.toBase58()) {
      baseToken = "SOL";
    } else if (
      mintX === USDC_MINT.toBase58() ||
      mintY === USDC_MINT.toBase58()
    ) {
      baseToken = "USDC";
    }

    if (!baseToken) continue;

    // FAIL-FAST: MeteoraPool interface requires liquidity, current_price, and trade_volume_24h
    if (!pool.liquidity) {
      throw new Error(
        `Meteora pool ${pool.address} missing required liquidity field`,
      );
    }
    if (pool.current_price === undefined) {
      throw new Error(
        `Meteora pool ${pool.address} missing required current_price field`,
      );
    }
    if (pool.trade_volume_24h === undefined) {
      throw new Error(
        `Meteora pool ${pool.address} missing required trade_volume_24h field`,
      );
    }

    // Calculate TVL and price
    const liquidity = parseFloat(pool.liquidity);
    if (isNaN(liquidity) || liquidity < 0) {
      throw new Error(
        `Meteora pool ${pool.address} has invalid liquidity: ${pool.liquidity}`,
      );
    }
    // FAIL-FAST: Use liquidity directly (already validated above)
    // If liquidity is 0, that's a valid state (empty pool), not an error
    const tvlUsd = liquidity;

    // Current price from Meteora API (already in USD for most pairs)
    let priceUsd = pool.current_price;

    // If price seems like it's in SOL terms, convert to USD
    if (priceUsd > 0 && priceUsd < 0.01 && baseToken === "SOL") {
      // Small price likely in SOL, convert to USD
      priceUsd = priceUsd * solPriceUsd;
    }

    console.log(`[Meteora] Found DLMM pool: ${pool.name || pool.address}`);
    console.log(`  Address: ${pool.address}`);
    console.log(
      `  Base: ${baseToken}, Price: $${priceUsd.toFixed(8)}, TVL: $${tvlUsd.toFixed(2)}`,
    );

    pools.push({
      protocol: "Meteora",
      address: pool.address,
      tokenA: mintX,
      tokenB: mintY,
      liquidity: tvlUsd / 2 / (baseToken === "SOL" ? solPriceUsd : 1),
      tvlUsd,
      priceUsd,
      baseToken,
    });
  }

  // On-chain discovery for standard AMM pools if Meteora DLMM API didn't find anything
  // NOTE: This is pool DISCOVERY only - we identify that pools exist but don't fetch
  // liquidity/price data from on-chain (would require parsing full pool account layout).
  // These pools are returned with tvlUsd=0 to indicate "unverified liquidity".
  // Callers should filter by tvlUsd > 0 for actual trading or use Jupiter for price.
  if (pools.length === 0) {
    // Meteora AMM pool layout (simplified):
    // offset 0: discriminator (8)
    // offset 8: token_a_mint (32)
    // offset 40: token_b_mint (32)
    const filtersA = [{ memcmp: { offset: 8, bytes: mintStr } }];
    const filtersB = [{ memcmp: { offset: 40, bytes: mintStr } }];

    const poolsA = await connection.getProgramAccounts(METEORA_AMM_PROGRAM, {
      filters: filtersA,
    });
    await delay(RPC_CALL_DELAY_MS);

    const poolsB = await connection.getProgramAccounts(METEORA_AMM_PROGRAM, {
      filters: filtersB,
    });

    const allAmm = [...poolsA, ...poolsB];

    for (const account of allAmm) {
      const data = account.account.data;
      if (data.length < 72) continue;

      const tokenAMint = new PublicKey(data.subarray(8, 40));
      const tokenBMint = new PublicKey(data.subarray(40, 72));

      let baseToken: "SOL" | "USDC" | null = null;
      if (tokenAMint.equals(SOL_MINT) || tokenBMint.equals(SOL_MINT)) {
        baseToken = "SOL";
      } else if (tokenAMint.equals(USDC_MINT) || tokenBMint.equals(USDC_MINT)) {
        baseToken = "USDC";
      }

      if (!baseToken) continue;

      // IMPORTANT: liquidity/tvlUsd/priceUsd are 0 because we only discovered
      // the pool exists - we didn't parse the on-chain reserves.
      // Filter these out if you need verified liquidity.
      console.warn(
        `[Meteora] On-chain discovery found pool ${account.pubkey.toBase58()} - liquidity unverified`,
      );
      pools.push({
        protocol: "Meteora",
        address: account.pubkey.toBase58(),
        tokenA: tokenAMint.toBase58(),
        tokenB: tokenBMint.toBase58(),
        liquidity: 0, // Unverified - on-chain discovery only
        tvlUsd: 0, // Unverified - on-chain discovery only
        priceUsd: 0, // Unverified - use Jupiter for price
        baseToken,
      });
    }
  }

  return pools;
}
