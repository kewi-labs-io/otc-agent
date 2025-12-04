"use client";

import Card from "@/components/Card";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useMultiWallet } from "@/components/multiwallet";
import { useCallback } from "react";

export default function HowItWorksContent() {
  const router = useRouter();
  const { isConnected } = useMultiWallet();

  // Simple wallet connect - just use Privy login
  const handleOpenConsignmentForm = useCallback(() => {
    // navigate to /consign
    router.push("/consign");
  }, [router]);

  const handleOpenTradingDesk = useCallback(() => {
    router.push("/");
  }, [router]);

  const handleViewDeals = useCallback(() => {
    router.push("/my-deals");
  }, [router]);

  return (
    <div className="relative flex flex-col px-4 sm:px-6 py-10 min-h-screen">
      {/* Background with gradient overlay */}
      <div className="absolute inset-0">
        {/* Black background */}
        <div className="absolute inset-0 bg-black" />

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
      <div className="z-10 flex flex-col items-start justify-center h-full">
        <div className="flex items-center mb-10">
          <Image
            src="/how-it-works/text.svg"
            alt="How it works text"
            height={220}
            width={950}
            draggable={false}
            className="select-none w-auto"
          />
        </div>

        {/* New heading text */}
        <h1 className="text-white font-bold text-start text-3xl max-w-4xl leading-tight">
          <span className="text-[#F75B1E]">
            {" "}
            Simple, transparent, on-chain.
          </span>
        </h1>
        <div className="flex mb-12 gap-4 mt-8 place-self-center lg:place-self-start flex-col lg:flex-row">
          <Card
            number="1"
            title="List A Token"
            description="Connect to start. We support devnet with a local faucet for testing."
            button={"List A Token"}
            onClick={handleOpenConsignmentForm}
          />
          <Card
            number="2"
            title="Negotiate a deal"
            description="Use the agent OTC desk to request an amount, choose a discount and lockup."
            button="Open Trading Desk"
            onClick={handleOpenTradingDesk}
          />
          <Card
            number="3"
            title="Buy and hold"
            description="Complete payment in ETH or USDC. Your tokens are available after the lockup period ends."
            button="View My Deals"
            onClick={handleViewDeals}
          />
        </div>
      </div>
      <div
        className="absolute bottom-0 right-0 w-full h-2/3 z-20 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse 80% 100% at 100% 100%, #F75B1E 0%, rgba(247, 91, 30, 0.6) 0%, rgba(247, 91, 30, 0.3) 0%, transparent 75%)`,
          filter: "blur(2px)",
        }}
      />
    </div>
  );
}
