// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {OTC} from "../contracts/OTC.sol";
import {RegistrationHelper} from "../contracts/RegistrationHelper.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAggregatorV3 as AggregatorV3Interface} from "../contracts/interfaces/IAggregatorV3.sol";

/// @title DeployOTCEthereum
/// @notice Deploy token-agnostic OTC contract and RegistrationHelper to Ethereum mainnet
contract DeployOTCEthereum is Script {
    // Ethereum Mainnet addresses
    address constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address constant ETH_USD_FEED = 0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419;
    
    function run() external {
        uint256 deployerPrivateKey = vm.envOr("EVM_PRIVATE_KEY", vm.envUint("EVM_PRIVATE_KEY"));
        address deployer = vm.addr(deployerPrivateKey);
        
        console.log("Deploying to Ethereum Mainnet from:", deployer);
        console.log("Balance:", deployer.balance);
        
        require(deployer.balance > 0.01 ether, "Insufficient balance for deployment");
        
        address owner = vm.envOr("OWNER_ADDRESS", deployer);
        address agent = vm.envOr("AGENT_ADDRESS", deployer);
        address approver = vm.envOr("APPROVER_ADDRESS", deployer);
        
        console.log("Owner:", owner);
        console.log("Agent:", agent);
        console.log("Approver:", approver);
        
        vm.startBroadcast(deployerPrivateKey);
        
        // 1. Deploy OTC Contract
        console.log("\n=== Deploying OTC Contract ===");
        OTC otc = new OTC(
            owner,
            IERC20(USDC),
            AggregatorV3Interface(ETH_USD_FEED),
            agent
        );
        console.log("OTC deployed at:", address(otc));
        
        // 2. Configure OTC
        console.log("\n=== Configuring OTC ===");
        otc.setApprover(approver, true);
        console.log("Approver set:", approver);
        
        otc.setLimits(
            5 * 1e8,           // minUsdAmount: $5
            1_000_000 * 1e18,  // maxTokenPerOrder: 1M tokens
            30 * 60,           // quoteExpirySeconds: 30 minutes
            0                  // defaultUnlockDelaySeconds: 0
        );
        console.log("Limits configured");
        
        // 3. Deploy RegistrationHelper
        console.log("\n=== Deploying RegistrationHelper ===");
        RegistrationHelper helper = new RegistrationHelper(
            address(otc),
            ETH_USD_FEED
        );
        console.log("RegistrationHelper deployed at:", address(helper));
        
        // 4. Transfer ownership if needed
        if (deployer != owner) {
            console.log("\n=== Transferring Ownership ===");
            otc.transferOwnership(owner);
            console.log("OTC ownership transferred to:", owner);
        }
        
        vm.stopBroadcast();
        
        // Print deployment summary
        console.log("\n=== Deployment Summary ===");
        console.log("Network: Ethereum Mainnet");
        console.log("OTC Contract:", address(otc));
        console.log("RegistrationHelper:", address(helper));
        console.log("USDC:", USDC);
        console.log("ETH/USD Feed:", ETH_USD_FEED);

        string memory deploymentJson = string.concat(
            '{\n',
            '  "network": "ethereum-mainnet",\n',
            '  "chainId": 1,\n',
            '  "timestamp": "', vm.toString(block.timestamp), '",\n',
            '  "contracts": {\n',
            '    "otc": "', vm.toString(address(otc)), '",\n',
            '    "registrationHelper": "', vm.toString(address(helper)), '",\n',
            '    "usdc": "', vm.toString(USDC), '",\n',
            '    "ethUsdFeed": "', vm.toString(ETH_USD_FEED), '"\n',
            '  }\n',
            '}'
        );
        vm.writeFile("deployments/ethereum-mainnet.json", deploymentJson);
        console.log("Wrote deployment to deployments/ethereum-mainnet.json");

        console.log("");
        console.log("=== Environment Variables ===");
        console.log("NEXT_PUBLIC_ETHEREUM_OTC_ADDRESS=%s", address(otc));
        console.log("NEXT_PUBLIC_ETHEREUM_REGISTRATION_HELPER_ADDRESS=%s", address(helper));
    }
}

