"use client";

import { useCallback, useMemo, useRef } from "react";
import type { Abi, Address, Chain as ViemChain } from "viem";
import {
  createPublicClient,
  decodeEventLog,
  encodePacked,
  http,
  keccak256,
  type PublicClient,
} from "viem";
import {
  base,
  baseSepolia,
  bsc,
  bscTestnet,
  mainnet,
  sepolia,
} from "viem/chains";
import {
  useAccount,
  useBalance,
  useChainId,
  usePublicClient,
  useReadContract,
  useReadContracts,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import {
  type Chain,
  type ChainConfig,
  SUPPORTED_CHAINS,
} from "@/config/chains";
import { getCurrentNetwork } from "@/config/contracts";
import otcArtifact from "@/contracts/artifacts/contracts/OTC.sol/OTC.json";
import type {
  ConsignmentCreationResult,
  ConsignmentParams,
  Offer,
} from "@/types";
import { findBestPool } from "@/utils/pool-finder-base";

// Cache for OTC addresses per chain
const otcAddressCache: Record<string, Address | undefined> = {};
const addressLoggedForChain: Record<string, boolean> = {};

// Helper: Get chain config with validation (guarantees ChainConfig exists)
function getChainConfig(chain: Chain): ChainConfig {
  // FAIL-FAST: chain must be valid Chain type, SUPPORTED_CHAINS guarantees ChainConfig exists
  if (!(chain in SUPPORTED_CHAINS)) {
    throw new Error(`Unsupported chain: ${chain}`);
  }
  return SUPPORTED_CHAINS[chain];
}

// Get OTC address for a specific chain
function getOtcAddressForChain(chain: Chain): Address | undefined {
  const cacheKey = chain;
  if (otcAddressCache[cacheKey] !== undefined) {
    return otcAddressCache[cacheKey];
  }

  const chainConfig = getChainConfig(chain);
  const otcAddress = chainConfig.contracts.otc;

  if (!otcAddress) {
    throw new Error(`OTC contract address not configured for chain: ${chain}`);
  }

  if (
    process.env.NODE_ENV === "development" &&
    !addressLoggedForChain[cacheKey]
  ) {
    console.log(`[useOTC] OTC address for ${chain}:`, otcAddress);
    addressLoggedForChain[cacheKey] = true;
  }
  otcAddressCache[cacheKey] = otcAddress as Address;
  return otcAddressCache[cacheKey];
}

// Helper to get default OTC address (Base) - for backward compatibility
function getOtcAddress(): Address | undefined {
  return getOtcAddressForChain("base");
}

// Get the numeric chain ID for a chain string
function getChainId(chain: Chain): number {
  // FAIL-FAST: chain must be valid Chain type, SUPPORTED_CHAINS guarantees ChainConfig exists
  if (!(chain in SUPPORTED_CHAINS)) {
    throw new Error(`Unsupported chain: ${chain}`);
  }
  const chainConfig = SUPPORTED_CHAINS[chain];
  // FAIL-FAST: chainId is optional in interface but required for this function
  if (chainConfig.chainId === undefined) {
    throw new Error(`Chain ID not configured for chain: ${chain}`);
  }
  return chainConfig.chainId;
}

// Get viem chain config for a chain string
function getViemChain(chain: Chain): ViemChain | undefined {
  const network = getCurrentNetwork();
  const isMainnet = network === "mainnet";

  switch (chain) {
    case "ethereum":
      return isMainnet ? mainnet : sepolia;
    case "base":
      return isMainnet ? base : baseSepolia;
    case "bsc":
      return isMainnet ? bsc : bscTestnet;
    default:
      return undefined;
  }
}

// Configuration for contract reading with dynamic ABIs
// Note: args uses 'unknown[]' and requires assertion at call site due to viem's strict typing
interface ReadContractConfig {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
}

// Configuration for contract writing with dynamic ABIs
interface WriteContractConfig {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
}

// Log type for transaction receipts with topics
interface TransactionLog {
  address: Address;
  data: `0x${string}`;
  topics: readonly `0x${string}`[];
  blockHash: `0x${string}`;
  blockNumber: bigint;
  logIndex: number;
  transactionHash: `0x${string}`;
  transactionIndex: number;
  removed: boolean;
}

// Type-safe wrapper for readContract that handles wagmi client and dynamic ABIs
// The client type is inferred, we only need to specify the return type
// Uses MinimalPublicClient interface to work with both PublicClient and custom clients
import type { MinimalPublicClient } from "@/lib/viem-utils";

async function readContractFromClient<T>(
  client: MinimalPublicClient | PublicClient,
  params: ReadContractConfig,
): Promise<T> {
  // Type assertion needed: ReadContractConfig uses flexible typing for dynamic ABIs,
  // but viem expects strict types. Safe because we control all call sites.
  const result = await (
    client as { readContract: (params: ReadContractConfig) => Promise<T> }
  ).readContract(params);
  return result as T;
}

const erc20Abi = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const satisfies Abi;

// ABI for reading token registration status from OTC
const tokensAbi = [
  {
    type: "function",
    name: "tokens",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "bytes32" }],
    outputs: [
      { name: "tokenAddress", type: "address" },
      { name: "decimals", type: "uint8" },
      { name: "isActive", type: "bool" },
      { name: "priceOracle", type: "address" },
    ],
  },
] as const;

// ABI for RegistrationHelper
const registrationHelperAbi = [
  {
    type: "function",
    name: "registrationFee",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "registerTokenWithPayment",
    stateMutability: "payable",
    inputs: [
      { name: "tokenAddress", type: "address" },
      { name: "poolAddress", type: "address" },
    ],
    outputs: [{ name: "oracle", type: "address" }],
  },
] as const satisfies Abi;

export function useOTC(): {
  otcAddress: Address | undefined;
  availableTokens: bigint;
  myOfferIds: bigint[];
  myOffers: (Offer & { id: bigint })[];
  openOfferIds: bigint[];
  openOffers: Offer[];
  agent: Address | undefined;
  isAgent: boolean;
  isApprover: boolean;
  usdcAddress: Address | undefined;
  ethBalanceWei?: bigint;
  usdcBalance?: bigint;
  minUsdAmount?: bigint;
  maxTokenPerOrder?: bigint;
  quoteExpirySeconds?: bigint;
  defaultUnlockDelaySeconds?: bigint;
  emergencyRefundsEnabled?: boolean;
  isLoading: boolean;
  error: Error | null;
  claim: (offerId: bigint) => Promise<`0x${string}`>;
  isClaiming: boolean;
  createOfferFromConsignment: (params: {
    consignmentId: bigint;
    tokenAmountWei: bigint;
    discountBps: number;
    paymentCurrency: 0 | 1;
    lockupSeconds: bigint;
    agentCommissionBps: number; // 0 for P2P, 25-150 for negotiated
    chain?: Chain;
    otcOverride?: Address;
  }) => Promise<`0x${string}`>;
  approveOffer: (offerId: bigint) => Promise<`0x${string}`>;
  cancelOffer: (offerId: bigint) => Promise<`0x${string}`>;
  fulfillOffer: (offerId: bigint, valueWei?: bigint) => Promise<`0x${string}`>;
  approveUsdc: (amount: bigint) => Promise<`0x${string}`>;
  emergencyRefund: (offerId: bigint) => Promise<`0x${string}`>;
  withdrawConsignment: (consignmentId: bigint) => Promise<`0x${string}`>;
  createConsignmentOnChain: (
    params: ConsignmentParams & { chain?: Chain },
    onTxSubmitted?: (txHash: string) => void,
  ) => Promise<ConsignmentCreationResult>;
  approveToken: (
    tokenAddress: Address,
    amount: bigint,
    chain?: Chain,
  ) => Promise<unknown>;
  getTokenAddress: (tokenId: string) => Promise<Address>;
  getRequiredGasDeposit: (chain?: Chain) => Promise<bigint>;
  getRequiredPayment: (
    offerId: bigint,
    currency: "ETH" | "USDC",
  ) => Promise<bigint>;
  switchToChain: (chain: Chain) => Promise<void>;
  getOtcAddressForChain: (chain: Chain) => Address | undefined;
  isTokenRegistered: (tokenAddress: Address, chain?: Chain) => Promise<boolean>;
  registerToken: (
    tokenAddress: Address,
    poolAddress: Address,
    chain?: Chain,
  ) => Promise<`0x${string}`>;
  getRegistrationFee: (chain?: Chain) => Promise<bigint>;
} {
  const { address: account } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();

  // OTC address from env vars or deployment config (default to Base)
  const otcAddress = getOtcAddress();
  const abi = otcArtifact.abi as Abi;

  // Typed event definition for ConsignmentCreated - memoized to prevent unnecessary re-renders
  const ConsignmentCreatedEvent = useMemo(
    () =>
      ({
        type: "event" as const,
        name: "ConsignmentCreated" as const,
        inputs: [
          { name: "consignmentId", type: "uint256", indexed: true },
          { name: "tokenId", type: "bytes32", indexed: true },
          { name: "consigner", type: "address", indexed: true },
          { name: "amount", type: "uint256", indexed: false },
        ],
      }) as const,
    [],
  );

  // Use wagmi's public client which automatically handles all configured chains
  const publicClient = usePublicClient();

  // Helper to switch to a specific chain with verification
  const switchToChain = useCallback(
    async (chain: Chain): Promise<void> => {
      const targetChainId = getChainId(chain);
      if (!targetChainId) {
        throw new Error(`Unknown chain: ${chain}`);
      }

      if (chainId === targetChainId) {
        console.log(`[useOTC] Already on chain ${chain} (${targetChainId})`);
        return;
      }

      console.log(
        `[useOTC] Switching from chain ${chainId} to ${chain} (${targetChainId})`,
      );
      const result = await switchChainAsync({ chainId: targetChainId });

      // Verify the chain actually switched
      if (result.id !== targetChainId) {
        throw new Error(
          `Failed to switch to ${chain}. Wallet is on chain ${result.id} instead of ${targetChainId}. Please switch your wallet to ${chain} manually.`,
        );
      }

      console.log(`[useOTC] Successfully switched to ${chain} (${result.id})`);
    },
    [chainId, switchChainAsync],
  );

  const enabled = Boolean(otcAddress);

  const availableTokensRes = useReadContract({
    address: otcAddress,
    abi,
    functionName: "availableTokenInventory",
    chainId,
    query: { enabled },
  });
  const minUsdRes = useReadContract({
    address: otcAddress,
    abi,
    functionName: "minUsdAmount",
    chainId,
    query: { enabled },
  });
  const maxTokenRes = useReadContract({
    address: otcAddress,
    abi,
    functionName: "maxTokenPerOrder",
    chainId,
    query: { enabled },
  });
  const expiryRes = useReadContract({
    address: otcAddress,
    abi,
    functionName: "quoteExpirySeconds",
    chainId,
    query: { enabled },
  });
  const unlockDelayRes = useReadContract({
    address: otcAddress,
    abi,
    functionName: "defaultUnlockDelaySeconds",
    chainId,
    query: { enabled },
  });

  const agentRes = useReadContract({
    address: otcAddress,
    abi,
    functionName: "agent",
    chainId,
    query: { enabled },
  });
  const approverMappingRes = useReadContract({
    address: otcAddress,
    abi,
    functionName: "isApprover",
    args: [account as Address],
    chainId,
    query: { enabled: enabled && Boolean(account) },
  });

  const myOfferIdsRes = useReadContract({
    address: otcAddress,
    abi,
    functionName: "getOffersForBeneficiary",
    args: [account as Address],
    chainId,
    query: {
      enabled: enabled && Boolean(account),
      refetchInterval: 30000, // Poll every 30s for offer updates (15s was too aggressive)
      staleTime: 20000, // Consider data fresh for 20s
      refetchOnWindowFocus: true, // Refresh when tab becomes active
    },
  });
  // Track previous data to only log when actually changed
  const prevMyOfferIdsRef = useRef<string | null>(null);

  const myOfferIds = useMemo(() => {
    // myOfferIdsRes.data is optional - default to empty array if not present
    const idsData = myOfferIdsRes.data as bigint[] | undefined;
    const ids =
      idsData !== undefined && idsData !== null && Array.isArray(idsData)
        ? idsData
        : [];

    // Only log if data actually changed
    if (process.env.NODE_ENV === "development") {
      const idsKey = ids.map((id) => id.toString()).join(",");
      if (prevMyOfferIdsRef.current !== idsKey) {
        prevMyOfferIdsRef.current = idsKey;
        console.log(
          "[useOTC] My offer IDs from contract:",
          ids.map((id) => id.toString()),
        );
      }
    }

    return ids;
  }, [myOfferIdsRes.data]);

  // Using type assertion to avoid deep type instantiation issue
  const myOffersContracts = myOfferIds.map((id) => ({
    address: otcAddress!,
    abi,
    functionName: "offers" as const,
    args: [id] as const,
    chainId,
  }));

  // Type assertion to avoid deep type instantiation with wagmi's complex generics
  // wagmi's useReadContracts has deeply nested generics that cause TS2589
  const myOffersConfig = {
    contracts: myOffersContracts,
    query: {
      enabled: enabled && myOfferIds.length > 0,
      refetchInterval: 30000, // Poll every 30s for offer status changes
      staleTime: 20000, // Consider data fresh for 20s
      refetchOnWindowFocus: true, // Refresh when tab becomes active
    },
  };
  // Type assertion needed: useReadContracts has deep generic types causing TS performance issues
  // Cast to Parameters type preserves type safety while avoiding deep instantiation
  const myOffersRes = useReadContracts(
    myOffersConfig as Parameters<typeof useReadContracts>[0],
  );

  const openOfferIdsRes = useReadContract({
    address: otcAddress,
    abi,
    functionName: "getOpenOfferIds",
    chainId,
    query: { enabled },
  });
  // Using type assertion to avoid deep type instantiation issue
  // openOfferIdsRes.data is optional - default to empty array if not present
  const openOfferIdsData = openOfferIdsRes.data as bigint[] | undefined;
  const openOfferIds =
    openOfferIdsData !== undefined &&
    openOfferIdsData !== null &&
    Array.isArray(openOfferIdsData)
      ? openOfferIdsData
      : [];
  const openOffersContracts = openOfferIds.map((id) => ({
    address: otcAddress!,
    abi,
    functionName: "offers" as const,
    args: [id] as const,
    chainId,
  }));

  // Type assertion to avoid deep type instantiation with wagmi's complex generics
  // useReadContracts has extremely deep generic types that cause TypeScript performance issues
  // The cast bypasses type checking while preserving runtime behavior
  interface UseReadContractsConfig {
    contracts: Array<{
      address: Address;
      abi: Abi;
      functionName: string;
      args: readonly [bigint];
      chainId: number;
    }>;
    query: {
      enabled: boolean;
    };
  }
  const openOffersConfig: UseReadContractsConfig = {
    contracts: openOffersContracts,
    query: {
      enabled:
        enabled &&
        Array.isArray(openOfferIdsRes.data) &&
        openOfferIds.length > 0,
    },
  };
  const openOffersRes = useReadContracts(
    openOffersConfig as Parameters<typeof useReadContracts>[0],
  );

  const { writeContractAsync: writeContractAsyncBase, isPending } =
    useWriteContract();

  // Wrapper to handle writeContractAsync with dynamic ABIs
  // wagmi's types require chain/account which are inferred from context
  // Type assertion needed: writeContractAsyncBase has strict generics that don't work with dynamic ABIs
  // Wrapped in useCallback to prevent unnecessary re-renders
  const writeContractAsync = useCallback(
    (config: WriteContractConfig): Promise<`0x${string}`> => {
      return writeContractAsyncBase(
        config as Parameters<typeof writeContractAsyncBase>[0],
      );
    },
    [writeContractAsyncBase],
  );

  const claim = useCallback(
    async (offerId: bigint) => {
      if (!otcAddress) throw new Error("No OTC address");
      if (!account) throw new Error("No wallet connected");
      return writeContractAsync({
        address: otcAddress,
        abi,
        functionName: "claim",
        args: [offerId],
      });
    },
    [otcAddress, account, abi, writeContractAsync],
  );

  const createOfferFromConsignment = useCallback(
    async (params: {
      consignmentId: bigint;
      tokenAmountWei: bigint;
      discountBps: number;
      paymentCurrency: 0 | 1;
      lockupSeconds: bigint;
      agentCommissionBps: number; // 0 for P2P, 25-150 for negotiated
      chain?: Chain;
      otcOverride?: Address;
    }) => {
      // chain is optional - default to "base" if not provided
      const targetChain = params.chain ?? "base";
      // otcOverride takes priority, then chain-specific address, then default otcAddress
      const targetOtcAddress =
        params.otcOverride ?? getOtcAddressForChain(targetChain) ?? otcAddress;
      if (!targetOtcAddress) throw new Error("No OTC address");
      if (!account) throw new Error("No wallet connected");
      const targetChainId = getChainId(targetChain);
      if (targetChainId && chainId !== targetChainId) {
        await switchToChain(targetChain);
      }
      return writeContractAsync({
        address: targetOtcAddress,
        abi,
        functionName: "createOfferFromConsignment",
        args: [
          params.consignmentId,
          params.tokenAmountWei,
          BigInt(params.discountBps),
          params.paymentCurrency,
          params.lockupSeconds,
          params.agentCommissionBps,
        ],
      });
    },
    [otcAddress, account, abi, chainId, switchToChain, writeContractAsync],
  );

  const approveOffer = useCallback(
    async (offerId: bigint) => {
      if (!otcAddress) throw new Error("No OTC address");
      if (!account) throw new Error("No wallet connected");
      return writeContractAsync({
        address: otcAddress,
        abi,
        functionName: "approveOffer",
        args: [offerId],
      });
    },
    [otcAddress, account, abi, writeContractAsync],
  );

  const cancelOffer = useCallback(
    async (offerId: bigint) => {
      if (!otcAddress) throw new Error("No OTC address");
      if (!account) throw new Error("No wallet connected");
      return writeContractAsync({
        address: otcAddress,
        abi,
        functionName: "cancelOffer",
        args: [offerId],
      });
    },
    [otcAddress, account, abi, writeContractAsync],
  );

  const fulfillOffer = useCallback(
    async (offerId: bigint, valueWei?: bigint) => {
      if (!otcAddress) throw new Error("No OTC address");
      if (!account) throw new Error("No wallet connected");
      return writeContractAsync({
        address: otcAddress,
        abi,
        functionName: "fulfillOffer",
        args: [offerId],
        value: valueWei,
      });
    },
    [otcAddress, account, abi, writeContractAsync],
  );

  const usdcAddressRes = useReadContract({
    address: otcAddress,
    abi,
    functionName: "usdc",
    chainId,
    query: { enabled },
  });
  // usdcAddress is optional - undefined if not available
  const usdcAddress =
    usdcAddressRes.data !== undefined
      ? (usdcAddressRes.data as Address)
      : undefined;
  const usdcBalanceRes = useReadContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [otcAddress as Address],
    chainId,
    query: { enabled: enabled && Boolean(usdcAddress) && Boolean(otcAddress) },
  });
  const ethBalRes = useBalance({
    address: otcAddress as Address,
    chainId,
    query: { enabled: enabled && Boolean(otcAddress) },
  });

  const approveUsdc = useCallback(
    async (amount: bigint) => {
      if (!otcAddress || !usdcAddress) throw new Error("Missing addresses");
      if (!account) throw new Error("No wallet connected");
      return writeContractAsync({
        address: usdcAddress,
        abi: erc20Abi,
        functionName: "approve",
        args: [otcAddress, amount],
      });
    },
    [otcAddress, usdcAddress, account, writeContractAsync],
  );

  const emergencyRefund = useCallback(
    async (offerId: bigint) => {
      if (!otcAddress) throw new Error("No OTC address");
      if (!account) throw new Error("No wallet connected");
      return writeContractAsync({
        address: otcAddress,
        abi,
        functionName: "emergencyRefund",
        args: [offerId],
      });
    },
    [otcAddress, account, abi, writeContractAsync],
  );

  const withdrawConsignment = useCallback(
    async (consignmentId: bigint) => {
      if (!otcAddress) throw new Error("No OTC address");
      if (!account) throw new Error("No wallet connected");
      return writeContractAsync({
        address: otcAddress,
        abi,
        functionName: "withdrawConsignment",
        args: [consignmentId],
      });
    },
    [otcAddress, account, abi, writeContractAsync],
  );

  // Check if a token is registered on the OTC contract
  const isTokenRegistered = useCallback(
    async (tokenAddress: Address, chain?: Chain): Promise<boolean> => {
      // chain is optional - default to "base" if not provided
      const targetChain =
        chain !== undefined && chain !== null ? chain : "base";
      const targetOtcAddress = getOtcAddressForChain(targetChain);

      if (!targetOtcAddress) {
        throw new Error(
          `OTC contract address not configured for chain: ${targetChain}`,
        );
      }

      // Compute tokenId the same way as RegistrationHelper
      const tokenIdBytes32 = keccak256(
        encodePacked(["address"], [tokenAddress]),
      );

      const viemChain = getViemChain(targetChain);
      const chainConfig = SUPPORTED_CHAINS[targetChain];
      if (!chainConfig) {
        throw new Error(`Unsupported chain: ${targetChain}`);
      }
      const chainRpcUrl = chainConfig.rpcUrl;
      if (!chainRpcUrl) {
        throw new Error(`RPC URL not configured for chain: ${targetChain}`);
      }
      if (!viemChain) {
        throw new Error(`Could not get viem chain config for: ${targetChain}`);
      }

      const targetPublicClient = createPublicClient({
        chain: viemChain,
        transport: http(chainRpcUrl),
      });

      const result = await (
        targetPublicClient.readContract as (params: {
          address: Address;
          abi: typeof tokensAbi;
          functionName: string;
          args: readonly [`0x${string}`];
        }) => Promise<[Address, number, boolean, Address]>
      )({
        address: targetOtcAddress,
        abi: tokensAbi,
        functionName: "tokens",
        args: [tokenIdBytes32],
      });

      const [registeredAddress, , isActive] = result;
      console.log(
        `[useOTC] Token registration check: ${tokenAddress} -> isActive=${isActive}, registeredAddress=${registeredAddress}`,
      );
      return (
        isActive &&
        registeredAddress !== "0x0000000000000000000000000000000000000000"
      );
    },
    [],
  );

  // Get registration fee from RegistrationHelper
  const getRegistrationFee = useCallback(
    async (chain?: Chain): Promise<bigint> => {
      // chain is optional - default to "base" if not provided
      const targetChain =
        chain !== undefined && chain !== null ? chain : "base";
      const chainConfig = getChainConfig(targetChain);
      const registrationHelperAddress =
        chainConfig.contracts.registrationHelper;

      if (!registrationHelperAddress) {
        throw new Error(
          `RegistrationHelper not configured for chain: ${targetChain}`,
        );
      }

      const viemChain = getViemChain(targetChain);
      if (!chainConfig) {
        throw new Error(`Unsupported chain: ${targetChain}`);
      }
      const chainRpcUrl = chainConfig.rpcUrl;
      if (!chainRpcUrl) {
        throw new Error(`RPC URL not configured for chain: ${targetChain}`);
      }
      if (!viemChain) {
        throw new Error(`Could not get viem chain config for: ${targetChain}`);
      }

      const targetPublicClient = createPublicClient({
        chain: viemChain,
        transport: http(chainRpcUrl),
      });

      return readContractFromClient<bigint>(targetPublicClient, {
        address: registrationHelperAddress as Address,
        abi: registrationHelperAbi,
        functionName: "registrationFee",
      });
    },
    [],
  );

  const createConsignmentOnChain = useCallback(
    async (
      params: ConsignmentParams & { chain?: Chain },
      onTxSubmitted?: (txHash: string) => void,
    ): Promise<ConsignmentCreationResult> => {
      if (!account) {
        throw new Error("No wallet connected. Please connect your wallet.");
      }

      // Validate parameters with Zod
      const { parseOrThrow } = await import("@/lib/validation/helpers");
      const { ConsignmentParamsSchema } = await import(
        "@/types/validation/service-schemas"
      );
      const { ChainSchema } = await import("@/types/validation/schemas");
      const { z } = await import("zod");

      // Convert bigint params to strings for validation, then back to bigint
      const paramsForValidation = {
        ...params,
        amount: params.amount.toString(),
        minDealAmount: params.minDealAmount.toString(),
        maxDealAmount: params.maxDealAmount.toString(),
        gasDeposit: params.gasDeposit.toString(),
      };

      // Create a schema that includes chain field
      const ConsignmentParamsWithChainSchema = ConsignmentParamsSchema.and(
        z.object({ chain: ChainSchema.optional() }),
      );
      parseOrThrow(ConsignmentParamsWithChainSchema, paramsForValidation);

      // Get the OTC address for the specified chain (or default to Base)
      const targetChain = params.chain ?? "base";
      const targetOtcAddress = getOtcAddressForChain(targetChain);

      if (!targetOtcAddress) {
        throw new Error(
          `OTC contract address not configured for chain: ${targetChain}`,
        );
      }

      console.log(`[useOTC] Creating consignment on chain: ${targetChain}`);
      console.log(`[useOTC] Using OTC address: ${targetOtcAddress}`);

      // Switch to the correct chain if needed
      const targetChainId = getChainId(targetChain);
      if (targetChainId && chainId !== targetChainId) {
        console.log(
          `[useOTC] Switching wallet to ${targetChain} (chainId: ${targetChainId})`,
        );
        await switchToChain(targetChain);
      }

      // Compute the contract tokenId (keccak256 of the token address)
      // This must match how RegistrationHelper computes tokenId: keccak256(abi.encodePacked(tokenAddress))
      const tokenIdBytes32 = keccak256(
        encodePacked(["address"], [params.tokenAddress as `0x${string}`]),
      );
      console.log(`[useOTC] Token address: ${params.tokenAddress}`);
      console.log(`[useOTC] Computed tokenId: ${tokenIdBytes32}`);

      // Check if token is registered on the OTC contract
      const isRegistered = await isTokenRegistered(
        params.tokenAddress as Address,
        targetChain,
      );
      console.log(`[useOTC] Token registered: ${isRegistered}`);

      // Auto-register if not registered (first consignment for this token)
      if (!isRegistered) {
        // Use user-selected pool if provided, otherwise find best pool
        let poolAddress: string;

        if (params.selectedPoolAddress) {
          console.log(
            `[useOTC] Using user-selected pool for registration: ${params.selectedPoolAddress}`,
          );
          poolAddress = params.selectedPoolAddress;
        } else {
          console.log(
            `[useOTC] Token not registered, finding best pool for auto-registration...`,
          );

          // Find the best pool for this token
          const targetChainId = getChainId(targetChain);
          if (!targetChainId) {
            throw new Error(`Could not get chain ID for: ${targetChain}`);
          }

          const poolInfo = await findBestPool(
            params.tokenAddress,
            targetChainId,
          );
          if (!poolInfo) {
            throw new Error(
              `No liquidity pool found for token ${params.tokenAddress} on ${targetChain}. Cannot auto-register token without a valid Uniswap V3 or compatible pool.`,
            );
          }

          console.log(
            `[useOTC] Found pool: ${poolInfo.address} (${poolInfo.protocol}, TVL: $${poolInfo.tvlUsd.toFixed(2)})`,
          );
          poolAddress = poolInfo.address;
        }

        // Register the token
        const chainConfig = getChainConfig(targetChain);
        const registrationHelperAddress =
          chainConfig.contracts.registrationHelper;

        if (!registrationHelperAddress) {
          throw new Error(
            `RegistrationHelper not configured for chain: ${targetChain}. Token must be registered manually.`,
          );
        }

        // Get registration fee
        const fee = await getRegistrationFee(targetChain);
        console.log(`[useOTC] Registration fee: ${fee.toString()} wei`);

        console.log(
          `[useOTC] Auto-registering token ${params.tokenAddress} with pool ${poolAddress}...`,
        );

        const regTxHash = await writeContractAsync({
          address: registrationHelperAddress as Address,
          abi: registrationHelperAbi,
          functionName: "registerTokenWithPayment",
          args: [params.tokenAddress as Address, poolAddress as Address],
          value: fee,
        });

        console.log(`[useOTC] Token registration tx submitted: ${regTxHash}`);

        // Wait for registration tx to be mined
        const viemChain = getViemChain(targetChain);
        // chainConfig already fetched above, reuse it
        const chainRpcUrl = chainConfig.rpcUrl;

        if (viemChain && chainRpcUrl) {
          const targetPublicClient = createPublicClient({
            chain: viemChain,
            transport: http(chainRpcUrl),
          });

          // Poll for receipt (max 30 seconds)
          let receipt = null;
          for (let i = 0; i < 15; i++) {
            // Receipt not found yet is expected during polling - catch and continue
            receipt = await targetPublicClient
              .getTransactionReceipt({ hash: regTxHash })
              .catch(() => null);
            if (receipt) {
              console.log(
                `[useOTC] Token registration confirmed in block ${receipt.blockNumber}`,
              );
              break;
            }
            await new Promise((r) => setTimeout(r, 2000));
          }

          if (!receipt) {
            throw new Error(
              `Token registration tx not confirmed after 30s: ${regTxHash}`,
            );
          }
        }
      }

      // OTC.sol createConsignment signature:
      // bytes32 tokenId, uint256 amount, bool isNegotiable, uint16 fixedDiscountBps, uint32 fixedLockupDays,
      // uint16 minDiscountBps, uint16 maxDiscountBps, uint32 minLockupDays, uint32 maxLockupDays,
      // uint256 minDealAmount, uint256 maxDealAmount, uint16 maxPriceVolatilityBps
      console.log("[useOTC] createConsignment params:", {
        tokenId: tokenIdBytes32,
        amount: params.amount.toString(),
        isNegotiable: params.isNegotiable,
        fixedDiscountBps: params.fixedDiscountBps,
        fixedLockupDays: params.fixedLockupDays,
        minDiscountBps: params.minDiscountBps,
        maxDiscountBps: params.maxDiscountBps,
        minLockupDays: params.minLockupDays,
        maxLockupDays: params.maxLockupDays,
        minDealAmount: params.minDealAmount.toString(),
        maxDealAmount: params.maxDealAmount.toString(),
        maxPriceVolatilityBps: params.maxPriceVolatilityBps,
        gasDeposit: params.gasDeposit
          ? params.gasDeposit.toString()
          : undefined,
      });
      const txHash = await writeContractAsync({
        address: targetOtcAddress,
        abi,
        functionName: "createConsignment",
        args: [
          tokenIdBytes32,
          params.amount,
          params.isNegotiable,
          params.fixedDiscountBps,
          params.fixedLockupDays,
          params.minDiscountBps,
          params.maxDiscountBps,
          params.minLockupDays,
          params.maxLockupDays,
          params.minDealAmount,
          params.maxDealAmount,
          params.maxPriceVolatilityBps,
        ],
        value: params.gasDeposit,
      });

      // Notify caller that tx was submitted (before waiting for receipt)
      // This allows UI to update immediately with tx hash
      console.log("[useOTC] Transaction submitted:", txHash);
      if (onTxSubmitted) {
        onTxSubmitted(txHash);
      }

      // Wait for transaction receipt and parse the consignmentId from the event
      console.log("[useOTC] Waiting for transaction receipt:", txHash);

      // Create a public client for the target chain to read the receipt
      const viemChain = getViemChain(targetChain);
      const chainConfig = SUPPORTED_CHAINS[targetChain];
      if (!chainConfig) {
        throw new Error(`Unsupported chain: ${targetChain}`);
      }
      const chainRpcUrl = chainConfig.rpcUrl;
      if (!chainRpcUrl) {
        throw new Error(`RPC URL not configured for chain: ${targetChain}`);
      }
      if (!viemChain) {
        throw new Error(`Could not get viem chain config for: ${targetChain}`);
      }

      const targetPublicClient = createPublicClient({
        chain: viemChain,
        transport: http(chainRpcUrl),
      });

      // Poll for receipt (max 10 seconds)
      let receipt = null;
      const maxAttempts = 5;
      const pollInterval = 2000;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        // Receipt not found yet is expected during polling - catch and continue
        receipt = await targetPublicClient
          .getTransactionReceipt({ hash: txHash as `0x${string}` })
          .catch(() => null);
        if (receipt) {
          console.log(`[useOTC] Receipt found on attempt ${attempt}`);
          break;
        }
        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, pollInterval));
        }
      }

      if (!receipt) {
        throw new Error(
          `Transaction receipt not found after ${maxAttempts} attempts: ${txHash}`,
        );
      }

      console.log(
        "[useOTC] Receipt received, parsing ConsignmentCreated event",
      );
      console.log("[useOTC] Receipt logs count:", receipt.logs.length);
      console.log("[useOTC] OTC contract address:", targetOtcAddress);

      // Find ConsignmentCreated event from the OTC contract
      const logs = receipt.logs as TransactionLog[];
      const consignmentCreatedEvent = logs.find((log) => {
        if (log.address.toLowerCase() !== targetOtcAddress.toLowerCase()) {
          return false;
        }

        const decoded = decodeEventLog({
          abi,
          data: log.data,
          topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
        });
        console.log("[useOTC] Decoded event:", decoded.eventName);
        return decoded.eventName === "ConsignmentCreated";
      });

      if (!consignmentCreatedEvent) {
        throw new Error(`ConsignmentCreated event not found in tx: ${txHash}`);
      }

      // Use typed event definition for proper type inference
      const decoded = decodeEventLog({
        abi: [ConsignmentCreatedEvent],
        data: consignmentCreatedEvent.data,
        topics: consignmentCreatedEvent.topics as [
          `0x${string}`,
          ...`0x${string}`[],
        ],
      });

      if (decoded.eventName !== "ConsignmentCreated") {
        throw new Error(`Unexpected event: ${decoded.eventName}`);
      }

      // TypeScript now knows decoded.args has consignmentId: bigint
      const consignmentId = decoded.args.consignmentId;
      console.log(
        "[useOTC] Consignment created with ID:",
        consignmentId.toString(),
      );

      return { txHash: txHash as `0x${string}`, consignmentId };
    },
    [
      account,
      abi,
      chainId,
      switchToChain,
      ConsignmentCreatedEvent,
      getRegistrationFee,
      isTokenRegistered,
      writeContractAsync,
    ],
  );

  const approveToken = useCallback(
    async (tokenAddress: Address, amount: bigint, chain?: Chain) => {
      if (!account) throw new Error("No wallet connected");

      // Get the OTC address for the specified chain (or default to Base)
      // chain is optional - default to "base" if not provided
      const targetChain =
        chain !== undefined && chain !== null ? chain : "base";
      const targetOtcAddress = getOtcAddressForChain(targetChain);

      if (!targetOtcAddress) {
        throw new Error(
          `OTC contract address not configured for chain: ${targetChain}`,
        );
      }

      const network = getCurrentNetwork();
      console.log("[useOTC] approveToken - network config:", network);
      console.log("[useOTC] approveToken - target chain:", targetChain);
      console.log("[useOTC] approveToken - token:", tokenAddress);
      console.log("[useOTC] approveToken - spender (OTC):", targetOtcAddress);
      console.log("[useOTC] approveToken - wallet chainId:", chainId);
      console.log("[useOTC] approveToken - amount:", amount.toString());

      // Switch to the correct chain if needed
      const targetChainId = getChainId(targetChain);
      if (targetChainId && chainId !== targetChainId) {
        console.log(
          `[useOTC] Switching wallet to ${targetChain} (chainId: ${targetChainId})`,
        );
        await switchToChain(targetChain);
      }

      // Check current allowance - some tokens (like USDT) require approval to be 0 first
      // before setting a new non-zero value
      const viemChain = getViemChain(targetChain);
      const chainConfig = SUPPORTED_CHAINS[targetChain];
      if (!chainConfig) {
        throw new Error(`Unsupported chain: ${targetChain}`);
      }
      const chainRpcUrl = chainConfig.rpcUrl;
      if (!chainRpcUrl) {
        throw new Error(`RPC URL not configured for chain: ${targetChain}`);
      }
      if (viemChain) {
        const targetPublicClient = createPublicClient({
          chain: viemChain,
          transport: http(chainRpcUrl),
        });

        const currentAllowance = await readContractFromClient<bigint>(
          targetPublicClient,
          {
            address: tokenAddress,
            abi: erc20Abi,
            functionName: "allowance",
            args: [account, targetOtcAddress],
          },
        );

        console.log(
          "[useOTC] approveToken - current allowance:",
          currentAllowance.toString(),
        );

        // If there's an existing non-zero allowance and we're setting a different non-zero value,
        // some tokens require resetting to 0 first (USDT-style approval)
        if (
          currentAllowance > 0n &&
          amount > 0n &&
          currentAllowance !== amount
        ) {
          console.log(
            "[useOTC] approveToken - resetting allowance to 0 first (USDT-style)",
          );
          const resetTxHash = await writeContractAsync({
            address: tokenAddress,
            abi: erc20Abi,
            functionName: "approve",
            args: [targetOtcAddress, 0n],
          });
          console.log("[useOTC] approveToken - reset tx:", resetTxHash);

          // Wait briefly for the reset tx to be mined
          await new Promise((r) => setTimeout(r, 3000));
        }
      }

      return writeContractAsync({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "approve",
        args: [targetOtcAddress, amount],
      });
    },
    [account, chainId, switchToChain, writeContractAsync],
  );

  // Helper to extract contract address from tokenId format: "token-{chain}-{address}"
  const extractContractAddress = useCallback((tokenId: string): Address => {
    const parts = tokenId.split("-");
    if (parts.length < 3) {
      throw new Error(
        `Invalid tokenId format: ${tokenId}. Expected "token-{chain}-{address}"`,
      );
    }
    // Format is: token-chain-address, so join everything after the second dash
    return parts.slice(2).join("-") as Address;
  }, []);

  const getTokenAddress = useCallback(
    async (tokenId: string): Promise<Address> => {
      // Simply extract the contract address from the tokenId
      // The tokenId format is "token-{chain}-{contractAddress}"
      return extractContractAddress(tokenId);
    },
    [extractContractAddress],
  );

  const getRequiredGasDeposit = useCallback(
    async (chain?: Chain): Promise<bigint> => {
      // Get the OTC address for the specified chain (or default to Base)
      // chain is optional - default to "base" if not provided
      const targetChain =
        chain !== undefined && chain !== null ? chain : "base";
      const targetOtcAddress = getOtcAddressForChain(targetChain);

      if (!targetOtcAddress) {
        throw new Error(
          `OTC contract address not configured for chain: ${targetChain}`,
        );
      }

      // Create a public client for the target chain
      const viemChain = getViemChain(targetChain);
      const chainConfig = SUPPORTED_CHAINS[targetChain];
      if (!chainConfig) {
        throw new Error(`Unsupported chain: ${targetChain}`);
      }
      const chainRpcUrl = chainConfig.rpcUrl;
      if (!chainRpcUrl) {
        throw new Error(`RPC URL not configured for chain: ${targetChain}`);
      }
      if (!viemChain) {
        throw new Error(`Could not get viem chain config for: ${targetChain}`);
      }

      const targetPublicClient = createPublicClient({
        chain: viemChain,
        transport: http(chainRpcUrl),
      });

      return readContractFromClient<bigint>(targetPublicClient, {
        address: targetOtcAddress,
        abi,
        functionName: "requiredGasDepositPerConsignment",
      });
    },
    [abi],
  );

  // Helper to get exact required payment amount
  const getRequiredPayment = useCallback(
    async (offerId: bigint, currency: "ETH" | "USDC"): Promise<bigint> => {
      if (!otcAddress) {
        throw new Error("OTC address not configured");
      }
      if (!publicClient) {
        throw new Error("Public client not available");
      }
      const functionName =
        currency === "ETH" ? "requiredEthWei" : "requiredUsdcAmount";
      return readContractFromClient<bigint>(publicClient, {
        address: otcAddress,
        abi,
        functionName,
        args: [offerId],
      });
    },
    [otcAddress, publicClient, abi],
  );

  // Register a token on the OTC contract via RegistrationHelper
  const registerToken = useCallback(
    async (
      tokenAddress: Address,
      poolAddress: Address,
      chain?: Chain,
    ): Promise<`0x${string}`> => {
      if (!account) throw new Error("No wallet connected");

      // chain is optional - default to "base" if not provided
      const targetChain =
        chain !== undefined && chain !== null ? chain : "base";
      const chainConfig = getChainConfig(targetChain);
      const registrationHelperAddress =
        chainConfig.contracts.registrationHelper;

      if (!registrationHelperAddress) {
        throw new Error(
          `RegistrationHelper not configured for chain: ${targetChain}`,
        );
      }

      // Switch to the correct chain if needed
      const targetChainId = getChainId(targetChain);
      if (targetChainId && chainId !== targetChainId) {
        console.log(
          `[useOTC] Switching wallet to ${targetChain} for token registration`,
        );
        await switchToChain(targetChain);
      }

      // Get registration fee
      const fee = await getRegistrationFee(targetChain);
      console.log(`[useOTC] Registration fee: ${fee.toString()} wei`);

      console.log(
        `[useOTC] Registering token ${tokenAddress} with pool ${poolAddress} on ${targetChain}`,
      );

      return writeContractAsync({
        address: registrationHelperAddress as Address,
        abi: registrationHelperAbi,
        functionName: "registerTokenWithPayment",
        args: [tokenAddress, poolAddress],
        value: fee,
      });
    },
    [account, chainId, switchToChain, getRegistrationFee, writeContractAsync],
  );

  // agentAddr is optional - undefined if not set
  const agentAddr =
    agentRes.data !== undefined ? (agentRes.data as Address) : undefined;
  const isAgent =
    !!account &&
    !!agentAddr &&
    (account as string).toLowerCase() === (agentAddr as string).toLowerCase();
  const isWhitelisted = Boolean(approverMappingRes.data as boolean | undefined);
  const isApprover = isAgent || isWhitelisted;

  // Check if emergency refunds are enabled
  const emergencyRefundsRes = useReadContract({
    address: otcAddress,
    abi,
    functionName: "emergencyRefundsEnabled",
    chainId,
    query: { enabled },
  });

  // Track previous offers data to only log on actual changes
  const prevMyOffersDataRef = useRef<string | null>(null);

  const myOffers: (Offer & { id: bigint })[] = useMemo(() => {
    // Offer tuple type from contract: [consignmentId, tokenId, beneficiary, tokenAmount, discountBps, createdAt, unlockTime,
    //   priceUsdPerToken, maxPriceDeviation, ethUsdPrice, currency, approved, paid, fulfilled, cancelled, payer, amountPaid, agentCommissionBps]
    type OfferTupleResult = readonly [
      bigint,
      `0x${string}`,
      Address,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      number,
      boolean,
      boolean,
      boolean,
      boolean,
      Address,
      bigint,
      number,
    ];
    type ReadContractsResult = Array<{
      result?: OfferTupleResult;
      error?: Error;
    }>;
    const base = (myOffersRes.data as ReadContractsResult | undefined) ?? [];

    // Filter and map only valid offers - skip any that failed to load
    const offers = myOfferIds
      .map((id, idx) => {
        const rawResult = base[idx]?.result;

        // Contract returns array: [consignmentId, tokenId, beneficiary, tokenAmount, discountBps, createdAt, unlockTime,
        //   priceUsdPerToken, maxPriceDeviation, ethUsdPrice, currency, approved, paid, fulfilled, cancelled, payer, amountPaid, agentCommissionBps]
        if (!Array.isArray(rawResult)) {
          // Offer data not loaded yet or failed - skip it
          return null;
        }

        const [
          consignmentId,
          tokenId,
          beneficiary,
          tokenAmount,
          discountBps,
          createdAt,
          unlockTime,
          priceUsdPerToken,
          maxPriceDeviation,
          ethUsdPrice,
          currency,
          approved,
          paid,
          fulfilled,
          cancelled,
          payer,
          amountPaid,
          agentCommissionBps,
        ] = rawResult;

        return {
          id,
          consignmentId,
          tokenId,
          beneficiary,
          tokenAmount,
          discountBps,
          createdAt,
          unlockTime,
          priceUsdPerToken,
          maxPriceDeviation,
          ethUsdPrice,
          currency,
          approved,
          paid,
          fulfilled,
          cancelled,
          payer,
          amountPaid,
          agentCommissionBps,
        } as Offer & { id: bigint };
      })
      .filter((offer): offer is Offer & { id: bigint } => offer !== null);

    // Only log when offers data actually changes
    if (process.env.NODE_ENV === "development" && offers.length > 0) {
      const offersKey = offers
        .map((o) => `${o.id}:${o.paid}:${o.fulfilled}`)
        .join(",");
      if (prevMyOffersDataRef.current !== offersKey) {
        prevMyOffersDataRef.current = offersKey;
        const paidOffers = offers.filter((o) => o.paid);
        console.log("[useOTC] Offers updated:", {
          total: offers.length,
          paid: paidOffers.length,
          ids: paidOffers.map((o) => o.id.toString()),
        });
      }
    }

    return offers;
  }, [myOfferIds, myOffersRes.data]);

  return {
    otcAddress,
    availableTokens: (availableTokensRes.data as bigint | undefined) ?? 0n,
    myOfferIds,
    myOffers,
    openOfferIds: ((openOfferIdsRes.data as bigint[] | undefined) ??
      []) as bigint[],
    openOffers: (
      (openOffersRes.data as
        | Array<{ result?: Offer; error?: Error }>
        | undefined) ?? []
    )
      .map((x) => x?.result as Offer | undefined)
      .filter((x): x is Offer => x !== undefined),
    agent: agentAddr,
    isAgent,
    isApprover,
    usdcAddress,
    ethBalanceWei: ethBalRes.data?.value as bigint | undefined,
    // usdcBalance is optional - undefined if not present
    usdcBalance:
      (usdcBalanceRes.data as bigint | undefined) !== undefined &&
      (usdcBalanceRes.data as bigint | undefined) !== null
        ? (usdcBalanceRes.data as bigint)
        : undefined,
    // minUsdAmount is optional - undefined if not present
    minUsdAmount:
      (minUsdRes.data as bigint | undefined) !== undefined &&
      (minUsdRes.data as bigint | undefined) !== null
        ? (minUsdRes.data as bigint)
        : undefined,
    // maxTokenPerOrder is optional - undefined if not present
    maxTokenPerOrder:
      (maxTokenRes.data as bigint | undefined) !== undefined &&
      (maxTokenRes.data as bigint | undefined) !== null
        ? (maxTokenRes.data as bigint)
        : undefined,
    // quoteExpirySeconds is optional - undefined if not present
    quoteExpirySeconds:
      (expiryRes.data as bigint | undefined) !== undefined &&
      (expiryRes.data as bigint | undefined) !== null
        ? (expiryRes.data as bigint)
        : undefined,
    // defaultUnlockDelaySeconds is optional - undefined if not present
    defaultUnlockDelaySeconds:
      (unlockDelayRes.data as bigint | undefined) !== undefined &&
      (unlockDelayRes.data as bigint | undefined) !== null
        ? (unlockDelayRes.data as bigint)
        : undefined,
    // emergencyRefundsEnabled is optional - default to false if not present
    emergencyRefundsEnabled:
      (emergencyRefundsRes.data as boolean | undefined) !== undefined &&
      (emergencyRefundsRes.data as boolean | undefined) !== null
        ? (emergencyRefundsRes.data as boolean)
        : false,
    isLoading:
      availableTokensRes.isLoading ||
      myOfferIdsRes.isLoading ||
      myOffersRes.isLoading ||
      usdcBalanceRes.isLoading ||
      ethBalRes.isLoading,
    error:
      availableTokensRes.error ||
      myOfferIdsRes.error ||
      myOffersRes.error ||
      usdcBalanceRes.error ||
      ethBalRes.error,
    claim,
    isClaiming: isPending,
    createOfferFromConsignment,
    approveOffer,
    cancelOffer,
    fulfillOffer,
    approveUsdc,
    emergencyRefund,
    withdrawConsignment,
    createConsignmentOnChain,
    approveToken,
    getTokenAddress,
    getRequiredGasDeposit,
    getRequiredPayment,
    switchToChain,
    getOtcAddressForChain,
    isTokenRegistered,
    registerToken,
    getRegistrationFee,
  } as const;
}
