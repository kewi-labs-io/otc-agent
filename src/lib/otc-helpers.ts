/**
 * OTC Contract helpers for parsing struct responses from viem
 */

export interface ParsedOffer {
  consignmentId: bigint;
  tokenId: string;
  beneficiary: string;
  tokenAmount: bigint;
  discountBps: bigint;
  createdAt: bigint;
  unlockTime: bigint;
  priceUsdPerToken: bigint;
  maxPriceDeviation: bigint;
  ethUsdPrice: bigint;
  currency: number;
  approved: boolean;
  paid: boolean;
  fulfilled: boolean;
  cancelled: boolean;
  payer: string;
  amountPaid: bigint;
  agentCommissionBps: number; // 0 for P2P, 25-150 for negotiated deals
}

/**
 * Raw offer data as returned from viem contract read - can be array or object.
 * Array format is the standard Solidity struct tuple return.
 */
export type RawOfferData =
  | readonly [
      bigint, // 0. consignmentId
      string, // 1. tokenId
      string, // 2. beneficiary
      bigint, // 3. tokenAmount
      bigint, // 4. discountBps
      bigint, // 5. createdAt
      bigint, // 6. unlockTime
      bigint, // 7. priceUsdPerToken
      bigint, // 8. maxPriceDeviation
      bigint, // 9. ethUsdPrice
      number, // 10. currency
      boolean, // 11. approved
      boolean, // 12. paid
      boolean, // 13. fulfilled
      boolean, // 14. cancelled
      string, // 15. payer
      bigint, // 16. amountPaid
      number, // 17. agentCommissionBps
    ]
  | ParsedOffer;

/**
 * Parse an Offer struct from viem contract read.
 * Viem may return structs as arrays or objects depending on version/config.
 *
 * Struct order from OTC.sol (UPDATED with P2P support):
 * 0. consignmentId (uint256)
 * 1. tokenId (bytes32)
 * 2. beneficiary (address)
 * 3. tokenAmount (uint256)
 * 4. discountBps (uint256)
 * 5. createdAt (uint256)
 * 6. unlockTime (uint256)
 * 7. priceUsdPerToken (uint256)
 * 8. maxPriceDeviation (uint256)
 * 9. ethUsdPrice (uint256)
 * 10. currency (uint8)
 * 11. approved (bool)
 * 12. paid (bool)
 * 13. fulfilled (bool)
 * 14. cancelled (bool)
 * 15. payer (address)
 * 16. amountPaid (uint256)
 * 17. agentCommissionBps (uint16) - 0 for P2P, 25-150 for negotiated
 */
export function parseOfferStruct(offerRaw: RawOfferData): ParsedOffer {
  if (Array.isArray(offerRaw)) {
    return {
      consignmentId: offerRaw[0],
      tokenId: offerRaw[1],
      beneficiary: offerRaw[2],
      tokenAmount: offerRaw[3],
      discountBps: offerRaw[4],
      createdAt: offerRaw[5],
      unlockTime: offerRaw[6],
      priceUsdPerToken: offerRaw[7],
      maxPriceDeviation: offerRaw[8],
      ethUsdPrice: offerRaw[9],
      currency: offerRaw[10],
      approved: offerRaw[11],
      paid: offerRaw[12],
      fulfilled: offerRaw[13],
      cancelled: offerRaw[14],
      payer: offerRaw[15],
      amountPaid: offerRaw[16],
      agentCommissionBps: offerRaw[17],
    };
  }
  return offerRaw as ParsedOffer;
}
