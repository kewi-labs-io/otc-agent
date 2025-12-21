// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {RegistrationHelper} from "../contracts/RegistrationHelper.sol";
import {IOTC} from "../contracts/interfaces/IOTC.sol";

/// @title UpgradeRegistrationHelper
/// @notice Deploy updated RegistrationHelper with adaptive TWAP intervals
contract UpgradeRegistrationHelper is Script {
    // Base Mainnet addresses
    address constant EXISTING_OTC = 0x23eD9EC8deb2F88Ec44a2dbbe1bbE7Be7EFc02b9;
    address constant ETH_USD_FEED = 0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70;
    
    function run() external {
        // Get deployer private key from environment
        uint256 deployerPrivateKey = vm.envOr("EVM_PRIVATE_KEY", vm.envUint("EVM_PRIVATE_KEY"));
        address deployer = vm.addr(deployerPrivateKey);
        
        console.log("Deploying from:", deployer);
        console.log("Balance:", deployer.balance);
        
        require(deployer.balance > 0.001 ether, "Insufficient balance for deployment");
        
        vm.startBroadcast(deployerPrivateKey);
        
        // Deploy new RegistrationHelper
        console.log("\n=== Deploying Updated RegistrationHelper ===");
        RegistrationHelper helper = new RegistrationHelper(
            EXISTING_OTC,
            ETH_USD_FEED
        );
        console.log("New RegistrationHelper deployed at:", address(helper));
        
        vm.stopBroadcast();
        
        // Print deployment summary
        console.log("\n=== Deployment Summary ===");
        console.log("Network: Base Mainnet");
        console.log("Existing OTC Contract:", EXISTING_OTC);
        console.log("New RegistrationHelper:", address(helper));
        console.log("ETH/USD Feed:", ETH_USD_FEED);

        // Write updated deployment info
        string memory deploymentJson = string.concat(
            '{\n',
            '  "network": "base-mainnet",\n',
            '  "timestamp": "', vm.toString(block.timestamp), '",\n',
            '  "contracts": {\n',
            '    "otc": "', vm.toString(EXISTING_OTC), '",\n',
            '    "registrationHelper": "', vm.toString(address(helper)), '",\n',
            '    "usdc": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",\n',
            '    "ethUsdFeed": "', vm.toString(ETH_USD_FEED), '"\n',
            '  }\n',
            '}'
        );
        vm.writeFile("deployments/mainnet-evm.json", deploymentJson);
        console.log("Wrote deployment to deployments/mainnet-evm.json");

        console.log("");
        console.log("=== Environment Variables to Update ===");
        console.log("NEXT_PUBLIC_REGISTRATION_HELPER_ADDRESS=%s", address(helper));
    }
}
