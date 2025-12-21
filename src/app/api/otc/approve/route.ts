import type {
  PublicKey as SolanaPublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { promises as fs } from "fs";
import { type NextRequest, NextResponse } from "next/server";
import path from "path";
import {
  type Abi,
  type Account,
  type Address,
  createPublicClient,
  createWalletClient,
  http,
  type Chain as ViemChain,
} from "viem";
import { type PrivateKeyAccount, privateKeyToAccount } from "viem/accounts";
import { getSolanaConfig } from "@/config/contracts";
import { getEvmPrivateKey, getHeliusRpcUrl, getNetwork } from "@/config/env";
import otcArtifact from "@/contracts/artifacts/contracts/OTC.sol/OTC.json";
import { agentRuntime } from "@/lib/agent-runtime";
import { getChain, getViemChainForType } from "@/lib/getChain";
import { getOtcAddress } from "@/config/contracts";
import { parseOfferStruct, type RawOfferData } from "@/lib/otc-helpers";
import type { QuoteService } from "@/lib/plugin-otc-desk/services/quoteService";
import { validationErrorResponse } from "@/lib/validation/helpers";
import { safeReadContract } from "@/lib/viem-utils";
import type { QuoteMemory } from "@/types";
import {
  ApproveOfferRequestSchema,
  ApproveOfferResponseSchema,
} from "@/types/validation/api-schemas";
import { fetchJupiterPrices } from "@/utils/price-fetcher";

/**
 * Minimal wallet client interface for contract writes
 * Used to avoid viem's deep type instantiation issues with WalletClient generics
 *
 * The request parameter accepts the output of publicClient.simulateContract()
 * which includes all the fields needed for the transaction
 */
/**
 * Write contract request - accepts output from simulateContract()
 * This includes all fields needed for the transaction
 *
 * Note: args uses `readonly unknown[]` for viem compatibility - viem's type system
 * uses unknown[] because Solidity supports complex nested types that can't be
 * statically typed without ABI inference.
 */
interface WriteContractRequest {
  address: Address;
  abi: Abi;
  functionName: string;
  // Args from viem's simulateContract - uses unknown[] for ABI compatibility
  args?: readonly unknown[];
  value?: bigint;
  // Account from viem - LocalAccount, JsonRpcAccount, etc.
  account?: Account | Address;
  // Additional viem fields from simulateContract result (gas, nonce, etc.)
  gas?: bigint;
  gasPrice?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  nonce?: number;
  // Chain for the transaction
  chain?: ViemChain | null;
  // Data hash for pre-signed transactions
  dataSuffix?: `0x${string}`;
}

interface MinimalWalletClient {
  writeContract: (request: WriteContractRequest) => Promise<`0x${string}`>;
}

export async function POST(request: NextRequest) {
  return await handleApproval(request);
}

async function handleApproval(request: NextRequest) {
  // FAIL-FAST: Contract address must be configured
  const resolveOtcAddress = async (): Promise<Address> => {
    return getOtcAddress() as Address;
  };

  const OTC_ADDRESS = await resolveOtcAddress();

  // Check if we're running on local Anvil (use impersonation)
  const network = getNetwork();
  const isLocalNetwork = network === "local";

  // Only use EVM_PRIVATE_KEY in production, not on local Anvil
  const evmKey = isLocalNetwork ? undefined : getEvmPrivateKey();
  if (evmKey && !/^0x[0-9a-fA-F]{64}$/.test(evmKey)) {
    throw new Error(
      "EVM_PRIVATE_KEY has invalid format - must be 64 hex characters with 0x prefix",
    );
  }
  const EVM_PRIVATE_KEY = evmKey ? (evmKey as `0x${string}`) : undefined;
  if (isLocalNetwork) {
    console.log("[Approve API] Local network detected, using impersonation");
  }

  // Content-Type header is required for JSON parsing
  const contentType = request.headers.get("content-type");
  if (!contentType || !contentType.includes("application/json")) {
    return NextResponse.json(
      { error: "Content-Type header must be application/json" },
      { status: 400 },
    );
  }
  let offerId: string | number | bigint;
  let chainType: string | undefined;
  let offerAddress: string | undefined;
  let consignmentAddress: string | undefined;

  if (contentType.includes("application/json")) {
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    // Validate request body - return 400 on invalid params
    const parseResult = ApproveOfferRequestSchema.safeParse(body);
    if (!parseResult.success) {
      return validationErrorResponse(parseResult.error, 400);
    }
    const data = parseResult.data;
    offerId = data.offerId;
    chainType = data.chain;
    offerAddress = data.offerAddress;
    consignmentAddress = data.consignmentAddress;
  } else if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = await request.formData();
    const v = form.get("offerId");
    if (!v) {
      return NextResponse.json(
        { error: "offerId required in form data" },
        { status: 400 },
      );
    }
    offerId = String(v);
  } else {
    const { searchParams } = new URL(request.url);
    const v = searchParams.get("offerId");
    if (!v) {
      return NextResponse.json(
        { error: "offerId required in query params" },
        { status: 400 },
      );
    }
    offerId = v;
  }

  // FAIL-FAST: Validate offerId is present
  if (
    !offerId ||
    (typeof offerId !== "string" &&
      typeof offerId !== "number" &&
      typeof offerId !== "bigint")
  ) {
    throw new Error(
      "offerId is required and must be a string, number, or bigint",
    );
  }

  console.log(
    "[Approve API] Approving offer:",
    offerId,
    "chain:",
    chainType,
    "chainType type:",
    typeof chainType,
  );

  // Handle Solana approval
  if (chainType === "solana") {
    console.log("[Approve API] ENTERING Solana approval path");

    // FAIL-FAST: Validate Solana-specific required fields
    if (!offerAddress) {
      throw new Error(
        "offerAddress is required for Solana approval - provide the offer account pubkey",
      );
    }
    if (!consignmentAddress) {
      throw new Error(
        "consignmentAddress is required for Solana approval - provide the consignment account pubkey",
      );
    }

    // FAIL-FAST: Validate Solana address formats
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(offerAddress)) {
      throw new Error(`Invalid Solana offerAddress format: ${offerAddress}`);
    }
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(consignmentAddress)) {
      throw new Error(
        `Invalid Solana consignmentAddress format: ${consignmentAddress}`,
      );
    }

    console.log(
      "[Approve API] Processing Solana approval for offer:",
      offerAddress,
    );

    // Import Anchor and Solana libs dynamically
    const anchor = await import("@coral-xyz/anchor");
    const { Connection, PublicKey, Keypair } = await import("@solana/web3.js");

    const solanaConfig = getSolanaConfig();
    const network = getNetwork();
    const SOLANA_RPC =
      network === "local" ? "http://127.0.0.1:8899" : getHeliusRpcUrl();
    const SOLANA_DESK = solanaConfig.desk;

    console.log(`[Solana Approve] Using Helius RPC`);
    if (!SOLANA_DESK)
      throw new Error("SOLANA_DESK not configured in deployment");

    const connection = new Connection(SOLANA_RPC, "confirmed");

    // Load owner/approver keypair from environment or fallback to id.json
    const idlPath = path.join(
      process.cwd(),
      "solana/otc-program/target/idl/otc.json",
    );
    const idl = JSON.parse(await fs.readFile(idlPath, "utf8"));
    const bs58 = await import("bs58");

    let approverKeypair: InstanceType<typeof Keypair>;
    const solanaPrivateKey = process.env.SOLANA_MAINNET_PRIVATE_KEY;
    if (solanaPrivateKey) {
      // Use base58-encoded private key from environment
      const secretKey = bs58.default.decode(solanaPrivateKey);
      approverKeypair = Keypair.fromSecretKey(secretKey);
      console.log(
        `[Solana Approve] Using approver from SOLANA_MAINNET_PRIVATE_KEY: ${approverKeypair.publicKey.toBase58()}`,
      );
    } else {
      // Fallback to id.json for local development
      const keypairPath = path.join(
        process.cwd(),
        "solana/otc-program/id.json",
      );
      const keypairData = JSON.parse(await fs.readFile(keypairPath, "utf8"));
      approverKeypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
      console.log(
        `[Solana Approve] Using approver from id.json: ${approverKeypair.publicKey.toBase58()}`,
      );
    }

    // Create provider with the approver keypair
    // Wallet interface matches @coral-xyz/anchor's Wallet type
    interface AnchorWallet {
      publicKey: SolanaPublicKey;
      signTransaction<T extends Transaction | VersionedTransaction>(
        tx: T,
      ): Promise<T>;
      signAllTransactions<T extends Transaction | VersionedTransaction>(
        txs: T[],
      ): Promise<T[]>;
    }

    const wallet: AnchorWallet = {
      publicKey: approverKeypair.publicKey,
      signTransaction: async <T extends Transaction | VersionedTransaction>(
        tx: T,
      ) => {
        (tx as Transaction).partialSign(approverKeypair);
        return tx;
      },
      signAllTransactions: async <T extends Transaction | VersionedTransaction>(
        txs: T[],
      ) => {
        txs.forEach((tx) => (tx as Transaction).partialSign(approverKeypair));
        return txs;
      },
    };

    const provider = new anchor.AnchorProvider(connection, wallet, {
      commitment: "confirmed",
    });
    anchor.setProvider(provider);

    const program = new anchor.Program(idl, provider);

    // Approve the offer
    const desk = new PublicKey(SOLANA_DESK);
    const offer = new PublicKey(offerAddress);
    const consignment = new PublicKey(consignmentAddress);

    const approveTx = await program.methods
      .approveOffer(new anchor.BN(offerId))
      .accounts({
        desk,
        offer,
        consignment,
        approver: approverKeypair.publicKey,
      })
      .signers([approverKeypair])
      .rpc();

    console.log("[Approve API] ✅ Solana offer approved:", approveTx);

    // Fetch offer to get payment details and token mint
    // In token-agnostic architecture, each offer stores its own token_mint
    interface ProgramAccountsFetch {
      offer: {
        fetch: (address: SolanaPublicKey) => Promise<{
          currency: number;
          id: import("@coral-xyz/anchor").BN;
          tokenMint: SolanaPublicKey;
        }>;
      };
      desk: {
        fetch: (
          address: SolanaPublicKey,
        ) => Promise<{ usdcMint: SolanaPublicKey }>;
      };
    }
    const programAccounts = program.account as ProgramAccountsFetch;
    const offerData = await programAccounts.offer.fetch(offer);

    // Auto-fulfill (backend pays)
    console.log("[Approve API] Auto-fulfilling Solana offer...");

    const { getAssociatedTokenAddress } = await import("@solana/spl-token");
    type DeskAccountData = {
      usdcMint: SolanaPublicKey;
      agent: SolanaPublicKey;
      solUsdPrice8D: { toNumber: () => number };
    };
    const deskData = (await programAccounts.desk.fetch(
      desk,
    )) as DeskAccountData;
    // Token mint comes from the offer itself (multi-token support)
    const tokenMint = new PublicKey(offerData.tokenMint);
    const deskTokenTreasury = await getAssociatedTokenAddress(
      tokenMint,
      desk,
      true,
    );

    // Load desk keypair for signing fulfillment - REQUIRED for fulfillment to work
    let deskKeypair: InstanceType<typeof Keypair>;
    const deskPrivateKey = process.env.SOLANA_DESK_PRIVATE_KEY;
    if (deskPrivateKey) {
      const secretKey = bs58.default.decode(deskPrivateKey);
      deskKeypair = Keypair.fromSecretKey(secretKey);
      console.log(
        `[Approve API] Loaded desk keypair: ${deskKeypair.publicKey.toBase58()}`,
      );
    } else {
      // Try file-based
      const deskKeypairPath = path.join(
        process.cwd(),
        "solana/otc-program/desk-mainnet-keypair.json",
      );
      // FAIL-FAST: Desk keypair file must exist and be valid
      const deskKeypairData = JSON.parse(
        await fs.readFile(deskKeypairPath, "utf8"),
      );
      deskKeypair = Keypair.fromSecretKey(Uint8Array.from(deskKeypairData));
      console.log(
        `[Approve API] Loaded desk keypair from file: ${deskKeypair.publicKey.toBase58()}`,
      );
    }

    // Verify desk keypair matches expected desk address
    if (deskKeypair.publicKey.toBase58() !== SOLANA_DESK) {
      throw new Error(
        `Desk keypair mismatch. Expected: ${SOLANA_DESK}, Got: ${deskKeypair.publicKey.toBase58()}. ` +
          "The desk keypair must match the configured desk address.",
      );
    }

    // Check if SOL price is set (needed for SOL payments)
    if (offerData.currency === 0 && deskData.solUsdPrice8D.toNumber() === 0) {
      console.log(
        "[Approve API] SOL price not set on desk, fetching live price...",
      );

      // Fetch real SOL price from CoinGecko
      const cgRes = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
        { headers: { accept: "application/json" } },
      );

      if (!cgRes.ok) {
        throw new Error(
          "Failed to fetch SOL price from CoinGecko - cannot fulfill offer without SOL price",
        );
      }

      interface CoinGeckoSolanaResponse {
        solana?: {
          usd?: number;
        };
      }
      const cgData = (await cgRes.json()) as CoinGeckoSolanaResponse;
      // FAIL-FAST: SOL price must be available
      if (!cgData.solana || !cgData.solana.usd) {
        throw new Error("SOL price missing from CoinGecko response");
      }
      const solPriceUsd = cgData.solana.usd;

      if (solPriceUsd <= 0) {
        throw new Error(
          "Invalid SOL price from CoinGecko - cannot fulfill offer",
        );
      }

      // Convert to 8-decimal format (e.g., $200.50 -> 20050000000)
      const solPrice8d = Math.round(solPriceUsd * 1e8);
      console.log(
        `[Approve API] Fetched SOL price: $${solPriceUsd} (${solPrice8d} in 8d)`,
      );

      // Also fetch token price for consistency - try CoinGecko first, then Jupiter
      const tokenMintStr = offerData.tokenMint.toString();
      let tokenPriceUsd: number | null = null;

      // Try CoinGecko first
      const tokenCgRes = await fetch(
        `https://api.coingecko.com/api/v3/simple/token_price/solana?contract_addresses=${tokenMintStr}&vs_currencies=usd`,
        { headers: { accept: "application/json" } },
      );

      if (tokenCgRes.ok) {
        const tokenCgData = (await tokenCgRes.json()) as Record<
          string,
          { usd?: number }
        >;
        const tokenPriceEntry = tokenCgData[tokenMintStr.toLowerCase()];
        // Price entry is optional - token may not be in CoinGecko
        if (tokenPriceEntry) {
          // FAIL-FAST: If entry exists, usd should be valid
          if (
            typeof tokenPriceEntry.usd !== "number" ||
            tokenPriceEntry.usd <= 0
          ) {
            throw new Error(
              `CoinGecko returned invalid price for ${tokenMintStr}: ${tokenPriceEntry.usd}`,
            );
          }
          tokenPriceUsd = tokenPriceEntry.usd;
          console.log(
            `[Approve API] Fetched token price from CoinGecko: $${tokenPriceUsd}`,
          );
        }
      }

      // If CoinGecko doesn't have it, try Jupiter
      if (tokenPriceUsd === null) {
        console.log(
          `[Approve API] Token not in CoinGecko, trying Jupiter: ${tokenMintStr}`,
        );
        const jupiterPrices = await fetchJupiterPrices([tokenMintStr]);
        const jupiterPrice = jupiterPrices[tokenMintStr];
        if (jupiterPrice && jupiterPrice > 0) {
          tokenPriceUsd = jupiterPrice;
          console.log(
            `[Approve API] Fetched token price from Jupiter: $${tokenPriceUsd}`,
          );
        }
      }

      // FAIL-FAST: If no price from either source, cannot safely proceed
      if (tokenPriceUsd === null || tokenPriceUsd <= 0) {
        throw new Error(
          `Token price unavailable for ${tokenMintStr}: not found in CoinGecko or Jupiter. ` +
            `Cannot safely approve offer without valid token price.`,
        );
      }

      const tokenPrice8d = Math.round(tokenPriceUsd * 1e8);
      console.log(
        `[Approve API] Using token price: $${tokenPriceUsd} (${tokenPrice8d} in 8d)`,
      );

      const now = Math.floor(Date.now() / 1000);
      await program.methods
        .setPrices(
          new anchor.BN(tokenPrice8d),
          new anchor.BN(solPrice8d),
          new anchor.BN(now),
          new anchor.BN(3600), // 1 hour max age
        )
        .accounts({
          owner: approverKeypair.publicKey,
          desk,
        })
        .signers([approverKeypair])
        .rpc();
      console.log("[Approve API] Prices set on desk");
    }

    let fulfillTx: string;

    if (offerData.currency === 0) {
      // Pay with SOL
      fulfillTx = await program.methods
        .fulfillOfferSol(new anchor.BN(offerId))
        .accounts({
          desk,
          offer,
          deskTokenTreasury,
          agent: deskData.agent,
          deskSigner: deskKeypair.publicKey,
          payer: approverKeypair.publicKey,
          systemProgram: new PublicKey("11111111111111111111111111111111"),
        })
        .signers([approverKeypair, deskKeypair])
        .rpc();
      console.log("[Approve API] ✅ Paid with SOL:", fulfillTx);
    } else {
      // Pay with USDC
      const usdcMint = new PublicKey(deskData.usdcMint);
      const deskUsdcTreasury = await getAssociatedTokenAddress(
        usdcMint,
        desk,
        true,
      );
      const payerUsdcAta = await getAssociatedTokenAddress(
        usdcMint,
        approverKeypair.publicKey,
        false,
      );
      // Agent USDC ATA for commission (optional)
      const agentUsdcAta = await getAssociatedTokenAddress(
        usdcMint,
        deskData.agent,
        false,
      );

      fulfillTx = await program.methods
        .fulfillOfferUsdc(new anchor.BN(offerId))
        .accounts({
          desk,
          offer,
          usdcMint,
          deskTokenTreasury,
          deskUsdcTreasury,
          payerUsdcAta,
          agentUsdcAta,
          deskSigner: deskKeypair.publicKey,
          payer: approverKeypair.publicKey,
          tokenProgram: new PublicKey(
            "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
          ),
          systemProgram: new PublicKey("11111111111111111111111111111111"),
        })
        .signers([approverKeypair, deskKeypair])
        .rpc();
      console.log("[Approve API] ✅ Paid with USDC:", fulfillTx);
    }

    console.log("[Approve API] Solana approval complete, returning response");
    const solanaResponse = {
      success: true,
      approved: true,
      autoFulfilled: true,
      fulfillTx,
      chain: "solana",
      offerId: String(offerId),
      offerAddress,
      approvalTx: approveTx,
    };
    const validatedSolanaResponse =
      ApproveOfferResponseSchema.parse(solanaResponse);
    return NextResponse.json(validatedSolanaResponse);
  }

  console.log(
    "[Approve API] ENTERING EVM approval path (chainType was:",
    chainType,
    ")",
  );
  const chain =
    chainType && chainType !== "solana"
      ? getViemChainForType(chainType)
      : getChain();

  // For EVM approval, we need a direct RPC URL (not the proxy) to send transactions
  // The proxy only supports read operations
  const getDirectRpcUrl = (chainType: string | undefined): string => {
    const network = getNetwork();
    if (network === "local") {
      return "http://127.0.0.1:8545";
    }
    // Use direct public RPC for mainnet - these support eth_sendTransaction
    switch (chainType) {
      case "base":
        return "https://mainnet.base.org";
      case "ethereum":
        return "https://eth.merkle.io";
      case "bsc":
        return "https://bsc-dataseed1.binance.org";
      default:
        return "https://mainnet.base.org";
    }
  };

  const rpcUrl = getDirectRpcUrl(chainType);
  console.log("[Approve API] Using direct RPC:", rpcUrl);
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const abi = otcArtifact.abi as Abi;

  // Resolve approver account: prefer PK; else use testWalletPrivateKey from deployment; else impersonate
  let account: PrivateKeyAccount | Address;
  let walletClient: MinimalWalletClient;
  let approverAddr: Address;

  if (EVM_PRIVATE_KEY) {
    account = privateKeyToAccount(EVM_PRIVATE_KEY);
    const viemClient = createWalletClient({
      account,
      chain,
      transport: http(rpcUrl),
    });
    // Cast to MinimalWalletClient - viem's WalletClient satisfies our minimal interface
    walletClient = viemClient as unknown as MinimalWalletClient;
    approverAddr = account.address;
    console.log("[Approve API] Using EVM_PRIVATE_KEY account:", approverAddr);
  } else if (isLocalNetwork) {
    // Local Anvil testing - use impersonation
    const deploymentInfoPath = path.join(
      process.cwd(),
      "contracts/deployments/eliza-otc-deployment.json",
    );
    const raw = await fs.readFile(deploymentInfoPath, "utf8");
    const json = JSON.parse(raw);

    // For local Anvil testing, prefer impersonation using the testWallet address
    // accounts is optional in Anvil state dump - if it exists, validate structure
    const accounts = json.accounts;
    // If accounts exists, it should have the expected structure (fail-fast on malformed config)
    const testWalletAddr = accounts?.testWallet
      ? (accounts.testWallet as Address)
      : undefined;
    const approverAddrFromJson = accounts?.approver
      ? (accounts.approver as Address)
      : undefined;
    // Use testWalletAddr if available, otherwise use approverAddrFromJson
    // Use testWalletAddr if available, otherwise fall back to approverAddrFromJson
    const impersonateAddr = testWalletAddr ?? approverAddrFromJson;

    if (impersonateAddr) {
      await fetch("http://127.0.0.1:8545", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "anvil_impersonateAccount",
          params: [impersonateAddr],
          id: 1,
        }),
      });
      account = impersonateAddr;
      const viemClient = createWalletClient({ chain, transport: http(rpcUrl) });
      // Cast to MinimalWalletClient - viem's WalletClient satisfies our minimal interface
      walletClient = viemClient as unknown as MinimalWalletClient;
      approverAddr = impersonateAddr;
      console.log("[Approve API] Impersonating account on Anvil", {
        address: approverAddr,
        source: testWalletAddr ? "testWallet" : "approver",
      });
    } else {
      throw new Error("No approver address found in deployment");
    }
  } else {
    // Production/mainnet without private key - cannot approve
    throw new Error(
      "EVM_PRIVATE_KEY is required for mainnet approval. Set it in your environment.",
    );
  }

  // Ensure single approver mode (dev convenience) - ONLY on local Anvil
  const currentRequired = await safeReadContract<bigint>(publicClient, {
    address: OTC_ADDRESS,
    abi,
    functionName: "requiredApprovals",
    args: [],
  });

  console.log(
    "[Approve API] Current required approvals:",
    Number(currentRequired),
  );

  if (isLocalNetwork && Number(currentRequired) !== 1) {
    console.log("[Approve API] Setting requiredApprovals to 1 (local only)...");
    const deploymentInfoPath = path.join(
      process.cwd(),
      "contracts/deployments/eliza-otc-deployment.json",
    );
    const raw = await fs.readFile(deploymentInfoPath, "utf8");
    const json = JSON.parse(raw);
    const ownerAddr = json.accounts.owner as Address;

    await fetch("http://127.0.0.1:8545", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "anvil_impersonateAccount",
        params: [ownerAddr],
        id: 1,
      }),
    });

    const { request: setReq } = await publicClient.simulateContract({
      address: OTC_ADDRESS,
      abi,
      functionName: "setRequiredApprovals",
      args: [1n],
      account: ownerAddr,
    });
    await createWalletClient({ chain, transport: http(rpcUrl) }).writeContract({
      ...setReq,
      account: ownerAddr,
    });
    console.log("[Approve API] ✅ Set requiredApprovals to 1 (local)");
  } else if (!isLocalNetwork) {
    console.log(
      "[Approve API] Skipping requiredApprovals mutation - non-local network",
    );
  } else {
    console.log("[Approve API] ✅ Already in single-approver mode");
  }

  // Poll for offer to exist (tx might still be pending)
  // This handles the case where frontend calls us immediately after tx submission
  let offer;
  const maxPollAttempts = 10; // 10 attempts * 2 seconds = 20 seconds max wait

  for (let attempt = 1; attempt <= maxPollAttempts; attempt++) {
    const offerRaw = await safeReadContract<RawOfferData>(publicClient, {
      address: OTC_ADDRESS,
      abi,
      functionName: "offers",
      args: [BigInt(offerId)],
    });

    offer = parseOfferStruct(offerRaw);

    // Check if offer exists (beneficiary is set when offer is created)
    if (
      offer.beneficiary &&
      offer.beneficiary !== "0x0000000000000000000000000000000000000000"
    ) {
      console.log(`[Approve API] Offer found on attempt ${attempt}`);
      break;
    }

    if (attempt < maxPollAttempts) {
      console.log(
        `[Approve API] Offer ${offerId} not found yet, waiting... (${attempt}/${maxPollAttempts})`,
      );
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  // FAIL-FAST: Offer must exist after polling
  if (!offer) {
    return NextResponse.json(
      {
        error: `Offer ${offerId} not found after ${maxPollAttempts} attempts. Transaction may still be pending.`,
      },
      { status: 404 },
    );
  }
  if (
    !offer.beneficiary ||
    offer.beneficiary === "0x0000000000000000000000000000000000000000"
  ) {
    return NextResponse.json(
      {
        error: `Offer ${offerId} exists but has invalid beneficiary. Transaction may still be pending.`,
      },
      { status: 404 },
    );
  }

  console.log("[Approve API] Offer state:", {
    approved: offer.approved,
    cancelled: offer.cancelled,
    beneficiary: offer.beneficiary,
  });

  if (offer.approved) {
    console.log("[Approve API] Offer already approved");
    const alreadyApprovedResponse = {
      success: true,
      txHash: "already-approved",
      alreadyApproved: true,
    };
    const validatedAlreadyApproved = ApproveOfferResponseSchema.parse(
      alreadyApprovedResponse,
    );
    return NextResponse.json(validatedAlreadyApproved);
  }

  // ============ PRICE VALIDATION ============
  // Validate that the offer price hasn't diverged too much from market price
  // This prevents abuse from stale quotes or manipulated pool prices
  const MAX_PRICE_DIVERGENCE_BPS = 1000; // 10% maximum divergence

  // SECURITY: isLocalNetwork is already set above based on getNetwork()
  // In production, this is ALWAYS false regardless of environment variables
  if (isLocalNetwork) {
    console.log("[Approve API] Development mode: price validation relaxed");
  }

  // FAIL-FAST: Price validation must succeed
  const { checkPriceDivergence } = await import("@/utils/price-validator");
  const { TokenDB, QuoteDB } = await import("@/services/database");

  // Get token info from the offer
  // offer.priceUsdPerToken is in 8 decimals (Chainlink format)
  const offerPriceUsd = Number(offer.priceUsdPerToken) / 1e8;

  // Find the specific token associated with this offer
  // Primary method: Use the on-chain tokenId (keccak256 hash of symbol) to look up token
  let tokenAddress: string | null = null;
  let tokenChain: "ethereum" | "base" | "bsc" | "solana" = "base";

  // The offer.tokenId is a bytes32 (keccak256 of token symbol)
  if (offer.tokenId) {
    const token = await TokenDB.getTokenByOnChainId(offer.tokenId);
    if (token) {
      tokenAddress = token.contractAddress;
      tokenChain = token.chain as "ethereum" | "base" | "bsc" | "solana";
      console.log("[Approve API] Found token via on-chain tokenId:", {
        symbol: token.symbol,
        address: tokenAddress,
        chain: tokenChain,
      });
    }
  }

  // Fallback: Try to find via quote (if we have a matching quote by beneficiary)
  if (!tokenAddress) {
    const activeQuotes = await QuoteDB.getActiveQuotes();
    const matchingQuote = activeQuotes.find(
      (q: { beneficiary: string }) =>
        q.beneficiary.toLowerCase() === offer.beneficiary.toLowerCase(),
    );

    if (matchingQuote && "tokenId" in matchingQuote) {
      const token = await TokenDB.getToken(matchingQuote.tokenId as string);
      if (token) {
        tokenAddress = token.contractAddress;
        tokenChain = token.chain as "ethereum" | "base" | "bsc" | "solana";
        console.log("[Approve API] Found token via quote:", {
          symbol: token.symbol,
          address: tokenAddress,
          chain: tokenChain,
        });
      }
    }
  }

  if (!tokenAddress) {
    // For local testing, skip price validation if token not registered
    const network = getNetwork();
    if (network === "local") {
      console.log(
        "[Approve API] Local network - skipping price validation (token not in DB)",
      );
    } else {
      return NextResponse.json(
        {
          success: false,
          error: "Token metadata not found for offer",
        },
        { status: 400 },
      );
    }
  }

  if (offerPriceUsd > 0 && tokenAddress) {
    console.log("[Approve API] Validating price against market...", {
      offerPriceUsd,
      tokenAddress,
      tokenChain,
    });

    const priceCheck = await checkPriceDivergence(
      tokenAddress,
      tokenChain,
      offerPriceUsd,
    );

    if (!priceCheck.valid && typeof priceCheck.divergencePercent === "number") {
      console.log("[Approve API] Price divergence detected:", {
        offerPrice: offerPriceUsd,
        marketPrice: priceCheck.aggregatedPrice,
        divergence: priceCheck.divergencePercent,
        warning: priceCheck.warning,
      });

      // Reject if divergence exceeds threshold (skip on local network)
      if (
        priceCheck.divergencePercent > MAX_PRICE_DIVERGENCE_BPS / 100 &&
        !isLocalNetwork
      ) {
        return NextResponse.json(
          {
            success: false,
            error: "Price divergence too high",
            details: {
              offerPrice: offerPriceUsd,
              marketPrice: priceCheck.aggregatedPrice,
              divergencePercent: priceCheck.divergencePercent,
              maxAllowedPercent: MAX_PRICE_DIVERGENCE_BPS / 100,
              reason: priceCheck.warning,
            },
          },
          { status: 400 },
        );
      } else if (
        isLocalNetwork &&
        priceCheck.divergencePercent > MAX_PRICE_DIVERGENCE_BPS / 100
      ) {
        console.log(
          "[Approve API] Skipping price rejection on local network (divergence:",
          priceCheck.divergencePercent,
          "%)",
        );
      }
    } else {
      console.log("[Approve API] Price validation passed:", {
        divergence: priceCheck.divergencePercent,
        valid: priceCheck.valid,
      });
    }
  }
  // ============ END PRICE VALIDATION ============

  // Approve immediately
  const accountAddr = (
    typeof account === "string" ? account : account.address
  ) as Address;

  console.log("[Approve API] Simulating approval...", {
    offerId,
    account: accountAddr,
    otcAddress: OTC_ADDRESS,
    hasPrivateKey: typeof account !== "string",
  });

  // For signing, we need to pass the full account object (not just address) so viem signs locally
  const { request: approveRequest } = await publicClient.simulateContract({
    address: OTC_ADDRESS,
    abi,
    functionName: "approveOffer",
    args: [BigInt(offerId)],
    account: account, // Use full account object for local signing
  });

  console.log("[Approve API] Sending approval tx...");
  // writeContract will sign locally if account is a PrivateKeyAccount
  // Type assertion needed due to viem's strict args typing after simulateContract
  const txHash: `0x${string}` = await walletClient.writeContract(
    approveRequest as Parameters<typeof walletClient.writeContract>[0],
  );

  console.log("[Approve API] Waiting for confirmation...", txHash);
  const approvalReceipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
  });

  console.log("[Approve API] Approval receipt:", {
    status: approvalReceipt.status,
    blockNumber: approvalReceipt.blockNumber,
    gasUsed: approvalReceipt.gasUsed.toString(),
  });

  console.log("[Approve API] ✅ Offer approved:", offerId, "tx:", txHash);

  // Update quote status and financial data if we can find it
  const runtime = await agentRuntime.getRuntime();
  const quoteService = runtime.getService<QuoteService>("QuoteService");

  // QuoteService is optional - if not available, skip quote update (non-critical)
  // offer.beneficiary is required - if missing, skip (offer should have beneficiary)
  if (quoteService) {
    if (!offer.beneficiary) {
      console.warn(
        "[Approve API] Offer missing beneficiary - skipping quote update",
      );
      return NextResponse.json({ success: true, txHash });
    }
    const activeQuotes = await quoteService.getActiveQuotes();
    const matchingQuote = activeQuotes.find(
      (q: QuoteMemory) =>
        q.beneficiary.toLowerCase() === offer.beneficiary.toLowerCase(),
    );

    if (matchingQuote) {
      // Calculate financial values from on-chain offer data
      const tokenAmountWei = BigInt(offer.tokenAmount);
      const priceUsd8 = BigInt(offer.priceUsdPerToken);
      const discountBpsNum = Number(offer.discountBps);

      // totalUsd = (tokenAmount * priceUsdPerToken) / 1e18 (result in 8 decimals)
      const totalUsd8 = (tokenAmountWei * priceUsd8) / BigInt(1e18);
      const totalUsd = Number(totalUsd8) / 1e8;

      // discountUsd = totalUsd * discountBps / 10000
      const discountUsd8 = (totalUsd8 * BigInt(discountBpsNum)) / 10000n;
      const discountUsd = Number(discountUsd8) / 1e8;

      // discountedUsd = totalUsd - discountUsd
      const discountedUsd8 = totalUsd8 - discountUsd8;
      const discountedUsd = Number(discountedUsd8) / 1e8;

      // Determine payment currency and amount based on offer currency
      const paymentCurrency: "ETH" | "USDC" =
        offer.currency === 0 ? "ETH" : "USDC";
      let paymentAmount = "0";

      if (offer.currency === 0) {
        // Calculate required ETH
        const ethPrice = Number(offer.ethUsdPrice) / 1e8;
        paymentAmount = (discountedUsd / ethPrice).toFixed(6);
      } else {
        // USDC
        paymentAmount = discountedUsd.toFixed(2);
      }

      console.log("[Approve API] Calculated financial data:", {
        tokenAmount: offer.tokenAmount.toString(),
        totalUsd,
        discountUsd,
        discountedUsd,
        paymentAmount,
        paymentCurrency,
      });

      // Update quote status
      await quoteService.updateQuoteStatus(matchingQuote.quoteId, "approved", {
        offerId: String(offerId),
        transactionHash: txHash,
        blockNumber: Number(approvalReceipt.blockNumber),
        rejectionReason: "",
        approvalNote: "Approved via API",
      });

      // Update quote with financial data from contract
      const updatedQuote = await quoteService.getQuoteByQuoteId(
        matchingQuote.quoteId,
      );
      updatedQuote.tokenAmount = offer.tokenAmount.toString();
      updatedQuote.totalUsd = totalUsd;
      updatedQuote.discountUsd = discountUsd;
      updatedQuote.discountedUsd = discountedUsd;
      updatedQuote.paymentAmount = paymentAmount;
      updatedQuote.paymentCurrency = paymentCurrency;
      updatedQuote.discountBps = discountBpsNum;

      await runtime.setCache(`quote:${matchingQuote.quoteId}`, updatedQuote);

      console.log(
        "[Approve API] Updated quote with financial data:",
        matchingQuote.quoteId,
      );
    }
  }

  // If still not approved (multi-approver deployments), escalate approvals
  let approvedOfferRaw = await safeReadContract<RawOfferData>(publicClient, {
    address: OTC_ADDRESS,
    abi,
    functionName: "offers",
    args: [BigInt(offerId)],
  });

  let approvedOffer = parseOfferStruct(approvedOfferRaw);

  if (!approvedOffer.approved) {
    // Load known approver and agent from deployment file
    const deploymentInfoPath = path.join(
      process.cwd(),
      "contracts/deployments/eliza-otc-deployment.json",
    );
    const raw = await fs.readFile(deploymentInfoPath, "utf8");
    const json = JSON.parse(raw);
    const approver = json.accounts.approver as Address;
    const agentAddr = json.accounts.agent as Address;
    const candidates = [approver, agentAddr];

    for (const addr of candidates) {
      console.log("[Approve API] Attempting secondary approval by", addr);

      await fetch("http://127.0.0.1:8545", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "anvil_impersonateAccount",
          params: [addr],
          id: 1,
        }),
      });

      const { request: req2 } = await publicClient.simulateContract({
        address: OTC_ADDRESS,
        abi,
        functionName: "approveOffer",
        args: [BigInt(offerId)],
        account: addr,
      });
      await createWalletClient({
        chain,
        transport: http(rpcUrl),
      }).writeContract({ ...req2, account: addr });

      // Re-read state after each attempt
      approvedOfferRaw = await safeReadContract<RawOfferData>(publicClient, {
        address: OTC_ADDRESS,
        abi,
        functionName: "offers",
        args: [BigInt(offerId)],
      });
      approvedOffer = parseOfferStruct(approvedOfferRaw);
      if (approvedOffer.approved) break;
    }
  }

  // Final verification that offer was approved
  console.log("[Approve API] Verifying final approval state...");

  approvedOfferRaw = await safeReadContract<RawOfferData>(publicClient, {
    address: OTC_ADDRESS,
    abi,
    functionName: "offers",
    args: [BigInt(offerId)],
  });

  approvedOffer = parseOfferStruct(approvedOfferRaw);

  console.log("[Approve API] Final offer state:", {
    offerId,
    approved: approvedOffer.approved,
    cancelled: approvedOffer.cancelled,
    paid: approvedOffer.paid,
    fulfilled: approvedOffer.fulfilled,
  });

  if (approvedOffer.cancelled) {
    return NextResponse.json({ error: "Offer is cancelled" }, { status: 400 });
  }

  if (!approvedOffer.approved) {
    throw new Error("Offer still not approved after all attempts");
  }

  // Check if approver should also fulfill
  const requireApproverToFulfill = await safeReadContract<boolean>(
    publicClient,
    {
      address: OTC_ADDRESS,
      abi,
      functionName: "requireApproverToFulfill",
      args: [],
    },
  );

  console.log(
    "[Approve API] requireApproverToFulfill:",
    requireApproverToFulfill,
  );

  let fulfillTxHash: `0x${string}` | undefined;

  // If approver-only fulfill is enabled, backend pays immediately after approval
  if (requireApproverToFulfill && !approvedOffer.paid) {
    console.log("[Approve API] Auto-fulfilling offer (approver-only mode)...");

    // FAIL-FAST: Auto-fulfillment must succeed
    const accountAddr = (
      typeof account === "string" ? account : account.address
    ) as Address;

    // Calculate required payment
    const currency = approvedOffer.currency;
    let valueWei: bigint | undefined;

    if (currency === 0) {
      // ETH payment required
      const requiredEth = await safeReadContract<bigint>(publicClient, {
        address: OTC_ADDRESS,
        abi,
        functionName: "requiredEthWei",
        args: [BigInt(offerId)],
      });

      valueWei = requiredEth;
      console.log("[Approve API] Required ETH:", requiredEth.toString());
    } else {
      // USDC payment - need to approve first
      const usdcAddress = await safeReadContract<Address>(publicClient, {
        address: OTC_ADDRESS,
        abi,
        functionName: "usdc",
        args: [],
      });

      const requiredUsdc = await safeReadContract<bigint>(publicClient, {
        address: OTC_ADDRESS,
        abi,
        functionName: "requiredUsdcAmount",
        args: [BigInt(offerId)],
      });

      console.log("[Approve API] Required USDC:", requiredUsdc.toString());

      // Approve USDC
      const erc20Abi = [
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
      ] as Abi;

      const { request: approveUsdcReq } = await publicClient.simulateContract({
        address: usdcAddress,
        abi: erc20Abi,
        functionName: "approve",
        args: [OTC_ADDRESS, requiredUsdc],
        account: accountAddr,
      });

      // Type assertion needed due to viem's strict args typing after simulateContract
      await walletClient.writeContract(
        approveUsdcReq as Parameters<typeof walletClient.writeContract>[0],
      );
      console.log("[Approve API] USDC approved");
    }

    // Fulfill offer
    const { request: fulfillReq } = await publicClient.simulateContract({
      address: OTC_ADDRESS,
      abi,
      functionName: "fulfillOffer",
      args: [BigInt(offerId)],
      account: accountAddr,
      value: valueWei,
    });

    // Type assertion needed due to viem's strict args typing after simulateContract
    fulfillTxHash = await walletClient.writeContract(
      fulfillReq as Parameters<typeof walletClient.writeContract>[0],
    );
    console.log("[Approve API] Fulfill tx sent:", fulfillTxHash);

    if (fulfillTxHash) {
      await publicClient.waitForTransactionReceipt({ hash: fulfillTxHash });
    }
    console.log("[Approve API] ✅ Offer fulfilled automatically");
  } else if (approvedOffer.paid) {
    console.log("[Approve API] ✅ Offer already paid, skipping auto-fulfill");
  } else if (!requireApproverToFulfill) {
    console.log(
      "[Approve API] ⚠️  requireApproverToFulfill is disabled. User must fulfill (pay) manually.",
    );
  }

  // Return success
  const finalResponse = {
    success: true,
    approved: true,
    approvalTx: txHash,
    fulfillTx: fulfillTxHash,
    offerId: String(offerId),
    chain: chain,
    autoFulfilled: Boolean(fulfillTxHash),
    message: fulfillTxHash
      ? "Offer approved and fulfilled automatically"
      : "Offer approved. Please complete payment to fulfill the offer.",
  };
  const validatedFinalResponse =
    ApproveOfferResponseSchema.parse(finalResponse);
  return NextResponse.json(validatedFinalResponse);
}
