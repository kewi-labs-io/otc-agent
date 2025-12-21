// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {RegistrationHelper} from "../contracts/RegistrationHelper.sol";

/**
 * @title DeployRegistrationHelper
 * @notice Deploy a new RegistrationHelper for a specific chain
 * @dev Run with: cd contracts && PRIVATE_KEY=0x... forge script scripts/DeployRegistrationHelper.s.sol --rpc-url <RPC_URL> --broadcast
 * 
 * Supported chains:
 * - Base: --rpc-url https://mainnet.base.org
 * - BSC: --rpc-url https://bsc-dataseed.binance.org
 * - Ethereum: --rpc-url https://eth.llamarpc.com
 */
contract DeployRegistrationHelper is Script {
    // Chain-specific configuration
    struct ChainConfig {
        address otc;
        address ethUsdFeed;
        string name;
    }

    function getChainConfig() internal view returns (ChainConfig memory) {
        uint256 chainId = block.chainid;
        
        if (chainId == 8453) {
            // Base mainnet
            return ChainConfig({
                otc: 0x5a1C9911E104F18267505918894fd7d343739657,
                ethUsdFeed: 0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70,
                name: "Base"
            });
        } else if (chainId == 56) {
            // BSC mainnet
            return ChainConfig({
                otc: 0x0aD688d08D409852668b6BaF6c07978968070221,
                ethUsdFeed: 0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE, // BNB/USD
                name: "BSC"
            });
        } else if (chainId == 1) {
            // Ethereum mainnet
            return ChainConfig({
                otc: 0x5f36221967E34e3A2d6548aaedF4D1E50FE34D46,
                ethUsdFeed: 0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419,
                name: "Ethereum"
            });
        } else {
            revert("Unsupported chain");
        }
    }

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        ChainConfig memory config = getChainConfig();
        
        console.log("=== Deploy RegistrationHelper ===");
        console.log("Chain:", config.name);
        console.log("Chain ID:", block.chainid);
        console.log("Deployer:", deployer);
        console.log("OTC:", config.otc);
        console.log("ETH/USD Feed:", config.ethUsdFeed);
        
        // Verify OTC contract exists
        require(config.otc.code.length > 0, "OTC contract not deployed at address");
        
        vm.startBroadcast(deployerPrivateKey);
        
        RegistrationHelper helper = new RegistrationHelper(config.otc, config.ethUsdFeed);
        console.log("\nRegistrationHelper deployed:", address(helper));
        
        // Log registration fee
        uint256 fee = helper.registrationFee();
        console.log("Registration fee:", fee / 1e15, "milliETH");
        
        vm.stopBroadcast();
        
        console.log("\n=== DEPLOYMENT COMPLETE ===");
        console.log("Update src/config/deployments/mainnet-evm.json:");
        console.log("  networks.", config.name, ".registrationHelper:", address(helper));
    }
}
