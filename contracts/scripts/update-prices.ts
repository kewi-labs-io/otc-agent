import { ethers } from "hardhat";

async function main() {
  const otcAddress = process.env.NEXT_PUBLIC_OTC_ADDRESS || "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9";
  const OTC = await ethers.getContractAt("OTC", otcAddress);
  
  console.log("Setting prices on EVM contract:", otcAddress);
  
  const tx = await OTC.setManualPrices(
    ethers.parseUnits("1", 8), // $1 token (8 decimals)
    ethers.parseUnits("100", 8), // $100 ETH (8 decimals)
    true // use manual prices
  );
  
  await tx.wait();
  console.log("✅ Prices set:", tx.hash);
}

main().catch(console.error);
