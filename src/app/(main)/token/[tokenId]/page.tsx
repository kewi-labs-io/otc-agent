"use client";

import { useParams } from "next/navigation";
import dynamicImport from "next/dynamic";
import { useTokenCache, useMarketDataRefresh } from "@/hooks/useTokenCache";
import { PageLoading } from "@/components/ui/loading-spinner";

const Chat = dynamicImport(() => import("@/components/chat"), { ssr: false });

export const dynamic = "force-dynamic";

export default function TokenPage() {
  const params = useParams();
  const tokenId = params.tokenId as string;
  const {
    token,
    marketData: initialMarketData,
    isLoading: loading,
  } = useTokenCache(tokenId);
  const refreshedMarketData = useMarketDataRefresh(tokenId, token);
  const marketData = refreshedMarketData || initialMarketData;

  if (loading) {
    return (
      <PageLoading
        message="Loading token data..."
        colorClass="border-blue-600"
      />
    );
  }

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Token Not Found</h1>
          <p className="text-zinc-600 dark:text-zinc-400 mt-2">
            This token may not be registered yet.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <main className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 flex flex-col min-h-0 px-3 sm:px-4 md:px-6 py-3 sm:py-4">
          <div className="max-w-3xl mx-auto w-full flex-1 flex flex-col min-h-0">
            <Chat token={token} marketData={marketData} />
          </div>
        </div>
      </main>
    </div>
  );
}
