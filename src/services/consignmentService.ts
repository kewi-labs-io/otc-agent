import type { Chain } from "@/config/chains";
import { walletToEntityId } from "@/lib/entityId";
import { parseOrThrow } from "@/lib/validation/helpers";
import {
  CreateConsignmentInputSchema,
  RecordDealInputSchema,
  ReleaseReservationInputSchema,
  ReserveAmountInputSchema,
  UpdateConsignmentInputSchema,
} from "@/types/validation/service-schemas";
import {
  ConsignmentDB,
  type ConsignmentDeal,
  ConsignmentDealDB,
  type OTCConsignment,
} from "./database";

/**
 * Consignment parameters for database creation (uses string for amounts)
 */
export interface CreateConsignmentParams {
  tokenId: string;
  consignerAddress: string;
  amount: string;
  isNegotiable: boolean;
  fixedDiscountBps?: number;
  fixedLockupDays?: number;
  minDiscountBps: number;
  maxDiscountBps: number;
  minLockupDays: number;
  maxLockupDays: number;
  minDealAmount: string;
  maxDealAmount: string;
  isFractionalized: boolean;
  isPrivate: boolean;
  allowedBuyers?: string[];
  maxPriceVolatilityBps: number;
  maxTimeToExecuteSeconds: number;
  chain: Chain;
  contractConsignmentId?: string;
}

export class ConsignmentService {
  async createConsignment(
    params: CreateConsignmentParams,
  ): Promise<OTCConsignment> {
    // Validate parameters
    const validated = parseOrThrow(CreateConsignmentInputSchema, params);

    // Business logic validation (expect/throw for invariants)
    if (!validated.isNegotiable) {
      if (
        validated.fixedDiscountBps === undefined ||
        validated.fixedLockupDays === undefined
      ) {
        throw new Error(
          "Fixed consignments must specify fixedDiscountBps and fixedLockupDays",
        );
      }
    }

    // Extract defaults for optional fields - validation ensures these have defaults
    const minDealAmount = validated.minDealAmount || "1";
    const maxDealAmount = validated.maxDealAmount || validated.amount;
    const minDiscountBps = validated.minDiscountBps ?? 0;
    const maxDiscountBps = validated.maxDiscountBps ?? 10000;
    const minLockupDays = validated.minLockupDays ?? 0;
    const maxLockupDays = validated.maxLockupDays ?? 365;

    if (BigInt(minDealAmount) > BigInt(maxDealAmount)) {
      throw new Error("minDealAmount cannot exceed maxDealAmount");
    }

    if (BigInt(validated.amount) < BigInt(minDealAmount)) {
      throw new Error(
        `Total amount (${validated.amount}) must be at least minDealAmount (${minDealAmount})`,
      );
    }

    if (minDiscountBps > maxDiscountBps) {
      throw new Error("minDiscountBps cannot exceed maxDiscountBps");
    }

    if (minLockupDays > maxLockupDays) {
      throw new Error("minLockupDays cannot exceed maxLockupDays");
    }

    // Solana addresses are Base58 and case-sensitive, EVM addresses are case-insensitive
    const normalizeAddress = (addr: string) =>
      validated.chain === "solana" ? addr : addr.toLowerCase();

    const consignment = await ConsignmentDB.createConsignment({
      tokenId: validated.tokenId,
      consignerAddress: normalizeAddress(validated.consignerAddress),
      consignerEntityId: walletToEntityId(validated.consignerAddress),
      totalAmount: validated.amount,
      remainingAmount: validated.amount,
      isNegotiable: validated.isNegotiable,
      fixedDiscountBps: validated.fixedDiscountBps,
      fixedLockupDays: validated.fixedLockupDays,
      minDiscountBps,
      maxDiscountBps,
      minLockupDays,
      maxLockupDays,
      minDealAmount,
      maxDealAmount,
      isFractionalized: validated.isFractionalized || false,
      isPrivate: validated.isPrivate || false,
      allowedBuyers: validated.allowedBuyers?.map((a) => normalizeAddress(a)),
      maxPriceVolatilityBps: validated.maxPriceVolatilityBps ?? 1000,
      maxTimeToExecuteSeconds: validated.maxTimeToExecuteSeconds ?? 3600,
      status: "active",
      chain: validated.chain,
      contractConsignmentId: validated.contractConsignmentId,
    });

    return consignment;
  }

  async updateConsignment(
    consignmentId: string,
    updates: Partial<OTCConsignment>,
  ): Promise<OTCConsignment> {
    // Validate updates
    const validated = parseOrThrow(UpdateConsignmentInputSchema, updates);

    const consignment = await ConsignmentDB.getConsignment(consignmentId);

    if (consignment.remainingAmount !== consignment.totalAmount) {
      const restrictedFields: Array<keyof OTCConsignment> = [
        "totalAmount",
        "minDealAmount",
        "maxDealAmount",
        "isFractionalized",
      ];
      for (const field of restrictedFields) {
        if (updates[field] !== undefined) {
          throw new Error(`Cannot modify ${field} after deals have been made`);
        }
      }
    }

    return await ConsignmentDB.updateConsignment(consignmentId, validated);
  }

  async withdrawConsignment(consignmentId: string): Promise<void> {
    const consignment = await ConsignmentDB.getConsignment(consignmentId);

    if (consignment.status === "withdrawn") {
      throw new Error("Consignment already withdrawn");
    }

    await ConsignmentDB.updateConsignment(consignmentId, {
      status: "withdrawn",
    });
  }

  async getConsignment(consignmentId: string): Promise<OTCConsignment> {
    return await ConsignmentDB.getConsignment(consignmentId);
  }

  async getConsignmentsByToken(
    tokenId: string,
    filters?: {
      includePrivate?: boolean;
      requesterAddress?: string;
      minAmount?: string;
    },
  ): Promise<OTCConsignment[]> {
    let consignments = await ConsignmentDB.getConsignmentsByToken(tokenId);

    if (filters && !filters.includePrivate) {
      consignments = consignments.filter((c) => !c.isPrivate);
    }

    if (filters?.includePrivate && filters.requesterAddress) {
      const requesterAddress = filters.requesterAddress;
      consignments = consignments.filter((c) => {
        if (!c.isPrivate) return true;
        // Compare addresses - Solana is case-sensitive, EVM is case-insensitive
        const isSolana = c.chain === "solana";
        const requester = isSolana
          ? requesterAddress
          : requesterAddress.toLowerCase();
        if (isSolana) {
          if (c.consignerAddress === requester) return true;
          if (c.allowedBuyers?.includes(requester)) return true;
        } else {
          if (c.consignerAddress.toLowerCase() === requester) return true;
          if (c.allowedBuyers?.some((b) => b.toLowerCase() === requester))
            return true;
        }
        return false;
      });
    }

    if (filters?.minAmount) {
      consignments = consignments.filter(
        (c) => BigInt(c.remainingAmount) >= BigInt(filters.minAmount!),
      );
    }

    return consignments;
  }

  async getConsignerConsignments(
    consignerAddress: string,
    chain?: Chain,
  ): Promise<OTCConsignment[]> {
    // Normalize address based on chain - Solana is case-sensitive, EVM is case-insensitive
    const normalizedAddress =
      chain === "solana" ? consignerAddress : consignerAddress.toLowerCase();
    return await ConsignmentDB.getConsignmentsByConsigner(normalizedAddress);
  }

  async getAllConsignments(filters?: {
    chain?: Chain;
    tokenId?: string;
    isNegotiable?: boolean;
  }): Promise<OTCConsignment[]> {
    return await ConsignmentDB.getAllConsignments(filters);
  }

  async reserveAmount(consignmentId: string, amount: string): Promise<void> {
    // Validate parameters
    const validated = parseOrThrow(ReserveAmountInputSchema, {
      consignmentId,
      amount,
    });

    const { agentRuntime } = await import("@/lib/agent-runtime");
    const runtime = await agentRuntime.getRuntime();

    const lockKey = `consignment_lock:${validated.consignmentId}`;
    const existingLock = await runtime.getCache<boolean>(lockKey);
    if (existingLock) {
      throw new Error("Consignment is being modified, try again");
    }

    await runtime.setCache(lockKey, true);

    const consignment = await ConsignmentDB.getConsignment(
      validated.consignmentId,
    );

    if (consignment.status !== "active") {
      await runtime.deleteCache(lockKey);
      throw new Error("Consignment is not active");
    }

    const remaining = BigInt(consignment.remainingAmount);
    const reserve = BigInt(validated.amount);

    if (reserve > remaining) {
      await runtime.deleteCache(lockKey);
      throw new Error("Insufficient remaining amount");
    }

    if (reserve < BigInt(consignment.minDealAmount)) {
      await runtime.deleteCache(lockKey);
      throw new Error("Amount below minimum deal size");
    }

    if (reserve > BigInt(consignment.maxDealAmount)) {
      await runtime.deleteCache(lockKey);
      throw new Error("Amount exceeds maximum deal size");
    }

    const newRemaining = (remaining - reserve).toString();
    const status = newRemaining === "0" ? "depleted" : "active";

    await ConsignmentDB.updateConsignment(validated.consignmentId, {
      remainingAmount: newRemaining,
      status,
      lastDealAt: Date.now(),
    });

    await runtime.deleteCache(lockKey);
  }

  async releaseReservation(
    consignmentId: string,
    amount: string,
  ): Promise<void> {
    // Validate parameters
    const validated = parseOrThrow(ReleaseReservationInputSchema, {
      consignmentId,
      amount,
    });

    const consignment = await ConsignmentDB.getConsignment(
      validated.consignmentId,
    );
    const newRemaining = (
      BigInt(consignment.remainingAmount) + BigInt(validated.amount)
    ).toString();
    const status = newRemaining === "0" ? "depleted" : "active";

    await ConsignmentDB.updateConsignment(validated.consignmentId, {
      remainingAmount: newRemaining,
      status,
    });
  }

  async recordDeal(params: {
    consignmentId: string;
    quoteId: string;
    tokenId: string;
    buyerAddress: string;
    amount: string;
    discountBps: number;
    lockupDays: number;
    offerId?: string;
    chain?: Chain;
  }): Promise<ConsignmentDeal> {
    // Validate parameters
    const validated = parseOrThrow(RecordDealInputSchema, params);

    // Normalize address based on chain - Solana is case-sensitive, EVM is case-insensitive
    const normalizedBuyerAddress =
      params.chain === "solana"
        ? validated.buyerAddress
        : validated.buyerAddress.toLowerCase();

    return await ConsignmentDealDB.createDeal({
      consignmentId: validated.consignmentId,
      quoteId: validated.quoteId,
      tokenId: validated.tokenId,
      buyerAddress: normalizedBuyerAddress,
      amount: validated.amount,
      discountBps: validated.discountBps,
      lockupDays: validated.lockupDays,
      executedAt: Date.now(),
      offerId: params.offerId,
      status: "executed",
    });
  }

  async getConsignmentDeals(consignmentId: string): Promise<ConsignmentDeal[]> {
    return await ConsignmentDealDB.getDealsByConsignment(consignmentId);
  }

  findSuitableConsignment(
    consignments: OTCConsignment[],
    amount: string,
    discountBps: number,
    lockupDays: number,
  ): OTCConsignment | null {
    for (const c of consignments) {
      if (BigInt(amount) < BigInt(c.minDealAmount)) continue;
      if (BigInt(amount) > BigInt(c.maxDealAmount)) continue;
      if (BigInt(amount) > BigInt(c.remainingAmount)) continue;

      if (c.isNegotiable) {
        if (discountBps < c.minDiscountBps || discountBps > c.maxDiscountBps)
          continue;
        if (lockupDays < c.minLockupDays || lockupDays > c.maxLockupDays)
          continue;
      } else {
        if (discountBps !== c.fixedDiscountBps) continue;
        if (lockupDays !== c.fixedLockupDays) continue;
      }

      return c;
    }

    return null;
  }
}
