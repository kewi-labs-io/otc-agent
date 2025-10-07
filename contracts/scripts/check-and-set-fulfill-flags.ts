import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  // Load deployment info
  const deploymentPath = path.join(__dirname, "../deployments/eliza-otc-deployment.json");
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  const otcAddress = deployment.contracts?.deal;

  console.log("📍 OTC Contract:", otcAddress);

  const OTC = await ethers.getContractAt("OTC", otcAddress);

  // Check current flags
  const requireApprover = await OTC.requireApproverToFulfill();
  const restrictToBeneficiary = await OTC.restrictFulfillToBeneficiaryOrApprover();

  console.log("\n🔍 Current Flags:");
  console.log("  requireApproverToFulfill:", requireApprover);
  console.log("  restrictFulfillToBeneficiaryOrApprover:", restrictToBeneficiary);

  // Set flags to allow beneficiary to pay
  if (requireApprover) {
    console.log("\n⚙️  Setting requireApproverToFulfill to false (allow beneficiary to pay)...");
    const tx1 = await OTC.setRequireApproverToFulfill(false);
    await tx1.wait();
    console.log("  ✅ Done!");
  }

  if (!restrictToBeneficiary) {
    console.log("\n⚙️  Setting restrictFulfillToBeneficiaryOrApprover to true (secure mode)...");
    const tx2 = await OTC.setRestrictFulfill(true);
    await tx2.wait();
    console.log("  ✅ Done!");
  }

  // Verify
  const newRequireApprover = await OTC.requireApproverToFulfill();
  const newRestrictToBeneficiary = await OTC.restrictFulfillToBeneficiaryOrApprover();

  console.log("\n✅ Final Flags:");
  console.log("  requireApproverToFulfill:", newRequireApprover);
  console.log("  restrictFulfillToBeneficiaryOrApprover:", newRestrictToBeneficiary);
  
  console.log("\n✨ Configuration complete! Users can now pay for their offers.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
