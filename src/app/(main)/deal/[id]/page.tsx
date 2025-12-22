"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import { DealCompletion } from "@/components/deal-completion";
import { PageLoading } from "@/components/ui/loading-spinner";
import { useExecutedQuote } from "@/hooks/useQuote";

// Force dynamic rendering for this route
export const dynamic = "force-dynamic";

export default function DealPage() {
  const params = useParams();
  const router = useRouter();
  const quoteId = params.id as string | undefined;

  // Use React Query hook - handles caching, retries, and deduplication
  const { quote, isLoading, error } = useExecutedQuote(quoteId);

  // Redirect if no quoteId provided
  useEffect(() => {
    if (!quoteId) {
      router.push("/");
    }
  }, [quoteId, router]);

  if (isLoading) {
    return <PageLoading message="Loading your deal..." colorClass="border-green-500" />;
  }

  if (error || !quote) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 mb-2">
            Deal Not Found
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            This deal may have expired or doesn&apos;t exist.
          </p>
        </div>
      </div>
    );
  }

  return <DealCompletion quote={quote} />;
}
