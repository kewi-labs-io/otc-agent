"use client";

import { ConsignmentRow } from "./consignment-row";
import { Button } from "./button";
import type { OTCConsignment } from "@/services/database";

interface MyListingsTabProps {
  listings: OTCConsignment[];
}

export function MyListingsTab({ listings }: MyListingsTabProps) {
  if (listings.length === 0) {
    return (
      <div className="text-center py-12">
        <h3 className="text-lg font-semibold mb-2">No Active Listings</h3>
        <p className="text-zinc-600 dark:text-zinc-400 mb-6">
          Create a listing to start selling your tokens via OTC
        </p>
        <Button onClick={() => (window.location.href = "/consign")}>
          Create Listing
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold">My Token Listings</h2>
        <Button className="bg-orange-500 hover:bg-orange-600 !px-4 !py-2" onClick={() => (window.location.href = "/consign")}>
          Create New Listing
        </Button>
      </div>

      <div className="space-y-4">
        {listings.map((consignment) => (
          <ConsignmentRow key={consignment.id} consignment={consignment} />
        ))}
      </div>
    </div>
  );
}
