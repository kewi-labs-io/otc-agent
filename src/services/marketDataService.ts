import { z } from "zod";
import type { Chain } from "@/config/chains";
import { getBirdeyeApiKey, getCoingeckoApiKey } from "@/config/env";
import { parseOrThrow } from "@/lib/validation/helpers";
import {
  FetchMarketDataInputSchema,
  FetchTokenPriceInputSchema,
} from "@/types/validation/service-schemas";
import { MarketDataDB, type TokenMarketData } from "./database";

// Price sanity threshold: $1 billion - reject obviously manipulated prices
const MAX_SANE_PRICE_USD = 1_000_000_000;

// CoinGecko response validation schema
const CoinGeckoPriceDataSchema = z.object({
  usd: z.number().positive("Price must be positive"),
  usd_market_cap: z.number().nonnegative().optional(),
  usd_24h_vol: z.number().nonnegative().optional(),
  usd_24h_change: z.number().optional(),
});

const CoinGeckoPriceSchema = z.record(z.string(), CoinGeckoPriceDataSchema);

// Birdeye response validation schema
const BirdeyeResponseSchema = z.object({
  success: z.boolean().optional(),
  data: z.object({
    value: z.number().positive("Price must be positive"),
    updateUnixTime: z.number(),
    updateHumanTime: z.string().optional(),
    liquidity: z.number().nonnegative().optional().default(0),
    volume24h: z.number().nonnegative().optional().default(0),
    priceChange24hPercent: z.number().optional().default(0),
  }),
});

/**
 * Validate external API response with detailed error reporting
 */
function validateApiResponse<T>(schema: z.ZodSchema<T>, data: unknown, apiName: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const errors = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid ${apiName} response: ${errors}`);
  }
  return result.data;
}

/**
 * Validate price is within sane bounds to detect manipulation
 */
function validatePriceSanity(price: number, source: string): void {
  if (price > MAX_SANE_PRICE_USD) {
    throw new Error(`${source} price ${price} exceeds sanity threshold of ${MAX_SANE_PRICE_USD}`);
  }
  if (price < 0) {
    throw new Error(`${source} price ${price} is negative`);
  }
}

export class MarketDataService {
  private coingeckoApiKey?: string;
  private birdeyeApiKey?: string;

  constructor() {
    this.coingeckoApiKey = getCoingeckoApiKey();
    this.birdeyeApiKey = getBirdeyeApiKey();
  }

  async fetchTokenPrice(tokenAddress: string, chain: Chain): Promise<number> {
    parseOrThrow(FetchTokenPriceInputSchema, { tokenAddress, chain });
    const marketData = await this.fetchMarketData(tokenAddress, chain);
    return marketData.priceUsd;
  }

  async fetchMarketData(tokenAddress: string, chain: Chain): Promise<TokenMarketData> {
    parseOrThrow(FetchMarketDataInputSchema, { tokenAddress, chain });
    if (chain === "solana") {
      return await this.fetchSolanaData(tokenAddress);
    }
    return await this.fetchEVMData(tokenAddress, chain);
  }

  private async fetchEVMData(tokenAddress: string, chain: Chain): Promise<TokenMarketData> {
    // Map chain to CoinGecko platform ID
    const platformId =
      chain === "bsc" ? "binance-smart-chain" : chain === "base" ? "base" : "ethereum";
    const url = this.coingeckoApiKey
      ? `https://pro-api.coingecko.com/api/v3/simple/token_price/${platformId}?contract_addresses=${tokenAddress}&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true`
      : `https://api.coingecko.com/api/v3/simple/token_price/${platformId}?contract_addresses=${tokenAddress}&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true`;

    const headers: Record<string, string> = {
      Accept: "application/json",
    };

    if (this.coingeckoApiKey) {
      headers["X-Cg-Pro-Api-Key"] = this.coingeckoApiKey;
    }

    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`CoinGecko API error: ${response.status}`);

    const rawData: unknown = await response.json();
    const data = validateApiResponse(CoinGeckoPriceSchema, rawData, "CoinGecko");

    const tokenData = data[tokenAddress.toLowerCase()];
    if (!tokenData) throw new Error("Token data not found");

    // Validate price sanity to detect manipulation
    validatePriceSanity(tokenData.usd, "CoinGecko");

    return {
      tokenId: `token-${chain}-${tokenAddress.toLowerCase()}`,
      priceUsd: tokenData.usd,
      marketCap: tokenData.usd_market_cap ?? 0,
      volume24h: tokenData.usd_24h_vol ?? 0,
      priceChange24h: tokenData.usd_24h_change ?? 0,
      liquidity: 0,
      lastUpdated: Date.now(),
    };
  }

  private async fetchSolanaData(tokenAddress: string): Promise<TokenMarketData> {
    // Solana addresses are Base58 encoded and case-sensitive - preserve original case
    if (!this.birdeyeApiKey) {
      const { getSolanaConfig } = await import("@/config/contracts");
      const solanaRpc = getSolanaConfig().rpc;
      const isLocalnet = solanaRpc.includes("127.0.0.1") || solanaRpc.includes("localhost");

      if (isLocalnet) {
        // LOCALNET ONLY: Return zeros to indicate "price unknown from off-chain source"
        // For Solana OTC, the authoritative price is set on-chain via:
        //   - desk.token_usd_price_8d (set by set_prices instruction)
        // This market data is NOT used for pricing - only for UI display
        console.warn(
          `[MarketDataService] Solana localnet: No Birdeye API key. Price data unavailable for ${tokenAddress}`,
        );
        return {
          tokenId: `token-solana-${tokenAddress}`,
          priceUsd: 0, // 0 = unknown (on-chain price is authoritative)
          marketCap: 0,
          volume24h: 0,
          priceChange24h: 0,
          liquidity: 0,
          lastUpdated: Date.now(),
        };
      }
      throw new Error("BIRDEYE_API_KEY required for Solana token pricing on devnet/mainnet");
    }

    const url = `https://public-api.birdeye.so/defi/price?address=${tokenAddress}`;
    const response = await fetch(url, {
      headers: {
        "X-API-KEY": this.birdeyeApiKey,
        Accept: "application/json",
      },
    });

    if (!response.ok) throw new Error(`Birdeye API error: ${response.status}`);

    const rawData: unknown = await response.json();
    const data = validateApiResponse(BirdeyeResponseSchema, rawData, "Birdeye");

    // Validate price sanity to detect manipulation
    validatePriceSanity(data.data.value, "Birdeye");

    return {
      tokenId: `token-solana-${tokenAddress}`,
      priceUsd: data.data.value,
      marketCap: data.data.value * data.data.liquidity,
      volume24h: data.data.volume24h,
      priceChange24h: data.data.priceChange24hPercent,
      liquidity: data.data.liquidity,
      lastUpdated: Date.now(),
    };
  }

  async refreshTokenData(tokenId: string, tokenAddress: string, chain: Chain): Promise<void> {
    parseOrThrow(
      z.object({
        tokenId: z.string().min(1),
        tokenAddress: z.string().min(1),
        chain: z.enum(["ethereum", "base", "bsc", "solana"]),
      }),
      { tokenId, tokenAddress, chain },
    );
    const marketData = await this.fetchMarketData(tokenAddress, chain);
    await MarketDataDB.setMarketData(marketData);
  }

  async refreshAllTokenData(
    tokens: Array<{ id: string; contractAddress: string; chain: Chain }>,
  ): Promise<void> {
    await Promise.all(
      tokens.map((token) => this.refreshTokenData(token.id, token.contractAddress, token.chain)),
    );
  }
}
