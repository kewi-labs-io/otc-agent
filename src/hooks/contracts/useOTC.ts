"use client";

import { useCallback, useMemo, useRef } from "react";
import {
  useAccount,
  useReadContract,
  useReadContracts,
  useWriteContract,
  useChainId,
  useBalance,
  usePublicClient,
  useSwitchChain,
} from "wagmi";
import { keccak256, encodePacked, decodeEventLog, createPublicClient, http } from "viem";
import type { Abi, Address, Chain as ViemChain } from "viem";
import { mainnet, sepolia, base, baseSepolia, bsc, bscTestnet } from "viem/chains";
import type {
  Offer,
  ConsignmentParams,
  ConsignmentCreationResult,
} from "@/types";
import otcArtifact from "@/contracts/artifacts/contracts/OTC.sol/OTC.json";
import { getCurrentNetwork } from "@/config/contracts";
import { SUPPORTED_CHAINS, type Chain } from "@/config/chains";
import { findBestPool } from "@/utils/pool-finder-base";

// Cache for OTC addresses per chain
const otcAddressCache: Record<string, Address | undefined> = {};
const addressLoggedForChain: Record<string, boolean> = {};

// Get OTC address for a specific chain
function getOtcAddressForChain(chain: Chain): Address | undefined {
  const cacheKey = chain;
  if (otcAddressCache[cacheKey] !== undefined) {
    return otcAddressCache[cacheKey];
  }

  const chainConfig = SUPPORTED_CHAINS[chain];
  const otcAddress = chainConfig?.contracts?.otc;

  if (otcAddress) {
    if (process.env.NODE_ENV === "development" && !addressLoggedForChain[cacheKey]) {
      console.log(`[useOTC] OTC address for ${chain}:`, otcAddress);
      addressLoggedForChain[cacheKey] = true;
    }
    otcAddressCache[cacheKey] = otcAddress as Address;
    return otcAddressCache[cacheKey];
  }

  if (!addressLoggedForChain[cacheKey]) {
    console.warn(`[useOTC] No OTC address found for chain: ${chain}`);
    addressLoggedForChain[cacheKey] = true;
  }
  return undefined;
}

// Helper to get default OTC address (Base) - for backward compatibility
function getOtcAddress(): Address | undefined {
  return getOtcAddressForChain("base");
}

// Get the numeric chain ID for a chain string
function getChainId(chain: Chain): number | undefined {
  return SUPPORTED_CHAINS[chain]?.chainId;
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
  createOfferFromConsignment: (params: {
    consignmentId: bigint;
    tokenAmountWei: bigint;
    discountBps: number;
    paymentCurrency: 0 | 1;
    lockupSeconds: bigint;
    agentCommissionBps: number; // 0 for P2P, 25-150 for negotiated
  }) => Promise<unknown>;
  approveOffer: (offerId: bigint) => Promise<unknown>;
  cancelOffer: (offerId: bigint) => Promise<unknown>;
  fulfillOffer: (offerId: bigint, valueWei?: bigint) => Promise<unknown>;
  approveUsdc: (amount: bigint) => Promise<unknown>;
  emergencyRefund: (offerId: bigint) => Promise<unknown>;
  withdrawConsignment: (consignmentId: bigint) => Promise<unknown>;
  createConsignmentOnChain: (
    params: ConsignmentParams & { chain?: Chain },
    onTxSubmitted?: (txHash: string) => void,
  ) => Promise<ConsignmentCreationResult>;
  approveToken: (tokenAddress: Address, amount: bigint, chain?: Chain) => Promise<unknown>;
  getTokenAddress: (tokenId: string) => Promise<Address>;
  getRequiredGasDeposit: (chain?: Chain) => Promise<bigint>;
  getRequiredPayment: (
    offerId: bigint,
    currency: "ETH" | "USDC",
  ) => Promise<bigint>;
  switchToChain: (chain: Chain) => Promise<void>;
  getOtcAddressForChain: (chain: Chain) => Address | undefined;
  isTokenRegistered: (tokenAddress: Address, chain?: Chain) => Promise<boolean>;
  registerToken: (tokenAddress: Address, poolAddress: Address, chain?: Chain) => Promise<`0x${string}`>;
  getRegistrationFee: (chain?: Chain) => Promise<bigint>;
} {
  const { address: account } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  
  // OTC address from env vars or deployment config (default to Base)
  const otcAddress = getOtcAddress();
  const abi = otcArtifact.abi as Abi;

  // Use wagmi's public client which automatically handles all configured chains
  const publicClient = usePublicClient();

  // Helper to switch to a specific chain with verification
  const switchToChain = useCallback(async (chain: Chain): Promise<void> => {
    const targetChainId = getChainId(chain);
    if (!targetChainId) {
      throw new Error(`Unknown chain: ${chain}`);
    }
    
    if (chainId === targetChainId) {
      console.log(`[useOTC] Already on chain ${chain} (${targetChainId})`);
      return;
    }
    
    console.log(`[useOTC] Switching from chain ${chainId} to ${chain} (${targetChainId})`);
    const result = await switchChainAsync({ chainId: targetChainId });
    
    // Verify the chain actually switched
    if (result.id !== targetChainId) {
      throw new Error(`Failed to switch to ${chain}. Wallet is on chain ${result.id} instead of ${targetChainId}. Please switch your wallet to ${chain} manually.`);
    }
    
    console.log(`[useOTC] Successfully switched to ${chain} (${result.id})`);
  }, [chainId, switchChainAsync]);

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
    const ids = (myOfferIdsRes.data as bigint[] | undefined) ?? [];

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
    [otcAddress, account, abi],
  );

  const createOfferFromConsignment = useCallback(
    async (params: {
      consignmentId: bigint;
      tokenAmountWei: bigint;
      discountBps: number;
      paymentCurrency: 0 | 1;
      lockupSeconds: bigint;
      agentCommissionBps: number; // 0 for P2P, 25-150 for negotiated
    }) => {
      if (!otcAddress) throw new Error("No OTC address");
      if (!account) throw new Error("No wallet connected");
      return writeContractAsync({
        address: otcAddress,
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
    [otcAddress, account, abi],
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
    [otcAddress, account, abi],
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
    [otcAddress, account, abi],
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
    [otcAddress, account, abi],
  );

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
    [otcAddress, usdcAddress, account],
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
    [otcAddress, account, abi],
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
    [otcAddress, account, abi],
  );

  const createConsignmentOnChain = useCallback(
    async (
      params: ConsignmentParams & { chain?: Chain },
      onTxSubmitted?: (txHash: string) => void,
    ): Promise<ConsignmentCreationResult> => {
      if (!account) throw new Error("No wallet connected");

      // Get the OTC address for the specified chain (or default to Base)
      const targetChain = params.chain || "base";
      const targetOtcAddress = getOtcAddressForChain(targetChain);
      
      if (!targetOtcAddress) {
        throw new Error(`OTC contract address not configured for chain: ${targetChain}`);
      }
      
      console.log(`[useOTC] Creating consignment on chain: ${targetChain}`);
      console.log(`[useOTC] Using OTC address: ${targetOtcAddress}`);

      // Switch to the correct chain if needed
      const targetChainId = getChainId(targetChain);
      if (targetChainId && chainId !== targetChainId) {
        console.log(`[useOTC] Switching wallet to ${targetChain} (chainId: ${targetChainId})`);
        await switchToChain(targetChain);
      }

      // Compute the contract tokenId (keccak256 of the token address)
      // This must match how RegistrationHelper computes tokenId: keccak256(abi.encodePacked(tokenAddress))
      const tokenIdBytes32 = keccak256(encodePacked(['address'], [params.tokenAddress as `0x${string}`]));
      console.log(`[useOTC] Token address: ${params.tokenAddress}`);
      console.log(`[useOTC] Computed tokenId: ${tokenIdBytes32}`);

      // Check if token is registered on the OTC contract
      const isRegistered = await isTokenRegistered(params.tokenAddress as Address, targetChain);
      console.log(`[useOTC] Token registered: ${isRegistered}`);
      
      // Auto-register if not registered (first consignment for this token)
      if (!isRegistered) {
        console.log(`[useOTC] Token not registered, finding best pool for auto-registration...`);
        
        // Find the best pool for this token
        const targetChainId = getChainId(targetChain);
        if (!targetChainId) {
          throw new Error(`Could not get chain ID for: ${targetChain}`);
        }
        
        const poolInfo = await findBestPool(params.tokenAddress, targetChainId);
        if (!poolInfo) {
          throw new Error(`No liquidity pool found for token ${params.tokenAddress} on ${targetChain}. Cannot auto-register token without a valid Uniswap V3 or compatible pool.`);
        }
        
        console.log(`[useOTC] Found pool: ${poolInfo.address} (${poolInfo.protocol}, TVL: $${poolInfo.tvlUsd.toFixed(2)})`);
        
        // Register the token
        const chainConfig = SUPPORTED_CHAINS[targetChain];
        const registrationHelperAddress = chainConfig?.contracts?.registrationHelper;
        
        if (!registrationHelperAddress) {
          throw new Error(`RegistrationHelper not configured for chain: ${targetChain}. Token must be registered manually.`);
        }
        
        // Get registration fee
        const fee = await getRegistrationFee(targetChain);
        console.log(`[useOTC] Registration fee: ${fee.toString()} wei`);
        
        console.log(`[useOTC] Auto-registering token ${params.tokenAddress} with pool ${poolInfo.address}...`);
        
        const regTxHash = await writeContractAsync({
          address: registrationHelperAddress as Address,
          abi: registrationHelperAbi,
          functionName: "registerTokenWithPayment",
          args: [params.tokenAddress as Address, poolInfo.address as Address],
          value: fee,
        });
        
        console.log(`[useOTC] Token registration tx submitted: ${regTxHash}`);
        
        // Wait for registration tx to be mined
        const viemChain = getViemChain(targetChain);
        const chainRpcUrl = SUPPORTED_CHAINS[targetChain]?.rpcUrl;
        
        if (viemChain && chainRpcUrl) {
          const targetPublicClient = createPublicClient({
            chain: viemChain,
            transport: http(chainRpcUrl),
          });
          
          // Poll for receipt (max 30 seconds)
          let receipt = null;
          for (let i = 0; i < 15; i++) {
            try {
              receipt = await targetPublicClient.getTransactionReceipt({ hash: regTxHash });
              if (receipt) {
                console.log(`[useOTC] Token registration confirmed in block ${receipt.blockNumber}`);
                break;
              }
            } catch {
              // Receipt not found yet
            }
            await new Promise(r => setTimeout(r, 2000));
          }
          
          if (!receipt) {
            console.warn("[useOTC] Could not confirm registration tx, proceeding anyway...");
          }
        }
      }

      // OTC.sol createConsignment signature:
      // bytes32 tokenId, uint256 amount, bool isNegotiable, uint16 fixedDiscountBps, uint32 fixedLockupDays,
      // uint16 minDiscountBps, uint16 maxDiscountBps, uint32 minLockupDays, uint32 maxLockupDays,
      // uint256 minDealAmount, uint256 maxDealAmount, uint16 maxPriceVolatilityBps
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
      // Use manual polling to avoid RPC timeout/rate limit issues
      console.log("[useOTC] Waiting for transaction receipt:", txHash);
      
      // Create a public client for the target chain to read the receipt
      const viemChain = getViemChain(targetChain);
      const chainRpcUrl = SUPPORTED_CHAINS[targetChain]?.rpcUrl;
      
      if (!viemChain || !chainRpcUrl) {
        console.warn("[useOTC] Could not get chain config for receipt polling");
        const fallbackId = BigInt(txHash.slice(0, 18));
        return { txHash: txHash as `0x${string}`, consignmentId: fallbackId };
      }
      
      const targetPublicClient = createPublicClient({
        chain: viemChain,
        transport: http(chainRpcUrl),
      });

      // Quick poll for receipt - if not found fast, use fallback ID
      // Backend can resolve actual consignmentId later via tx hash
      let receipt = null;
      const maxAttempts = 5; // 5 attempts * 2 seconds = 10 seconds max
      const pollInterval = 2000;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          receipt = await targetPublicClient.getTransactionReceipt({
            hash: txHash as `0x${string}`,
          });
          if (receipt) {
            console.log(`[useOTC] Receipt found on attempt ${attempt}`);
            break;
          }
        } catch {
          // Receipt not found yet
        }

        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, pollInterval));
        }
      }

      if (!receipt) {
        console.warn(
          `[useOTC] No receipt after ${maxAttempts} attempts, using fallback`,
        );
      }

      // If we got a receipt, parse the consignment ID from the event
      if (receipt) {
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

        if (consignmentCreatedEvent) {
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

        console.warn(
          "[useOTC] No ConsignmentCreated event found in receipt, using tx hash as ID",
        );
      } else {
        console.warn(
          "[useOTC] Could not get receipt (timeout/rate limit), using tx hash as ID",
        );
      }

      // Fallback: use a hash of the tx hash as the consignment ID
      // This allows the flow to continue even if RPC is rate limited
      // The actual consignment ID can be looked up later from the tx
      const fallbackId = BigInt(txHash.slice(0, 18));
      console.log(
        "[useOTC] Using fallback consignment ID:",
        fallbackId.toString(),
      );
      return { txHash: txHash as `0x${string}`, consignmentId: fallbackId };
    },
    [account, abi, chainId, switchToChain],
  );

  const approveToken = useCallback(
    async (tokenAddress: Address, amount: bigint, chain?: Chain) => {
      if (!account) throw new Error("No wallet connected");
      
      // Get the OTC address for the specified chain (or default to Base)
      const targetChain = chain || "base";
      const targetOtcAddress = getOtcAddressForChain(targetChain);
      
      if (!targetOtcAddress) {
        throw new Error(`OTC contract address not configured for chain: ${targetChain}`);
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
        console.log(`[useOTC] Switching wallet to ${targetChain} (chainId: ${targetChainId})`);
        await switchToChain(targetChain);
      }

      return writeContractAsync({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "approve",
        args: [targetOtcAddress, amount],
      });
    },
    [account, chainId, switchToChain],
  );

  // Helper to extract contract address from tokenId format: "token-{chain}-{address}"
  const extractContractAddress = useCallback((tokenId: string): Address => {
    const parts = tokenId.split("-");
    if (parts.length >= 3) {
      // Format is: token-chain-address, so join everything after the second dash
      return parts.slice(2).join("-") as Address;
    }
    // Fallback: assume it's already an address
    return tokenId as Address;
  }, []);

  const getTokenAddress = useCallback(
    async (tokenId: string): Promise<Address> => {
      // Simply extract the contract address from the tokenId
      // The tokenId format is "token-{chain}-{contractAddress}"
      return extractContractAddress(tokenId);
    },
    [extractContractAddress],
  );

  const getRequiredGasDeposit = useCallback(async (chain?: Chain): Promise<bigint> => {
    // Get the OTC address for the specified chain (or default to Base)
    const targetChain = chain || "base";
    const targetOtcAddress = getOtcAddressForChain(targetChain);
    
    if (!targetOtcAddress) {
      throw new Error(`OTC contract address not configured for chain: ${targetChain}`);
    }
    
    // Create a public client for the target chain
    const viemChain = getViemChain(targetChain);
    const chainRpcUrl = SUPPORTED_CHAINS[targetChain]?.rpcUrl;
    
    if (!viemChain || !chainRpcUrl) {
      throw new Error(`Could not get chain config for: ${targetChain}`);
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
  }, [abi]);

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

  // Check if a token is registered on the OTC contract
  const isTokenRegistered = useCallback(async (tokenAddress: Address, chain?: Chain): Promise<boolean> => {
    const targetChain = chain || "base";
    const targetOtcAddress = getOtcAddressForChain(targetChain);
    
    if (!targetOtcAddress) {
      throw new Error(`OTC contract address not configured for chain: ${targetChain}`);
    }
    
    // Compute tokenId the same way as RegistrationHelper
    const tokenIdBytes32 = keccak256(encodePacked(['address'], [tokenAddress]));
    
    const viemChain = getViemChain(targetChain);
    const chainRpcUrl = SUPPORTED_CHAINS[targetChain]?.rpcUrl;
    
    if (!viemChain || !chainRpcUrl) {
      throw new Error(`Could not get chain config for: ${targetChain}`);
    }
    
    const targetPublicClient = createPublicClient({
      chain: viemChain,
      transport: http(chainRpcUrl),
    });
    
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (targetPublicClient.readContract as (params: {
        address: Address;
        abi: typeof tokensAbi;
        functionName: string;
        args: readonly [`0x${string}`];
      }) => Promise<[Address, number, boolean, Address]>)({
        address: targetOtcAddress,
        abi: tokensAbi,
        functionName: "tokens",
        args: [tokenIdBytes32],
      });
      
      const [registeredAddress, , isActive] = result;
      console.log(`[useOTC] Token registration check: ${tokenAddress} -> isActive=${isActive}, registeredAddress=${registeredAddress}`);
      return isActive && registeredAddress !== "0x0000000000000000000000000000000000000000";
    } catch (err) {
      console.error("[useOTC] Error checking token registration:", err);
      return false;
    }
  }, []);

  // Get registration fee from RegistrationHelper
  const getRegistrationFee = useCallback(async (chain?: Chain): Promise<bigint> => {
    const targetChain = chain || "base";
    const chainConfig = SUPPORTED_CHAINS[targetChain];
    const registrationHelperAddress = chainConfig?.contracts?.registrationHelper;
    
    if (!registrationHelperAddress) {
      throw new Error(`RegistrationHelper not configured for chain: ${targetChain}`);
    }
    
    const viemChain = getViemChain(targetChain);
    const chainRpcUrl = chainConfig?.rpcUrl;
    
    if (!viemChain || !chainRpcUrl) {
      throw new Error(`Could not get chain config for: ${targetChain}`);
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
  }, []);

  // Register a token on the OTC contract via RegistrationHelper
  const registerToken = useCallback(async (
    tokenAddress: Address,
    poolAddress: Address,
    chain?: Chain,
  ): Promise<`0x${string}`> => {
    if (!account) throw new Error("No wallet connected");
    
    const targetChain = chain || "base";
    const chainConfig = SUPPORTED_CHAINS[targetChain];
    const registrationHelperAddress = chainConfig?.contracts?.registrationHelper;
    
    if (!registrationHelperAddress) {
      throw new Error(`RegistrationHelper not configured for chain: ${targetChain}`);
    }
    
    // Switch to the correct chain if needed
    const targetChainId = getChainId(targetChain);
    if (targetChainId && chainId !== targetChainId) {
      console.log(`[useOTC] Switching wallet to ${targetChain} for token registration`);
      await switchToChain(targetChain);
    }
    
    // Get registration fee
    const fee = await getRegistrationFee(targetChain);
    console.log(`[useOTC] Registration fee: ${fee.toString()} wei`);
    
    console.log(`[useOTC] Registering token ${tokenAddress} with pool ${poolAddress} on ${targetChain}`);
    
    return writeContractAsync({
      address: registrationHelperAddress as Address,
      abi: registrationHelperAbi,
      functionName: "registerTokenWithPayment",
      args: [tokenAddress, poolAddress],
      value: fee,
    });
  }, [account, chainId, switchToChain, getRegistrationFee]);

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

  // Track previous offers data to only log on actual changes
  const prevMyOffersDataRef = useRef<string | null>(null);

  const myOffers: (Offer & { id: bigint })[] = useMemo(() => {
    const base = myOffersRes.data ?? [];

    const offers = myOfferIds.map((id, idx) => {
      const rawResult = base[idx]?.result;

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

      return {
        id,
        paid: false,
        fulfilled: false,
        cancelled: false,
      } as Offer & { id: bigint };
    });

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
