// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {OTC} from "../contracts/OTC.sol";
import {IAggregatorV3} from "../contracts/interfaces/IAggregatorV3.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract DeployMainnet is Script {
    // Chainlink ETH/USD price feeds
    address constant BASE_ETH_USD = 0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70;
    address constant ETH_ETH_USD = 0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419;
    address constant BSC_ETH_USD = 0x9ef1B8c0E4F7dc8bF5719Ea496883DC6401d5b2e; // BNB/USD actually
    
    // USDC addresses
    address constant BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant ETH_USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address constant BSC_USDC = 0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d; // BSC-USD
    
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        // Deployer is owner and agent initially
        address owner = deployer;
        address agent = deployer;
        
        uint256 chainId = block.chainid;
        string memory network;
        address usdc;
        address ethUsdFeed;
        
        if (chainId == 8453) {
            network = "base";
            usdc = BASE_USDC;
            ethUsdFeed = BASE_ETH_USD;
        } else if (chainId == 1) {
            network = "ethereum";
            usdc = ETH_USDC;
            ethUsdFeed = ETH_ETH_USD;
        } else if (chainId == 56) {
            network = "bsc";
            usdc = BSC_USDC;
            ethUsdFeed = BSC_ETH_USD;
        } else {
            revert("Unsupported chain");
        }
        
        console.log("Deploying OTC to", network);
        console.log("Chain ID:", chainId);
        console.log("Deployer:", deployer);
        console.log("USDC:", usdc);
        console.log("ETH/USD Feed:", ethUsdFeed);
        
        vm.startBroadcast(deployerPrivateKey);
        
        OTC otc = new OTC(
            owner,
            IERC20(usdc),
            IAggregatorV3(ethUsdFeed),
            agent
        );
        
        console.log("OTC Contract deployed:", address(otc));
        
        // Set deployer as approver
        otc.setApprover(deployer, true);
        console.log("Deployer set as approver");
        
        // Set reasonable limits
        otc.setLimits(
            500_000_000,      // $5 min (8 decimals)
            100_000_000 * 10**18, // 100M tokens max
            30 * 60,          // 30 min quote expiry
            0                 // No default lockup
        );
        console.log("Limits configured");
        
        vm.stopBroadcast();
        
        console.log("\nDEPLOYMENT COMPLETE");
        console.log("OTC Contract:", address(otc));
    }
}
