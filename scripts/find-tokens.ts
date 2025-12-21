import { createPublicClient, http, keccak256, encodePacked } from "viem";
import { base } from "viem/chains";

const OTC_ADDRESS = "0x12FA61c9d77AEd9BeDA0FF4bF2E900F31bdBdc45";
const ALCHEMY_KEY = "b_Ou4aeoKR4tGaTPVp36T";

// Common Base tokens
const TOKENS = [
  { symbol: "WETH", address: "0x4200000000000000000000000000000000000006" },
  { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
  { symbol: "cbETH", address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22" },
  { symbol: "DAI", address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb" },
  { symbol: "AERO", address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631" },
  { symbol: "TOSHI", address: "0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4" },
  { symbol: "BRETT", address: "0x532f27101965dd16442E59d40670FaF5eBB142E4" },
  { symbol: "DEGEN", address: "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed" },
];

const OTC_ABI = [
  { name: "tokens", type: "function", inputs: [{ type: "bytes32" }], outputs: [{ type: "address" }, { type: "uint8" }, { type: "bool" }, { type: "address" }], stateMutability: "view" },
] as const;

async function main() {
  const client = createPublicClient({
    chain: base,
    transport: http(`https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`),
  });

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  CHECKING REGISTERED TOKENS ON BASE OTC");
  console.log("═══════════════════════════════════════════════════════════════\n");

  for (const token of TOKENS) {
    const tokenId = keccak256(encodePacked(["address"], [token.address as `0x${string}`]));
    const [tokenAddress, decimals, isActive, oracle] = await client.readContract({
      address: OTC_ADDRESS,
      abi: OTC_ABI,
      functionName: "tokens",
      args: [tokenId],
    });
    
    if (tokenAddress !== "0x0000000000000000000000000000000000000000") {
      console.log(`✅ ${token.symbol}: REGISTERED`);
      console.log(`   Address: ${tokenAddress}`);
      console.log(`   Active: ${isActive}`);
      console.log(`   Oracle: ${oracle}`);
    } else {
      console.log(`❌ ${token.symbol}: Not registered`);
    }
  }

  console.log("\n═══════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
