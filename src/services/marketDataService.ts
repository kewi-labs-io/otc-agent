import { MarketDataDB, type TokenMarketData } from "./database";
import type { Chain } from "@/config/chains";
import { getCoingeckoApiKey, getBirdeyeApiKey } from "@/config/env";
import { parseOrThrow } from "@/lib/validation/helpers";
import {
  FetchTokenPriceInputSchema,
  FetchMarketDataInputSchema,
} from "@/types/validation/service-schemas";
import { z } from "zod";

interface CoinGeckoPrice {
  [key: string]: {
    usd: number;
    usd_market_cap: number;
    usd_24h_vol: number;
    usd_24h_change: number;
  };
}

interface BirdeyeResponse {
  data: {
    value: number;
    updateUnixTime: number;
    liquidity: number;
    volume24h: number;
    priceChange24hPercent: number;
  };
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

  async fetchMarketData(
    tokenAddress: string,
    chain: Chain,
  ): Promise<TokenMarketData> {
    parseOrThrow(FetchMarketDataInputSchema, { tokenAddress, chain });
    if (chain === "solana") {
      return await this.fetchSolanaData(tokenAddress);
    }
    return await this.fetchEVMData(tokenAddress, chain);
  }

  private async fetchEVMData(
    tokenAddress: string,
    chain: Chain,
  ): Promise<TokenMarketData> {
    // Map chain to CoinGecko platform ID
    const platformId =
      chain === "bsc"
        ? "binance-smart-chain"
        : chain === "base"
          ? "base"
          : "ethereum";
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
    if (!response.ok)
      throw new Error(`CoinGecko API error: ${response.status}`);

    const data: CoinGeckoPrice = await response.json();
    const tokenData = data[tokenAddress.toLowerCase()];
    if (!tokenData) throw new Error("Token data not found");

    return {
      tokenId: `token-${chain}-${tokenAddress.toLowerCase()}`,
      priceUsd: tokenData.usd,
      marketCap: tokenData.usd_market_cap,
      volume24h: tokenData.usd_24h_vol,
      priceChange24h: tokenData.usd_24h_change,
      liquidity: 0,
      lastUpdated: Date.now(),
    };
  }

  private async fetchSolanaData(
    tokenAddress: string,
  ): Promise<TokenMarketData> {
    // Solana addresses are Base58 encoded and case-sensitive - preserve original case
    // In local development without Birdeye, return mock data
    // The actual price comes from on-chain (desk.token_usd_price_8d)
    if (!this.birdeyeApiKey) {
      const { getSolanaConfig } = await import("@/config/contracts");
      const solanaRpc = getSolanaConfig().rpc;
      const isLocalnet =
        solanaRpc.includes("127.0.0.1") || solanaRpc.includes("localhost");

      if (isLocalnet) {
        // Return placeholder data for localnet - actual price from on-chain
        return {
          tokenId: `token-solana-${tokenAddress}`,
          priceUsd: 1.0, // Default $1, actual price set on-chain via set_prices
          marketCap: 1000000,
          volume24h: 10000,
          priceChange24h: 0,
          liquidity: 100000,
          lastUpdated: Date.now(),
        };
      }
      throw new Error(
        "BIRDEYE_API_KEY required for Solana token pricing on devnet/mainnet",
      );
    }

    const url = `https://public-api.birdeye.so/defi/price?address=${tokenAddress}`;
    const response = await fetch(url, {
      headers: {
        "X-API-KEY": this.birdeyeApiKey,
        Accept: "application/json",
      },
    });

    if (!response.ok) throw new Error(`Birdeye API error: ${response.status}`);

    const data: BirdeyeResponse = await response.json();

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

  async refreshTokenData(
    tokenId: string,
    tokenAddress: string,
    chain: Chain,
  ): Promise<void> {
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
      tokens.map((token) =>
        this.refreshTokenData(token.id, token.contractAddress, token.chain),
      ),
    );
  }
}
