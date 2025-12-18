import { createPublicClient, createWalletClient, http, parseEther, keccak256, formatEther } from "viem";
import { foundry } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import * as fs from "fs";

const EVM_RPC = "http://localhost:8545";

// Anvil default funded account (has 10000 ETH)
const OWNER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

async function main() {
  const deploymentFile = "contracts/deployments/eliza-otc-deployment.json";
  const deployment = JSON.parse(fs.readFileSync(deploymentFile, "utf8"));
  
  const otcAddress = deployment.contracts.deal;
  const tokenAddress = deployment.contracts.elizaToken;
  
  console.log("OTC:", otcAddress);
  console.log("Token:", tokenAddress);
  
  // Load ABI
  const artifact = JSON.parse(fs.readFileSync("contracts/out/OTC.sol/OTC.json", "utf8"));
  const abi = artifact.abi;
  
  const tokenArtifact = JSON.parse(fs.readFileSync("contracts/out/ERC20.sol/ERC20.json", "utf8"));
  const tokenAbi = tokenArtifact.abi;
  
  // Use owner account (has ETH and tokens)
  const ownerAccount = privateKeyToAccount(OWNER_KEY as `0x${string}`);
  
  const publicClient = createPublicClient({
    chain: foundry,
    transport: http(EVM_RPC),
  });
  
  const walletClient = createWalletClient({
    account: ownerAccount,
    chain: foundry,
    transport: http(EVM_RPC),
  });
  
  console.log("Using wallet:", ownerAccount.address);
  
  // Check balances
  const ethBalance = await publicClient.getBalance({ address: ownerAccount.address });
  const tokenBalance = await publicClient.readContract({
    address: tokenAddress,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [ownerAccount.address],
  }) as bigint;
  console.log("ETH balance:", formatEther(ethBalance));
  console.log("Token balance:", formatEther(tokenBalance));
  
  // Check tokenId
  const tokenId = keccak256(new TextEncoder().encode("elizaOS"));
  console.log("TokenId:", tokenId);
  
  const registeredToken = await publicClient.readContract({
    address: otcAddress,
    abi,
    functionName: "tokens",
    args: [tokenId],
  });
  console.log("Registered token:", registeredToken);
  
  // Approve tokens
  const sellerAmount = parseEther("1000");
  const { request: approveReq } = await publicClient.simulateContract({
    address: tokenAddress,
    abi: tokenAbi,
    functionName: "approve",
    args: [otcAddress, sellerAmount],
    account: ownerAccount,
  });
  const approveTx = await walletClient.writeContract(approveReq);
  await publicClient.waitForTransactionReceipt({ hash: approveTx });
  console.log("Approved:", approveTx);
  
  // Get next consignment ID
  const nextConsignmentId = await publicClient.readContract({
    address: otcAddress,
    abi,
    functionName: "nextConsignmentId",
  });
  console.log("Next consignment ID:", nextConsignmentId);
  
  // Create consignment with CORRECT args (12 params)
  const requiredGasDeposit = parseEther("0.001");
  
  try {
    const { request: consignReq } = await publicClient.simulateContract({
      address: otcAddress,
      abi,
      functionName: "createConsignment",
      args: [
        tokenId,           // bytes32 tokenId
        sellerAmount,      // uint256 amount
        false,             // bool isNegotiable
        1000,              // uint16 fixedDiscountBps (10%)
        180,               // uint32 fixedLockupDays
        0,                 // uint16 minDiscountBps
        0,                 // uint16 maxDiscountBps
        0,                 // uint32 minLockupDays
        0,                 // uint32 maxLockupDays
        parseEther("100"), // uint256 minDealAmount
        sellerAmount,      // uint256 maxDealAmount
        500,               // uint16 maxPriceVolatilityBps (5%)
      ],
      account: ownerAccount,
      value: requiredGasDeposit,
    });
    const consignTx = await walletClient.writeContract(consignReq);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: consignTx });
    console.log("Consignment created:", consignTx);
    console.log("Block:", receipt.blockNumber);
    
    // Verify consignment
    const consignment = await publicClient.readContract({
      address: otcAddress,
      abi,
      functionName: "consignments",
      args: [nextConsignmentId],
    });
    console.log("Consignment on-chain:", consignment);
    
    console.log("\n✅ SUCCESS - createConsignment works with 12 params!\n");
  } catch (err) {
    console.error("\n❌ FAILED:", err);
  }
}

main().catch(console.error);
