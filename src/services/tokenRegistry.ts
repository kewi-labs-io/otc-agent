import type { Chain } from "@/config/chains";
import { parseOrThrow } from "@/lib/validation/helpers";
import { RegisterTokenInputSchema } from "@/types/validation/service-schemas";
import { MarketDataDB, type Token, TokenDB, type TokenMarketData } from "./database";

export class TokenRegistryService {
  async registerToken(params: {
    symbol: string;
    name: string;
    contractAddress: string;
    chain: Chain;
    decimals: number;
    logoUrl?: string;
    description?: string;
    website?: string;
    twitter?: string;
    // Pool address for price feeds - stored at registration to avoid re-searching
    poolAddress?: string;
    // For Solana PumpSwap pools, store vault addresses
    solVault?: string;
    tokenVault?: string;
  }): Promise<Token> {
    parseOrThrow(RegisterTokenInputSchema, params);
    // EVM addresses can be lowercased (case-insensitive)
    // Solana addresses are Base58 encoded and MUST preserve case
    const normalizedAddress =
      params.chain === "solana" ? params.contractAddress : params.contractAddress.toLowerCase();

    const token = await TokenDB.createToken({
      symbol: params.symbol.toUpperCase(),
      name: params.name,
      contractAddress: normalizedAddress,
      chain: params.chain,
      decimals: params.decimals,
      logoUrl: params.logoUrl || "",
      description: params.description || "",
      website: params.website,
      twitter: params.twitter,
      isActive: true,
      // Store pool info for price updates
      poolAddress: params.poolAddress,
      solVault: params.solVault,
      tokenVault: params.tokenVault,
    });
    return token;
  }

  async getToken(tokenId: string): Promise<Token> {
    return await TokenDB.getToken(tokenId);
  }

  async getAllTokens(filters?: {
    chain?: Chain;
    isActive?: boolean;
    minMarketCap?: number;
    maxMarketCap?: number;
  }): Promise<Token[]> {
    let tokens = await TokenDB.getAllTokens({
      chain: filters?.chain,
      isActive: filters?.isActive,
    });

    if (filters && (filters.minMarketCap || filters.maxMarketCap)) {
      const tokensWithMarketData = await Promise.all(
        tokens.map(async (token) => {
          const marketData = await MarketDataDB.getMarketData(token.id);
          return { token, marketData };
        }),
      );

      tokens = tokensWithMarketData
        .filter(({ marketData }) => {
          if (!marketData) return false;
          if (filters.minMarketCap && marketData.marketCap < filters.minMarketCap) return false;
          if (filters.maxMarketCap && marketData.marketCap > filters.maxMarketCap) return false;
          return true;
        })
        .map(({ token }) => token);
    }

    return tokens;
  }

  async updateTokenStatus(tokenId: string, isActive: boolean): Promise<Token> {
    return await TokenDB.updateToken(tokenId, { isActive });
  }

  async updateToken(tokenId: string, updates: Partial<Token>): Promise<Token> {
    return await TokenDB.updateToken(tokenId, updates);
  }

  async getTokenMarketData(tokenId: string): Promise<TokenMarketData | null> {
    return await MarketDataDB.getMarketData(tokenId);
  }

  async setTokenMarketData(data: TokenMarketData): Promise<void> {
    await MarketDataDB.setMarketData(data);
  }
}
