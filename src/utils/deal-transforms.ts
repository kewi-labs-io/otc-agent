/**
 * Deal transformation utilities
 */

import type { DealFromAPI } from "@/hooks/useDeals";

export interface OfferWithMetadata {
  id: bigint;
  beneficiary: string;
  tokenAmount: bigint;
  discountBps: bigint;
  createdAt: bigint;
  unlockTime: bigint;
  priceUsdPerToken: bigint;
  ethUsdPrice: bigint;
  currency: number;
  approved: boolean;
  paid: boolean;
  fulfilled: boolean;
  cancelled: boolean;
  payer: string;
  amountPaid: bigint;
  quoteId?: string;
  tokenSymbol: string;
  tokenName: string;
  tokenLogoUrl?: string;
  tokenId?: string;
  chain: string;
}

function validateDeal(deal: DealFromAPI, type: "Solana" | "EVM"): void {
  const id = deal.quoteId || deal.offerId || "unknown";
  if (deal.lockupDays === undefined) throw new Error(`${type} deal ${id}: missing lockupDays`);
  if (!deal.offerId) throw new Error(`${type} deal ${id}: missing offerId`);
  if (!deal.beneficiary) throw new Error(`${type} deal ${id}: missing beneficiary`);
  if (typeof deal.discountBps !== "number")
    throw new Error(`${type} deal ${id}: invalid discountBps`);
  if (!deal.tokenAmount) throw new Error(`${type} deal ${id}: missing tokenAmount`);
  if (!deal.paymentAmount) throw new Error(`${type} deal ${id}: missing paymentAmount`);
  if (!deal.payer) throw new Error(`${type} deal ${id}: missing payer`);
  if (!deal.chain) throw new Error(`${type} deal ${id}: missing chain`);
  if (deal.priceUsdPerToken === undefined)
    throw new Error(`${type} deal ${id}: missing priceUsdPerToken`);
  if (!deal.tokenSymbol) throw new Error(`${type} deal ${id}: missing tokenSymbol`);
  if (!deal.tokenName) throw new Error(`${type} deal ${id}: missing tokenName`);
}

export function transformSolanaDeal(deal: DealFromAPI): OfferWithMetadata {
  validateDeal(deal, "Solana");

  const createdTs = deal.createdAt ? new Date(deal.createdAt).getTime() / 1000 : Date.now() / 1000;

  return {
    id: BigInt(deal.offerId!),
    beneficiary: deal.beneficiary!,
    tokenAmount: BigInt(Math.floor(parseFloat(deal.tokenAmount!))),
    discountBps: BigInt(deal.discountBps!),
    createdAt: BigInt(Math.floor(createdTs)),
    unlockTime: BigInt(Math.floor(createdTs + deal.lockupDays! * 86400)),
    priceUsdPerToken: BigInt(Math.floor(deal.priceUsdPerToken! * 1e8)),
    ethUsdPrice: 0n,
    currency: deal.paymentCurrency === "SOL" || deal.paymentCurrency === "ETH" ? 0 : 1,
    approved: true,
    paid: true,
    fulfilled: false,
    cancelled: false,
    payer: deal.payer!,
    amountPaid: BigInt(deal.paymentAmount!),
    quoteId: deal.quoteId,
    tokenSymbol: deal.tokenSymbol!,
    tokenName: deal.tokenName!,
    tokenLogoUrl: deal.tokenLogoUrl,
    tokenId: deal.tokenId,
    chain: deal.chain!,
  };
}

export function transformEvmDeal(deal: DealFromAPI): OfferWithMetadata {
  validateDeal(deal, "EVM");

  const id = deal.quoteId || deal.offerId!;
  if (deal.ethUsdPrice === undefined || deal.ethUsdPrice <= 0) {
    throw new Error(`EVM deal ${id}: invalid ethUsdPrice ${deal.ethUsdPrice}`);
  }
  if (deal.priceUsdPerToken! <= 0) {
    throw new Error(`EVM deal ${id}: invalid priceUsdPerToken ${deal.priceUsdPerToken}`);
  }

  const createdTs = deal.createdAt ? new Date(deal.createdAt).getTime() / 1000 : Date.now() / 1000;

  return {
    id: BigInt(deal.offerId!),
    beneficiary: deal.beneficiary!,
    tokenAmount: BigInt(Math.floor(parseFloat(deal.tokenAmount!))),
    discountBps: BigInt(deal.discountBps!),
    createdAt: BigInt(Math.floor(createdTs)),
    unlockTime: BigInt(Math.floor(createdTs + deal.lockupDays! * 86400)),
    priceUsdPerToken: BigInt(Math.floor(deal.priceUsdPerToken! * 1e8)),
    ethUsdPrice: BigInt(Math.floor(deal.ethUsdPrice * 1e8)),
    currency: deal.paymentCurrency === "ETH" ? 0 : 1,
    approved: true,
    paid: true,
    fulfilled: false,
    cancelled: false,
    payer: deal.payer!,
    amountPaid: BigInt(deal.paymentAmount!),
    quoteId: deal.quoteId,
    tokenSymbol: deal.tokenSymbol!,
    tokenName: deal.tokenName!,
    tokenLogoUrl: deal.tokenLogoUrl,
    tokenId: deal.tokenId,
    chain: deal.chain!,
  };
}

type ContractOfferWithId = {
  id: bigint;
  consignmentId?: bigint;
  tokenId?: string;
  beneficiary: string;
  tokenAmount: bigint;
  discountBps: bigint;
  createdAt: bigint;
  unlockTime: bigint;
  priceUsdPerToken: bigint;
  maxPriceDeviation?: bigint;
  ethUsdPrice: bigint;
  currency: number;
  approved: boolean;
  paid: boolean;
  fulfilled: boolean;
  cancelled: boolean;
  payer: string;
  amountPaid: bigint;
  agentCommissionBps?: number;
  tokenSymbol?: string;
  tokenName?: string;
  tokenLogoUrl?: string;
  chain?: string;
};

export function mergeDealsWithOffers(
  dbDeals: DealFromAPI[],
  contractOffers: ContractOfferWithId[],
): OfferWithMetadata[] {
  const result: OfferWithMetadata[] = [];
  const processedOfferIds = new Set<string>();

  for (const deal of dbDeals) {
    if (deal.status !== "executed" && deal.status !== "approved") continue;

    const id = deal.quoteId || deal.offerId || "unknown";
    if (!deal.tokenSymbol) throw new Error(`Deal ${id}: missing tokenSymbol`);
    if (!deal.tokenName) throw new Error(`Deal ${id}: missing tokenName`);
    if (!deal.chain) throw new Error(`Deal ${id}: missing chain`);

    const contractOffer = deal.offerId
      ? contractOffers.find((o) => o.id.toString() === deal.offerId)
      : undefined;

    if (contractOffer) {
      result.push({
        ...contractOffer,
        quoteId: deal.quoteId,
        tokenSymbol: deal.tokenSymbol,
        tokenName: deal.tokenName,
        tokenLogoUrl: deal.tokenLogoUrl,
        tokenId: deal.tokenId,
        chain: deal.chain,
      });
      if (deal.offerId) processedOfferIds.add(deal.offerId);
    } else {
      result.push(transformEvmDeal(deal));
    }
  }

  // Add contract offers not in database (only if they have required metadata)
  const contractOnlyOffers = contractOffers.filter((o) => {
    if (processedOfferIds.has(o.id.toString())) return false;
    if (!o.tokenSymbol || !o.tokenName || !o.chain) return false;
    return o.tokenAmount > 0n && o.paid && !o.fulfilled && !o.cancelled;
  });

  result.push(
    ...contractOnlyOffers.map((o) => ({
      ...o,
      quoteId: undefined,
      tokenSymbol: o.tokenSymbol!,
      tokenName: o.tokenName!,
      chain: o.chain!,
    })),
  );
  return result;
}

export function sortOffersByDate(offers: OfferWithMetadata[]): OfferWithMetadata[] {
  return [...offers].sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
}

export function filterActiveOffers(offers: OfferWithMetadata[]): OfferWithMetadata[] {
  return offers.filter((o) => !o.cancelled && !o.fulfilled);
}
