"use client";

import { useEffect, useState } from "react";
import { ConsignmentCard } from "./consignment-card";
import type { OTCConsignment } from "@/services/database";

interface DealsGridProps {
  filters: {
    chain: string;
    minMarketCap: number;
    maxMarketCap: number;
    isNegotiable: string;
    isFractionalized: string;
  };
}

export function DealsGrid({ filters }: DealsGridProps) {
  const [consignments, setConsignments] = useState<OTCConsignment[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadConsignments() {
      setIsLoading(true);
      const params = new URLSearchParams();
      if (filters.chain !== "all") params.append("chain", filters.chain);
      if (filters.isNegotiable !== "all")
        params.append("isNegotiable", filters.isNegotiable);

      const response = await fetch(`/api/consignments?${params.toString()}`);
      const data = await response.json();

      if (data.success) {
        setConsignments(data.consignments || []);
      }
      setIsLoading(false);
    }

    loadConsignments();
  }, [filters]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-8">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div
            key={i}
            className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 animate-pulse"
          >
            <div className="h-12 bg-zinc-200 dark:bg-zinc-800 rounded mb-4"></div>
            <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded mb-2"></div>
            <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded w-3/4"></div>
          </div>
        ))}
      </div>
    );
  }

  if (consignments.length === 0) {
    return (
      <div className="text-center py-12 mt-8">
        <p className="text-zinc-600 dark:text-zinc-400">
          No OTC deals match your filters. Try adjusting the filters or be the
          first to list a deal.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-8">
      {consignments.map((consignment) => (
        <ConsignmentCard key={consignment.id} consignment={consignment} />
      ))}
    </div>
  );
}



