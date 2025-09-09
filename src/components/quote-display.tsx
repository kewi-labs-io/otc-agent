"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/button";
import { useOTC } from "@/hooks/contracts/useOTC";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import {
  extractXMLFromMessage,
  parseOTCQuoteXML,
  type OTCQuote,
} from "@/utils/xml-parser";

interface OTCQuoteDisplayProps {
  messageText: string;
  onAccept?: (quote: OTCQuote) => void;
}

export function OTCQuoteDisplay({
  messageText,
  onAccept,
}: OTCQuoteDisplayProps) {
  const [quote, setQuote] = useState<OTCQuote | null>(null);
  const { isConnected } = useAccount();
  const { createOffer } = useOTC();

  useEffect(() => {
    // Parse XML from message text using utility
    const xmlString = extractXMLFromMessage(messageText);
    if (xmlString) {
      const parsedQuote = parseOTCQuoteXML(xmlString);
      if (parsedQuote) {
        setQuote(parsedQuote);
      }
    }
  }, [messageText]);

  if (!quote) return null;

  const handleAccept = async () => {
    if (!isConnected) {
      // Will trigger wallet connection via RainbowKit
      return;
    }

    try {
      // Convert to contract parameters
      const tokenAmountWei =
        BigInt(Math.floor(parseFloat(quote.tokenAmount))) * BigInt(10 ** 18);
      const discountBps = quote.discountBps;
      const paymentCurrency = quote.paymentCurrency === "ETH" ? 0 : 1;
      const lockupSeconds = BigInt(quote.lockupDays) * BigInt(24 * 60 * 60);

      await createOffer({
        tokenAmountWei,
        discountBps,
        paymentCurrency,
        lockupSeconds,
      });

      if (onAccept) {
        onAccept(quote);
      }
    } catch (error) {
      throw error;
    }
  };

  return (
    <div
      data-testid="quote-display"
      className="mt-4 p-4 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900"
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Quote #{quote.quoteId}
        </h3>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <span className="text-zinc-500 dark:text-zinc-400">Amount:</span>
          <p className="font-medium text-zinc-900 dark:text-zinc-100">
            {quote.tokenAmountFormatted} {quote.tokenSymbol}
          </p>
        </div>

        <div>
          <span className="text-zinc-500 dark:text-zinc-400">Discount:</span>
          <p
            className="font-medium text-zinc-900 dark:text-zinc-100"
            data-testid="quote-discount"
          >
            {quote.discountPercent}%
          </p>
        </div>

        <div>
          <span className="text-zinc-500 dark:text-zinc-400">Lockup:</span>
          <p className="font-medium text-zinc-900 dark:text-zinc-100">
            {quote.lockupMonths} months ({quote.lockupDays} days)
          </p>
        </div>

        <div>
          <span className="text-zinc-500 dark:text-zinc-400">Your Price:</span>
          <p className="font-medium text-zinc-900 dark:text-zinc-100">
            ${quote.finalPriceUsd}
          </p>
        </div>

        <div>
          <span className="text-zinc-500 dark:text-zinc-400">Payment:</span>
          <p className="font-medium text-zinc-900 dark:text-zinc-100">
            {quote.paymentAmount} {quote.paymentSymbol}
          </p>
        </div>

        <div>
          <span className="text-zinc-500 dark:text-zinc-400">You Save:</span>
          <p className="font-medium text-green-600 dark:text-green-400">
            ${quote.discountUsd} ({quote.discountPercent}%)
          </p>
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        {!isConnected ? (
          <ConnectButton />
        ) : (
          <Button
            data-testid="accept-quote-button"
            onClick={handleAccept}
            className="flex-1"
            color="blue"
          >
            Accept Quote
          </Button>
        )}
      </div>
    </div>
  );
}
