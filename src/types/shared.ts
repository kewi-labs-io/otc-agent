/**
 * Shared Type Definitions
 * Consolidated types used across multiple files to eliminate duplication
 */

import type {
  PublicKey as SolanaPublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import type { Address } from "viem";
import type { Chain, ChainFamily } from "@/config/chains";

//==============================================================================
// SOLANA TYPES
//==============================================================================

/**
 * Solana transaction interface compatible with @solana/web3.js
 */
export interface SolanaTransaction {
  serialize(): Uint8Array;
  signatures: Array<{
    publicKey: { toBase58(): string };
    signature: Uint8Array | null;
  }>;
}

/**
 * Solana wallet adapter interface for signing transactions
 */
export interface SolanaWalletAdapter {
  publicKey: { toBase58: () => string } | null;
  signTransaction: <T extends SolanaTransaction>(tx: T) => Promise<T>;
  signAllTransactions: <T extends SolanaTransaction>(txs: T[]) => Promise<T[]>;
}

/**
 * Phantom wallet provider interface
 */
export interface PhantomProvider {
  isPhantom?: boolean;
  isConnected?: boolean;
  publicKey?: { toBase58(): string };
  connect: () => Promise<{ publicKey: { toBase58(): string } }>;
  signTransaction: <T extends SolanaTransaction>(tx: T) => Promise<T>;
  signAllTransactions: <T extends SolanaTransaction>(txs: T[]) => Promise<T[]>;
}

/**
 * Wallet signer interface (simplified for Phantom/Privy compatibility)
 */
export interface WalletSigner {
  publicKey: string;
  signTransaction: <T extends SolanaTransaction>(tx: T) => Promise<T>;
  signAllTransactions: <T extends SolanaTransaction>(txs: T[]) => Promise<T[]>;
}

/**
 * Anchor wallet interface compatible with @coral-xyz/anchor
 */
export interface AnchorWallet {
  publicKey: SolanaPublicKey;
  signTransaction: <T extends Transaction | VersionedTransaction>(tx: T) => Promise<T>;
  signAllTransactions: <T extends Transaction | VersionedTransaction>(txs: T[]) => Promise<T[]>;
}

/**
 * Solana provider interface (Privy compatibility)
 */
export interface SolanaProvider {
  signTransaction: <T extends SolanaTransaction>(tx: T) => Promise<T>;
  signAllTransactions: <T extends SolanaTransaction>(txs: T[]) => Promise<T[]>;
}

/**
 * Privy Solana wallet type
 */
export interface PrivySolanaWallet {
  address: string;
  chainType?: string;
  getProvider?: () => Promise<SolanaProvider>;
}

/**
 * Window type extension for Phantom wallet detection
 */
export interface PhantomWindow extends Window {
  phantom?: { solana?: PhantomProvider };
  solana?: PhantomProvider;
}

/**
 * Phantom Solana provider type
 */
export interface PhantomSolanaProvider {
  isPhantom?: boolean;
  publicKey?: { toBase58(): string };
  signTransaction: <T extends SolanaTransaction>(tx: T) => Promise<T>;
  signAllTransactions: <T extends SolanaTransaction>(txs: T[]) => Promise<T[]>;
  connect: () => Promise<{ publicKey: { toBase58(): string } }>;
  isConnected?: boolean;
}

//==============================================================================
// CHAIN & NETWORK TYPES
//==============================================================================

// ChainType is exported from @/lib/plugin-otc-desk/types (source of truth)
// NetworkType is exported from @/config/contracts.ts (source of truth)

/**
 * Quote chain type (for UI components)
 */
export type QuoteChain = "base" | "bsc" | "ethereum" | "solana" | null;

//==============================================================================
// CURRENCY & PAYMENT TYPES
//==============================================================================

/**
 * Payment currency options
 * Re-export from Zod validation schemas
 */
import type { PaymentCurrency } from "@/types/validation/schemas";
export type Currency = PaymentCurrency;

/**
 * Native price symbols (excludes USDC)
 */
export type NativePriceSymbol = Exclude<Currency, "USDC">;

/**
 * Native currency prices map
 */
export type NativePrices = Partial<Record<NativePriceSymbol, number>>;

//==============================================================================
// OTC CONTRACT TYPES
//==============================================================================

/**
 * Solana Desk account structure
 */
export interface DeskAccount {
  minUsdAmount8D: { toString(): string } | bigint;
  defaultUnlockDelaySecs?: { toString(): string } | bigint;
  maxLockupSecs?: { toString(): string } | bigint;
  nextOfferId?: { toString(): string } | bigint;
  usdcMint?: SolanaPublicKey;
  agent?: SolanaPublicKey;
  solUsdPrice8D?: { toNumber(): number };
}

/**
 * Solana Token Registry account structure
 */
export interface TokenRegistryAccount {
  tokenUsdPrice8D: { toString(): string } | bigint;
  decimals: number;
}

/**
 * Solana Consignment account structure (from on-chain)
 */
export interface SolanaConsignmentAccount {
  id: { toString(): string };
  consigner: SolanaPublicKey;
  desk: SolanaPublicKey;
  tokenMint: SolanaPublicKey;
  isActive: boolean;
  remainingAmount: { toString(): string };
}

/**
 * Anchor program account accessor for Desk
 * Used to type `program.account.desk.fetch()`
 */
export interface AnchorDeskAccountAccessor {
  desk: {
    fetch: (
      address: SolanaPublicKey,
    ) => Promise<DeskAccount & { nextOfferId: { toString(): string } }>;
  };
}

/**
 * Anchor program account accessor for Consignment
 * Used to type `program.account.consignment.fetch()`
 */
export interface AnchorConsignmentAccountAccessor {
  consignment: {
    fetch: (address: SolanaPublicKey) => Promise<SolanaConsignmentAccount>;
  };
}

/**
 * Combined Anchor program account accessor
 * Used to type `program.account` with all account types
 */
export interface AnchorProgramAccountAccessor
  extends AnchorDeskAccountAccessor,
    AnchorConsignmentAccountAccessor {}

/**
 * Price update response from API
 */
export interface PriceUpdateResponse {
  price?: number;
  newPrice?: number;
  oldPrice?: number;
  updated?: boolean;
  method?: string;
  error?: string;
  priceUsd?: number;
  stale?: boolean;
  reason?: string;
}

//==============================================================================
// UI STATE TYPES
//==============================================================================

/**
 * Step status for multi-step flows
 */
export type StepStatus = "pending" | "running" | "success" | "error" | "skipped";

/**
 * Step definition for flow tests
 */
export interface Step {
  id: string;
  name: string;
  status: StepStatus;
  error?: string;
  txHash?: string;
  details?: string;
}

/**
 * Test state for flow tests
 */
export interface TestState {
  chain: ChainFamily;
  steps: Step[];
  logs: string[];
  consignmentId?: string;
  offerId?: string;
  tokenAddress?: string;
  tokenSymbol?: string;
}

/**
 * Modal step state for accept quote modal
 */
export type StepState = "amount" | "sign" | "creating" | "await_approval" | "paying" | "complete";

/**
 * Token metadata for UI display
 */
export interface TokenMetadata {
  symbol: string;
  name: string;
  logoUrl: string;
  contractAddress: string;
}

/**
 * Accept quote modal state
 */
export interface ModalState {
  tokenAmount: number;
  currency: Currency;
  step: StepState;
  isProcessing: boolean;
  error: string | null;
  requireApprover: boolean;
  contractValid: boolean;
  solanaTokenMint: string | null;
  solanaTokenDecimals: number | null;
  tokenMetadata: TokenMetadata | null;
  completedTxHash: string | null;
  completedOfferId: string | null;
  contractConsignmentId: string | null;
  consignmentRemainingTokens: number | null;
}

/**
 * Accept quote modal action types
 */
export type ModalAction =
  | { type: "SET_TOKEN_AMOUNT"; payload: number }
  | { type: "SET_CURRENCY"; payload: Currency }
  | { type: "SET_STEP"; payload: StepState }
  | { type: "SET_PROCESSING"; payload: boolean }
  | { type: "SET_ERROR"; payload: string | null }
  | { type: "SET_REQUIRE_APPROVER"; payload: boolean }
  | { type: "SET_CONTRACT_VALID"; payload: boolean }
  | { type: "SET_SOLANA_TOKEN_MINT"; payload: string | null }
  | { type: "SET_SOLANA_DECIMALS"; payload: number | null }
  | { type: "SET_TOKEN_METADATA"; payload: TokenMetadata | null }
  | { type: "SET_CONTRACT_CONSIGNMENT_ID"; payload: string | null }
  | { type: "SET_CONSIGNMENT_REMAINING_TOKENS"; payload: number | null }
  | {
      type: "SET_COMPLETED";
      payload: { txHash: string | null; offerId: string };
    }
  | {
      type: "RESET";
      payload: {
        tokenAmount: number;
        currency: Currency;
      };
    }
  | { type: "START_TRANSACTION" }
  | { type: "TRANSACTION_ERROR"; payload: string };

/**
 * Raw message format from API (for parsing)
 * Required fields are validated at parse time - if missing, parseRoomMessage throws
 */
export interface RawRoomMessage {
  id: string;
  entityId: string;
  agentId: string;
  createdAt: number | string;
  content?:
    | string
    | {
        text?: string;
        xml?: string;
        quote?: Record<string, unknown>;
        type?: string;
      };
  text?: string;
}

/**
 * Deal filters state
 */
export interface FiltersState {
  chains: Chain[];
  minMarketCap: number;
  maxMarketCap: number;
  negotiableTypes: ("negotiable" | "fixed")[];
  searchQuery: string;
}

/**
 * Deal type filter
 */
export type DealType = "all" | "negotiable" | "fixed";

//==============================================================================
// CONSIGNMENT TYPES
//==============================================================================

/**
 * Consignment with display fields (sanitized for buyers)
 * This type represents consignments that have been sanitized to hide
 * sensitive negotiation terms from non-owners.
 *
 * For NEGOTIABLE deals: Shows "starting at" the worst possible deal
 *   - displayDiscountBps = minDiscountBps (lowest discount)
 *   - displayLockupDays = maxLockupDays (longest lockup)
 *   - Sensitive fields (maxDiscountBps, minLockupDays, etc.) are omitted
 *
 * For FIXED deals: Shows the actual fixed terms
 *   - displayDiscountBps = fixedDiscountBps
 *   - displayLockupDays = fixedLockupDays
 */
export interface ConsignmentWithDisplay {
  id: string;
  tokenId: string;
  consignerAddress: string;
  consignerEntityId: string;
  totalAmount: string;
  remainingAmount: string;
  isNegotiable: boolean;
  fixedDiscountBps?: number;
  fixedLockupDays?: number;
  minDiscountBps: number;
  // maxDiscountBps omitted for negotiable deals (sensitive)
  minLockupDays: number;
  // maxLockupDays omitted for negotiable deals (sensitive)
  // minDealAmount and maxDealAmount omitted for negotiable deals (sensitive)
  // allowedBuyers omitted for negotiable deals (sensitive)
  isFractionalized: boolean;
  isPrivate: boolean;
  maxPriceVolatilityBps: number;
  maxTimeToExecuteSeconds: number;
  status: "active" | "paused" | "depleted" | "withdrawn";
  contractConsignmentId?: string;
  chain: Chain;
  createdAt: number;
  updatedAt: number;
  lastDealAt?: number;
  // Display fields (sanitized)
  displayDiscountBps: number;
  displayLockupDays: number;
  termsType: "negotiable" | "fixed";
}

//==============================================================================
// TRANSACTION TYPES
//==============================================================================

/**
 * Solana transaction commitment level
 */
export type SolanaCommitment = "processed" | "confirmed" | "finalized";

/**
 * EVM public client interface (minimal for tx helpers)
 */
export interface EvmPublicClient {
  getTransactionReceipt: (args: { hash: `0x${string}` }) => Promise<{
    status: "success" | "reverted";
    blockNumber: bigint;
  } | null>;
}

/**
 * Transaction error type
 */
export interface TransactionError extends Error {
  message: string;
  cause?: {
    reason?: string;
    code?: string | number;
  };
  details?: string;
  shortMessage?: string;
}

//==============================================================================
// CHAIN RESET TYPES
//==============================================================================

/**
 * Chain reset detection state
 */
export interface ChainResetState {
  resetDetected: boolean;
  lastBlockNumber: bigint | null;
  checksEnabled: boolean;
}

//==============================================================================
// OAUTH & SHARING TYPES
//==============================================================================

/**
 * OAuth response from callback
 */
export interface OAuthResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  entityId?: string;
  username?: string;
  profileImageUrl?: string;
  oauth1_token?: string;
  oauth1_token_secret?: string;
  user_id?: string;
  screen_name?: string;
}

/**
 * Stored OAuth credentials
 */
export interface StoredCredentials {
  entityId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  username?: string;
  oauth1Token?: string;
  oauth1TokenSecret?: string;
}

/**
 * X (Twitter) credentials
 */
export interface XCredentials {
  entityId?: string;
  username?: string;
  screen_name?: string;
  oauth1Token?: string;
  oauth1TokenSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
}

/**
 * Pending share data
 */
export interface PendingShare {
  text: string;
  dataUrl: string;
}

//==============================================================================
// TEST TYPES
//==============================================================================

/**
 * Test environment type
 */
export type TestEnv = "local" | "testnet" | "mainnet";

/**
 * EVM test configuration
 */
export interface EvmConfig {
  readonly rpc: string;
  readonly chainId: number;
  readonly chainName: string;
  readonly blockExplorer: string;
}

/**
 * Solana test configuration
 */
export interface SolanaConfig {
  readonly rpc: string;
  readonly cluster: "localnet" | "devnet" | "mainnet-beta";
  readonly explorer: string;
}

/**
 * Test environment configuration
 */
export interface EnvConfig {
  readonly evm: EvmConfig;
  readonly solana: SolanaConfig;
  readonly appUrl: string;
}

/**
 * EVM wallet configuration for tests
 */
export interface EvmWalletConfig {
  readonly seedPhrase: string;
  readonly password: string;
  readonly address: `0x${string}`;
  readonly rpcUrl: string;
  readonly chainId: number;
}

/**
 * Solana wallet configuration for tests
 */
export interface SolanaWalletConfig {
  readonly seedPhrase: string;
  readonly password: string;
  readonly address: string;
  readonly rpcUrl: string;
}

/**
 * MetaMask fixtures for Synpress tests
 */
export interface MetaMaskFixtures {
  readonly _contextPath: string;
  readonly extensionId: string;
  readonly metamaskPage: {
    goto: (url: string) => Promise<void>;
    url: () => string;
  };
}

/**
 * EVM deployment snapshot for tests (minimal address info)
 * Note: Full deployment config with all fields is in @/config/contracts.ts
 */
export interface EvmDeploymentSnapshot {
  readonly otc: Address;
  readonly token: Address;
  readonly usdc: Address;
}

/**
 * Solana deployment snapshot for tests (minimal address info)
 * Note: Full deployment config with all fields is in @/config/contracts.ts
 */
export interface SolanaDeploymentSnapshot {
  readonly programId: string;
  readonly desk: string;
  readonly deskOwner: string;
  readonly usdcMint: string;
  readonly tokenMint?: string; // Test token for E2E tests (local only)
  readonly rpc: string;
}

/**
 * Offer snapshot for tests (mirrors on-chain Offer struct)
 */
export interface OfferSnapshot {
  readonly consignmentId: bigint;
  readonly tokenId: `0x${string}`;
  readonly beneficiary: Address;
  readonly tokenAmount: bigint;
  readonly discountBps: bigint;
  readonly createdAt: bigint;
  readonly unlockTime: bigint;
  readonly priceUsdPerToken: bigint;
  readonly maxPriceDeviation: bigint;
  readonly ethUsdPrice: bigint;
  readonly currency: number;
  readonly approved: boolean;
  readonly paid: boolean;
  readonly fulfilled: boolean;
  readonly cancelled: boolean;
  readonly payer: Address;
  readonly amountPaid: bigint;
  readonly agentCommissionBps: number;
}

/**
 * Consignment snapshot for tests
 */
export interface ConsignmentSnapshot {
  readonly tokenId: `0x${string}`;
  readonly consigner: Address;
  readonly totalAmount: bigint;
  readonly remainingAmount: bigint;
  readonly isNegotiable: boolean;
  readonly fixedDiscountBps: bigint;
  readonly fixedLockupDays: bigint;
  readonly minDiscountBps: bigint;
  readonly maxDiscountBps: bigint;
  readonly minLockupDays: bigint;
  readonly maxLockupDays: bigint;
  readonly minDealAmount: bigint;
  readonly maxDealAmount: bigint;
  readonly maxPriceVolatilityBps: bigint;
  readonly isActive: boolean;
  readonly createdAt: bigint;
}

/**
 * Solana Desk snapshot for tests
 */
export interface SolanaDeskSnapshot {
  readonly owner: string;
  readonly agent: string;
  readonly nextConsignmentId: bigint;
  readonly nextOfferId: bigint;
  readonly paused: boolean;
}

/**
 * Solana Consignment snapshot for tests
 */
export interface SolanaConsignmentSnapshot {
  readonly desk: string;
  readonly id: bigint;
  readonly tokenMint: string;
  readonly consigner: string;
  readonly totalAmount: bigint;
  readonly remainingAmount: bigint;
  readonly isNegotiable: boolean;
  readonly isActive: boolean;
}

/**
 * Solana Offer snapshot for tests
 */
export interface SolanaOfferSnapshot {
  readonly desk: string;
  readonly consignmentId: bigint;
  readonly tokenMint: string;
  readonly id: bigint;
  readonly beneficiary: string;
  readonly tokenAmount: bigint;
  readonly discountBps: number;
  readonly approved: boolean;
  readonly paid: boolean;
  readonly fulfilled: boolean;
  readonly cancelled: boolean;
}

//==============================================================================
// EVM CONTRACT EVENT TYPES
//==============================================================================

/**
 * ConsignmentCreated event args from EVM OTC contract
 */
export interface ConsignmentCreatedArgs {
  readonly consignmentId: bigint;
  readonly tokenId: `0x${string}`;
  readonly consigner: `0x${string}`;
  readonly amount: bigint;
}

/**
 * OfferCreated event args from EVM OTC contract
 */
export interface OfferCreatedArgs {
  readonly offerId: bigint;
  readonly consignmentId: bigint;
  readonly beneficiary: `0x${string}`;
  readonly amount: bigint;
}

/**
 * OfferApproved event args from EVM OTC contract
 */
export interface OfferApprovedArgs {
  readonly offerId: bigint;
}

/**
 * OfferFulfilled event args from EVM OTC contract
 */
export interface OfferFulfilledArgs {
  readonly offerId: bigint;
  readonly beneficiary: `0x${string}`;
  readonly amount: bigint;
}

//==============================================================================
// OFFER TUPLE TYPES (for contract reads)
//==============================================================================

/**
 * EVM Offer tuple from contract read
 */
export type OfferTuple = readonly [
  `0x${string}`, // beneficiary
  bigint, // tokenAmount
  bigint, // discountBps
  bigint, // createdAt
  bigint, // unlockTime
  bigint, // priceUsdPerToken
  bigint, // maxPriceDeviation
  bigint, // ethUsdPrice
  number, // currency
  boolean, // paid
  boolean, // fulfilled
  boolean, // cancelled
  `0x${string}`, // payer
  bigint, // amountPaid
];

//==============================================================================
// MARKDOWN TYPES
//==============================================================================

/**
 * Markdown override component config (from markdown-to-jsx)
 */
export interface MarkdownOverrideConfig {
  component: React.ComponentType<Record<string, unknown>> | string | (() => null);
  props?: Record<string, unknown>;
}

/**
 * Markdown options (from markdown-to-jsx)
 * Note: This is a simplified subset of the library's Options type
 */
export interface MarkdownOptions {
  overrides?: Record<string, React.ComponentType<Record<string, unknown>> | MarkdownOverrideConfig>;
  wrapper?: React.ComponentType<Record<string, unknown>> | string | null;
  forceBlock?: boolean;
  forceInline?: boolean;
  namedCodesToUnicode?: Record<string, string>;
  createElement?: (
    type: string | React.ComponentType<Record<string, unknown>>,
    props: Record<string, unknown>,
    ...children: React.ReactNode[]
  ) => React.ReactNode;
}

/**
 * Markdown block props
 */
export interface MarkdownBlockProps {
  content: string;
  options?: MarkdownOptions;
}

/**
 * Memoized markdown props
 */
export interface MemoizedMarkdownProps {
  content: string;
  id: string;
  options?: MarkdownOptions;
}

//==============================================================================
// POOL CHECK TYPES
//==============================================================================

/**
 * Simplified pool info for UI display and API responses
 */
export interface PoolCheckPool {
  address: string;
  protocol: string;
  tvlUsd: number;
  priceUsd?: number;
  baseToken: "USDC" | "WETH";
}

/**
 * Result from pool check API
 */
export interface PoolCheckResult {
  success: boolean;
  tokenAddress: string;
  chain: Chain;
  isRegistered: boolean;
  hasPool: boolean;
  pool?: PoolCheckPool;
  allPools?: PoolCheckPool[]; // All available pools sorted by TVL
  registrationFee?: string; // In wei
  registrationFeeEth?: string; // Human readable
  warning?: string;
  error?: string;
}
