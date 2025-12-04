"use client";

import { useMemo } from "react";
import {
  useAccount,
  useReadContract,
  useReadContracts,
  useWriteContract,
  useChainId,
  useBalance,
  usePublicClient,
} from "wagmi";
import { keccak256, stringToBytes, decodeEventLog } from "viem";
import type { Abi, Address } from "viem";
import type {
  Offer,
  ConsignmentParams,
  ConsignmentCreationResult,
} from "@/types";
import otcArtifact from "@/contracts/artifacts/contracts/OTC.sol/OTC.json";
import { getContracts } from "@/config/contracts";

// Helper to get OTC address from deployments or env
function getOtcAddress(): Address | undefined {
  // Try environment variables first
  const envAddress =
    process.env.NEXT_PUBLIC_BASE_OTC_ADDRESS ||
    process.env.NEXT_PUBLIC_OTC_ADDRESS;
  if (envAddress) {
    console.log("[useOTC] Using OTC address from env:", envAddress);
    return envAddress as Address;
  }

  // Fallback to deployment config
  const network = process.env.NEXT_PUBLIC_NETWORK as
    | "local"
    | "testnet"
    | "mainnet"
    | undefined;
  const deployments = getContracts(network || "testnet");
  const configAddress = deployments.evm?.contracts?.otc;

  if (configAddress) {
    console.log(
      "[useOTC] Using OTC address from deployment config:",
      configAddress,
      "network:",
      network || "testnet",
    );
    return configAddress as Address;
  }

  console.warn("[useOTC] No OTC address found in env or deployment config");
  return undefined;
}

// Configuration for contract reading with dynamic ABIs
interface ReadContractConfig {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
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
// Uses type assertion to bypass viem's strict authorizationList requirement
async function readContractFromClient<T>(
  client: { readContract: (params: unknown) => Promise<unknown> },
  params: ReadContractConfig,
): Promise<T> {
  const result = await client.readContract(params);
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
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as unknown as Abi;

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
  error: unknown;
  claim: (offerId: bigint) => Promise<unknown>;
  isClaiming: boolean;
  createOffer: (params: {
    tokenAmountWei: bigint;
    discountBps: number;
    paymentCurrency: 0 | 1;
    lockupSeconds?: bigint;
  }) => Promise<unknown>;
  approveOffer: (offerId: bigint) => Promise<unknown>;
  cancelOffer: (offerId: bigint) => Promise<unknown>;
  fulfillOffer: (offerId: bigint, valueWei?: bigint) => Promise<unknown>;
  approveUsdc: (amount: bigint) => Promise<unknown>;
  emergencyRefund: (offerId: bigint) => Promise<unknown>;
  withdrawConsignment: (consignmentId: bigint) => Promise<unknown>;
  createConsignmentOnChain: (
    params: ConsignmentParams,
  ) => Promise<ConsignmentCreationResult>;
  approveToken: (tokenAddress: Address, amount: bigint) => Promise<unknown>;
  getTokenAddress: (tokenId: string) => Promise<Address>;
  getRequiredGasDeposit: () => Promise<bigint>;
  getRequiredPayment: (
    offerId: bigint,
    currency: "ETH" | "USDC",
  ) => Promise<bigint>;
} {
  const { address: account } = useAccount();
  const chainId = useChainId();
  // OTC address from env vars or deployment config
  const otcAddress = getOtcAddress();
  const abi = otcArtifact.abi as Abi;

  // Use wagmi's public client which automatically handles all configured chains
  const publicClient = usePublicClient();

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
      refetchInterval: 2000,
      staleTime: 0, // Always refetch - don't use cache
      gcTime: 0, // Don't keep old data
    },
  });
  const myOfferIds = useMemo(() => {
    const ids = (myOfferIdsRes.data as bigint[] | undefined) ?? [];
    console.log(
      "[useOTC] My offer IDs from contract:",
      ids.map((id) => id.toString()),
    );
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
      refetchInterval: 2000,
      staleTime: 0, // Always refetch - critical for showing latest paid/fulfilled state
      gcTime: 0, // Don't keep stale data
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const myOffersRes = useReadContracts(myOffersConfig as any);

  const openOfferIdsRes = useReadContract({
    address: otcAddress,
    abi,
    functionName: "getOpenOfferIds",
    chainId,
    query: { enabled },
  });
  // Using type assertion to avoid deep type instantiation issue
  const openOfferIds = (openOfferIdsRes.data as bigint[] | undefined) ?? [];
  const openOffersContracts = openOfferIds.map((id) => ({
    address: otcAddress!,
    abi,
    functionName: "offers" as const,
    args: [id] as const,
    chainId,
  }));

  // Type assertion to avoid deep type instantiation with wagmi's complex generics
  const openOffersConfig = {
    contracts: openOffersContracts,
    query: {
      enabled:
        enabled &&
        Array.isArray(openOfferIdsRes.data) &&
        openOfferIds.length > 0,
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const openOffersRes = useReadContracts(openOffersConfig as any);

  const { writeContractAsync: writeContractAsyncBase, isPending } =
    useWriteContract();

  // Wrapper to handle writeContractAsync with dynamic ABIs
  // wagmi's types require chain/account which are inferred from context
  function writeContractAsync(
    config: ReadContractConfig & { value?: bigint },
  ): Promise<`0x${string}`> {
    return writeContractAsyncBase(
      config as unknown as Parameters<typeof writeContractAsyncBase>[0],
    );
  }

  async function claim(offerId: bigint) {
    if (!otcAddress) throw new Error("No OTC address");
    if (!account) throw new Error("No wallet connected");
    return writeContractAsync({
      address: otcAddress,
      abi,
      functionName: "claim",
      args: [offerId],
    });
  }

  async function createOffer(params: {
    tokenAmountWei: bigint;
    discountBps: number;
    paymentCurrency: 0 | 1;
    lockupSeconds?: bigint;
  }) {
    if (!otcAddress) throw new Error("No OTC address");
    if (!account) throw new Error("No wallet connected");
    return writeContractAsync({
      address: otcAddress,
      abi,
      functionName: "createOffer",
      args: [
        params.tokenAmountWei,
        BigInt(params.discountBps),
        params.paymentCurrency,
        params.lockupSeconds ?? 0n,
      ],
    });
  }

  async function approveOffer(offerId: bigint) {
    if (!otcAddress) throw new Error("No OTC address");
    if (!account) throw new Error("No wallet connected");
    return writeContractAsync({
      address: otcAddress,
      abi,
      functionName: "approveOffer",
      args: [offerId],
    });
  }

  async function cancelOffer(offerId: bigint) {
    if (!otcAddress) throw new Error("No OTC address");
    if (!account) throw new Error("No wallet connected");
    return writeContractAsync({
      address: otcAddress,
      abi,
      functionName: "cancelOffer",
      args: [offerId],
    });
  }

  async function fulfillOffer(offerId: bigint, valueWei?: bigint) {
    if (!otcAddress) throw new Error("No OTC address");
    if (!account) throw new Error("No wallet connected");
    return writeContractAsync({
      address: otcAddress,
      abi,
      functionName: "fulfillOffer",
      args: [offerId],
      value: valueWei,
    });
  }

  const usdcAddressRes = useReadContract({
    address: otcAddress,
    abi,
    functionName: "usdc",
    chainId,
    query: { enabled },
  });
  const usdcAddress = (usdcAddressRes.data as Address | undefined) ?? undefined;
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

  async function approveUsdc(amount: bigint) {
    if (!otcAddress || !usdcAddress) throw new Error("Missing addresses");
    if (!account) throw new Error("No wallet connected");
    return writeContractAsync({
      address: usdcAddress,
      abi: erc20Abi,
      functionName: "approve",
      args: [otcAddress, amount],
    });
  }

  async function emergencyRefund(offerId: bigint) {
    if (!otcAddress) throw new Error("No OTC address");
    if (!account) throw new Error("No wallet connected");
    return writeContractAsync({
      address: otcAddress,
      abi,
      functionName: "emergencyRefund",
      args: [offerId],
    });
  }

  async function withdrawConsignment(consignmentId: bigint) {
    if (!otcAddress) throw new Error("No OTC address");
    if (!account) throw new Error("No wallet connected");
    return writeContractAsync({
      address: otcAddress,
      abi,
      functionName: "withdrawConsignment",
      args: [consignmentId],
    });
  }

  async function createConsignmentOnChain(
    params: ConsignmentParams,
  ): Promise<ConsignmentCreationResult> {
    if (!otcAddress) throw new Error("No OTC address");
    if (!account) throw new Error("No wallet connected");

    // Fetch token data to get the contract's tokenId (keccak256 hash)
    const tokenResponse = await fetch(`/api/tokens/${params.tokenId}`);
    if (!tokenResponse.ok) {
      throw new Error(`Failed to fetch token data for ${params.tokenId}`);
    }
    const tokenData = await tokenResponse.json();
    if (!tokenData.success || !tokenData.token) {
      throw new Error(`Token ${params.tokenId} not found`);
    }

    // Get the symbol and compute the contract tokenId (keccak256 of the symbol)
    const tokenIdBytes32 = keccak256(stringToBytes(tokenData.token.symbol));

    const txHash = await writeContractAsync({
      address: otcAddress,
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
        params.isFractionalized,
        params.isPrivate,
        params.maxPriceVolatilityBps,
        params.maxTimeToExecute,
      ],
      value: params.gasDeposit,
    });

    // Wait for transaction receipt and parse the consignmentId from the event
    console.log("[useOTC] Waiting for transaction receipt:", txHash);
    if (!publicClient) {
      throw new Error("Public client not available");
    }
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash as `0x${string}`,
    });
    console.log("[useOTC] Receipt received, parsing ConsignmentCreated event");
    console.log("[useOTC] Receipt logs count:", receipt.logs.length);
    console.log("[useOTC] OTC contract address:", otcAddress);

    // Find ConsignmentCreated event from the OTC contract
    // Cast logs to include topics which are present but not in the narrow type
    const logs = receipt.logs as TransactionLog[];
    const consignmentCreatedEvent = logs.find((log) => {
      // Check if log is from our OTC contract
      if (log.address.toLowerCase() !== otcAddress.toLowerCase()) {
        return false;
      }

      try {
        const decoded = decodeEventLog({
          abi,
          data: log.data,
          topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
        });
        console.log("[useOTC] Decoded event:", decoded.eventName);
        return decoded.eventName === "ConsignmentCreated";
      } catch (e) {
        console.log("[useOTC] Failed to decode log:", e);
        return false;
      }
    });

    if (!consignmentCreatedEvent) {
      console.error(
        "[useOTC] No ConsignmentCreated event found. Receipt logs:",
        receipt.logs,
      );
      throw new Error(
        "ConsignmentCreated event not found in transaction receipt",
      );
    }

    const decoded = decodeEventLog({
      abi,
      data: consignmentCreatedEvent.data,
      topics: consignmentCreatedEvent.topics as [
        `0x${string}`,
        ...`0x${string}`[],
      ],
    });

    const args = decoded.args as unknown as Record<string, unknown>;
    const consignmentId = args.consignmentId as bigint;
    console.log(
      "[useOTC] Consignment created with ID:",
      consignmentId.toString(),
    );

    return { txHash: txHash as `0x${string}`, consignmentId };
  }

  async function approveToken(tokenAddress: Address, amount: bigint) {
    if (!account) throw new Error("No wallet connected");
    if (!otcAddress) throw new Error("OTC contract address not configured");

    const network = process.env.NEXT_PUBLIC_NETWORK || "testnet";
    console.log("[useOTC] approveToken - network config:", network);
    console.log("[useOTC] approveToken - token:", tokenAddress);
    console.log("[useOTC] approveToken - spender (OTC):", otcAddress);
    console.log("[useOTC] approveToken - wallet chainId:", chainId);
    console.log("[useOTC] approveToken - amount:", amount.toString());

    // Warn if there might be a network mismatch
    const isMainnetConfig = network === "mainnet";
    const isMainnetWallet = chainId === 8453; // Base mainnet
    const isTestnetWallet = chainId === 84532; // Base Sepolia

    if (isMainnetConfig && isTestnetWallet) {
      console.error(
        "[useOTC] NETWORK MISMATCH: App is configured for mainnet but wallet is on Base Sepolia",
      );
      throw new Error(
        "Network mismatch: Please switch your wallet to Base mainnet",
      );
    }
    if (!isMainnetConfig && isMainnetWallet) {
      console.error(
        "[useOTC] NETWORK MISMATCH: App is configured for testnet but wallet is on Base mainnet",
      );
      throw new Error(
        "Network mismatch: Please switch your wallet to Base Sepolia (testnet) or set NEXT_PUBLIC_NETWORK=mainnet",
      );
    }

    return writeContractAsync({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: "approve",
      args: [otcAddress, amount],
    });
  }

  // Helper to extract contract address from tokenId format: "token-{chain}-{address}"
  function extractContractAddress(tokenId: string): Address {
    const parts = tokenId.split("-");
    if (parts.length >= 3) {
      // Format is: token-chain-address, so join everything after the second dash
      return parts.slice(2).join("-") as Address;
    }
    // Fallback: assume it's already an address
    return tokenId as Address;
  }

  async function getTokenAddress(tokenId: string): Promise<Address> {
    // Simply extract the contract address from the tokenId
    // The tokenId format is "token-{chain}-{contractAddress}"
    return extractContractAddress(tokenId);
  }

  async function getRequiredGasDeposit(): Promise<bigint> {
    if (!otcAddress) throw new Error("No OTC address");
    if (!publicClient) throw new Error("Public client not available");
    return readContractFromClient<bigint>(publicClient, {
      address: otcAddress,
      abi,
      functionName: "requiredGasDepositPerConsignment",
    });
  }

  // Helper to get exact required payment amount
  async function getRequiredPayment(
    offerId: bigint,
    currency: "ETH" | "USDC",
  ): Promise<bigint> {
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
  }

  const agentAddr = (agentRes.data as Address | undefined) ?? undefined;
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

  const myOffers: (Offer & { id: bigint })[] = useMemo(() => {
    const base = myOffersRes.data ?? [];
    console.log(
      "[useOTC] myOfferIds:",
      myOfferIds.map((id) => id.toString()),
    );
    console.log("[useOTC] Raw response count:", base.length);
    console.log("[useOTC] Using contract address:", otcAddress);
    console.log("[useOTC] Wagmi query status:", {
      isLoading: myOffersRes.isLoading,
      isError: myOffersRes.isError,
      isFetching: myOffersRes.isFetching,
    });

    const offers = myOfferIds.map((id, idx) => {
      const rawResult = base[idx]?.result;

      console.log(`[useOTC] Offer ${id} raw result:`, rawResult);

      // Contract returns array: [consignmentId, tokenId, beneficiary, tokenAmount, discountBps, createdAt, unlockTime,
      //   priceUsdPerToken, maxPriceDeviation, ethUsdPrice, currency, approved, paid, fulfilled, cancelled, payer, amountPaid]
      if (Array.isArray(rawResult)) {
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
        ] = rawResult;

        console.log(`[useOTC] Offer ${id} parsed:`, {
          paid,
          fulfilled,
          cancelled,
          beneficiary,
          tokenAmount: tokenAmount?.toString(),
        });

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
        } as Offer & { id: bigint };
      }

      console.warn(`[useOTC] Offer ${id}: Invalid data format`, rawResult);
      return {
        id,
        paid: false,
        fulfilled: false,
        cancelled: false,
      } as Offer & { id: bigint };
    });

    console.log("[useOTC] Total offers parsed:", offers.length);
    const paidOffers = offers.filter((o) => o.paid);
    console.log(
      "[useOTC] Paid offers:",
      paidOffers.length,
      paidOffers.map((o) => o.id.toString()),
    );
    return offers;
  }, [
    myOfferIds,
    myOffersRes.data,
    myOffersRes.isLoading,
    myOffersRes.isError,
    myOffersRes.isFetching,
    otcAddress,
  ]);

  return {
    otcAddress,
    availableTokens: (availableTokensRes.data as bigint | undefined) ?? 0n,
    myOfferIds,
    myOffers,
    openOfferIds: ((openOfferIdsRes.data as bigint[] | undefined) ??
      []) as bigint[],
    openOffers: (openOffersRes.data ?? [])
      .map((x) => x?.result as Offer | undefined)
      .filter((x): x is Offer => x !== undefined),
    agent: agentAddr,
    isAgent,
    isApprover,
    usdcAddress,
    ethBalanceWei: (ethBalRes.data?.value as bigint | undefined) ?? undefined,
    usdcBalance: (usdcBalanceRes.data as bigint | undefined) ?? undefined,
    minUsdAmount: (minUsdRes.data as bigint | undefined) ?? undefined,
    maxTokenPerOrder: (maxTokenRes.data as bigint | undefined) ?? undefined,
    quoteExpirySeconds: (expiryRes.data as bigint | undefined) ?? undefined,
    defaultUnlockDelaySeconds:
      (unlockDelayRes.data as bigint | undefined) ?? undefined,
    emergencyRefundsEnabled:
      (emergencyRefundsRes.data as boolean | undefined) ?? false,
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
    createOffer,
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
  } as const;
}
