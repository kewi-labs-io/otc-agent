"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import Card from "@/components/card";

export default function HomePage() {
  const router = useRouter();

  // Simple wallet connect - just use Privy login
  const handleOpenConsignmentForm = useCallback(() => {
    // navigate to /consign
    router.push("/consign");
  }, [router]);

  const handleOpenTradingDesk = useCallback(() => {
    router.push("/trading-desk");
  }, [router]);

  const handleViewDeals = useCallback(() => {
    router.push("/my-deals");
  }, [router]);

  return (
    <div className="relative flex flex-col px-6 py-4 flex-1 overflow-y-auto">
      {/* Background with gradient overlay */}
      <div className="absolute inset-0">
        {/* Background */}
        <div className="absolute inset-0 bg-surface" />

        {/* Background image positioned on the right */}
        <div className="absolute inset-0 flex justify-end">
          <Image
            src="/how-it-works/how-it-works-bg.png"
            alt="How it works background"
            width={1200}
            height={900}
            className="object-cover h-auto"
            priority
          />
        </div>

        {/* Gradient overlay - black on left fading to transparent on right */}
        <div
          className="absolute inset-0 bg-gradient-to-r from-black via-black to-transparent"
          style={{
            background:
              "linear-gradient(to right, rgba(16, 16, 16, 1) 0%, #000000 55%, rgba(0,0,0,0.3) 75%)",
          }}
        />
      </div>

      {/* Content */}
      <div className="relative flex flex-col items-start justify-start lg:justify-center flex-1 lg:pb-32">
        <div className="flex flex-col items-start">
          <h1
            className="text-4xl sm:text-5xl lg:text-6xl xl:text-7xl font-bold text-white leading-tight tracking-tight"
            aria-level={1}
          >
            Sell Your Tokens
            <br />
            Over-the-Counter
          </h1>
          <p className="mt-2 lg:mt-6 text-lg sm:text-xl text-zinc-300 max-w-2xl leading-relaxed">
            Permissionless, peer-to-peer over-the-counter deals.
          </p>
        </div>

        {/* Cards - vertical stack on mobile, horizontal row on desktop */}
        <div className="flex flex-col lg:flex-row gap-4 mt-4 lg:mt-10 place-self-center lg:place-self-start w-full lg:w-auto">
          <Card
            number="1"
            title="List A Token"
            description="Consign your tokens at a discount with lockup."
            button="Create Listing"
            onClick={handleOpenConsignmentForm}
          />
          <Card
            number="2"
            title="Negotiate"
            description="Make an offer with AI-negotiated deals."
            button="Open Trading Desk"
            onClick={handleOpenTradingDesk}
          />
          <Card
            number="3"
            title="Private Deals"
            description="Fixed price and private deals available."
            button="View My Deals"
            onClick={handleViewDeals}
          />
        </div>
      </div>
      <div
        className="absolute bottom-0 right-0 w-full h-2/3 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse 80% 100% at 100% 100%, var(--brand-primary) 0%, rgba(247, 91, 30, 0.6) 0%, rgba(247, 91, 30, 0.3) 0%, transparent 75%)`,
          filter: "blur(2px)",
        }}
      />
    </div>
  );
}
