"use client";
import "@/app/globals.css";

import { Suspense, useState } from "react";
import dynamic from "next/dynamic";
import { Footer } from "@/components/footer";

const DealsGrid = dynamic(
  () => import("@/components/deals-grid").then((m) => m.DealsGrid),
  { ssr: false },
);
const DealFilters = dynamic(
  () => import("@/components/deal-filters").then((m) => m.DealFilters),
  { ssr: false },
);

function MarketplaceContent() {
  const [filters, setFilters] = useState({
    chain: "all" as "all" | "ethereum" | "base" | "solana",
    minMarketCap: 0,
    maxMarketCap: 0,
    isNegotiable: "all" as "all" | "true" | "false",
    isFractionalized: "all" as "all" | "true" | "false",
  });

  return (
    <main className="flex-1 px-4 sm:px-6 py-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">OTC Marketplace</h1>
            <p className="text-zinc-600 dark:text-zinc-400 mt-2">
              Discover discounted token deals with flexible lockups
            </p>
          </div>
          <button
            onClick={() => (window.location.href = "/consign")}
            className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
          >
            List Your Tokens
          </button>
        </div>

        <DealFilters filters={filters} onFiltersChange={setFilters} />
        <DealsGrid filters={filters} />
      </div>
    </main>
  );
}

export default function Page() {
  return (
    <>
      <Suspense
        fallback={
          <div className="min-h-screen flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <div className="text-xl text-zinc-600 dark:text-zinc-400">
                Loading OTC Marketplace...
              </div>
            </div>
          </div>
        }
      >
        <MarketplaceContent />
      </Suspense>
      <Footer />
    </>
  );
}
