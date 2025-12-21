import { NextResponse } from "next/server";
import { fetchNativePrices } from "@/utils/price-fetcher";
import { NativePricesResponseSchema } from "@/types/validation/api-schemas";

interface PriceData {
  price: number;
  timestamp: number;
}

// Simple in-memory cache for native prices
const priceCache: Record<string, PriceData> = {};
const CACHE_TTL = 60 * 1000; // 60 seconds

/**
 * GET /api/native-prices
 * Returns current prices for ETH, BNB, and SOL in USD
 */
export async function GET() {
  const now = Date.now();
  const prices: Record<string, number> = {};
  const toFetch: string[] = [];

  // Check cache for each currency
  for (const symbol of ["ETH", "BNB", "SOL"]) {
    const cached = priceCache[symbol];
    if (cached && now - cached.timestamp < CACHE_TTL) {
      prices[symbol] = cached.price;
    } else {
      toFetch.push(symbol);
    }
  }

  // Fetch missing prices using shared utility
  if (toFetch.length > 0) {
    const freshPrices = await fetchNativePrices(toFetch);

    for (const [symbol, price] of Object.entries(freshPrices)) {
      prices[symbol] = price;
      priceCache[symbol] = { price, timestamp: now };
    }
  }

  const validatedResponse = NativePricesResponseSchema.parse({ prices });
  return NextResponse.json(validatedResponse.prices, {
    headers: {
      "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
    },
  });
}
