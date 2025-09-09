import { ethers } from "hardhat";

async function main() {
  console.log("Deploying TestToken...");
  
  // Deploy TestToken
  const TestToken = await ethers.getContractFactory("TestToken");
  const testToken = await TestToken.deploy();
  await testToken.waitForDeployment();
  
  const testTokenAddress = await testToken.getAddress();
  console.log("TestToken deployed to:", testTokenAddress);
  
  // Get OTC contract address from previous deployment
  const deployedAddresses = require("./ignition/deployments/chain-31337/deployed_addresses.json");
  const otcAddress = deployedAddresses["OTCModule#OTC"];
  
  if (!otcAddress) {
    console.error("OTC contract not found. Please deploy it first.");
    process.exit(1);
  }
  
  console.log("OTC contract at:", otcAddress);
  
  // Fund OTC contract with TestToken
  const fundAmount = ethers.parseEther("100000");
  console.log(`Funding OTC contract with ${ethers.formatEther(fundAmount)} TEST tokens...`);
  
  const tx = await testToken.transfer(otcAddress, fundAmount);
  await tx.wait();
  
  console.log("OTC contract funded successfully!");
  
  // Verify balance
  const otcBalance = await testToken.balanceOf(otcAddress);
  console.log(`OTC contract TEST balance: ${ethers.formatEther(otcBalance)}`);
  
  // Save TestToken address for frontend
  const fs = require("fs");
  const configPath = "../.env.local";
  let config = "";
  
  if (fs.existsSync(configPath)) {
    config = fs.readFileSync(configPath, "utf8");
  }
  
  // Update or add TEST_TOKEN_ADDRESS
  if (config.includes("NEXT_PUBLIC_TEST_TOKEN_ADDRESS=")) {
    config = config.replace(/NEXT_PUBLIC_TEST_TOKEN_ADDRESS=.*/, `NEXT_PUBLIC_TEST_TOKEN_ADDRESS=${testTokenAddress}`);
  } else {
    config += `\nNEXT_PUBLIC_TEST_TOKEN_ADDRESS=${testTokenAddress}\n`;
  }
  
  fs.writeFileSync(configPath, config);
  console.log("TestToken address saved to .env.local");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
