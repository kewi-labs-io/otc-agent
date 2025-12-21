// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {IOTC} from "../contracts/interfaces/IOTC.sol";
import {UniswapV3TWAPOracle} from "../contracts/UniswapV3TWAPOracle.sol";

/**
 * @title RegisterElizaOS
 * @notice Script to register ELIZAOS token on Base OTC contract
 * @dev Run with: cd contracts && PRIVATE_KEY=0x... forge script scripts/RegisterElizaOS.s.sol --rpc-url https://mainnet.base.org --broadcast
 */
contract RegisterElizaOS is Script {
    // Base mainnet addresses
    address constant ELIZAOS_TOKEN = 0xea17Df5Cf6D172224892B5477A16ACb111182478;
    address constant ELIZAOS_POOL = 0x84b783723DaC9B89d0981FFf3dcE369bC5870C16; // USDC/ELIZAOS Uniswap V3
    address constant OTC_CONTRACT = 0x5a1C9911E104F18267505918894fd7d343739657;
    address constant ETH_USD_FEED = 0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        console.log("=== ELIZAOS Token Registration ===");
        console.log("Deployer:", deployer);
        console.log("Token:", ELIZAOS_TOKEN);
        console.log("Pool:", ELIZAOS_POOL);
        console.log("OTC:", OTC_CONTRACT);
        
        // Compute tokenId
        bytes32 tokenId = keccak256(abi.encodePacked(ELIZAOS_TOKEN));
        console.log("Token ID:");
        console.logBytes32(tokenId);
        
        // Check if already registered
        IOTC otc = IOTC(OTC_CONTRACT);
        (address registeredAddr, , bool isActive, address existingOracle) = otc.tokens(tokenId);
        
        if (registeredAddr != address(0) && isActive) {
            console.log("\nToken already registered:");
            console.log("  Address:", registeredAddr);
            console.log("  Oracle:", existingOracle);
            
            // Test existing oracle
            UniswapV3TWAPOracle existingOracleContract = UniswapV3TWAPOracle(existingOracle);
            uint256 existingPrice = existingOracleContract.getTWAPPrice();
            console.log("  Current price (8 decimals):", existingPrice);
            console.log("  Price in USD: $", existingPrice / 1e6, ".", (existingPrice % 1e6) / 1e4);
            return;
        }
        
        vm.startBroadcast(deployerPrivateKey);
        
        // Deploy oracle
        console.log("\nDeploying UniswapV3TWAPOracle...");
        UniswapV3TWAPOracle oracle = new UniswapV3TWAPOracle(
            ELIZAOS_POOL,
            ELIZAOS_TOKEN,
            ETH_USD_FEED
        );
        console.log("Oracle deployed:", address(oracle));
        
        // Test oracle
        uint256 price = oracle.getTWAPPrice();
        console.log("Oracle test - price (8 decimals):", price);
        console.log("Price in USD: $", price / 1e6, ".", (price % 1e6) / 1e4);
        
        // Register token
        console.log("\nRegistering token...");
        otc.registerToken(tokenId, ELIZAOS_TOKEN, address(oracle));
        console.log("Token registered successfully");
        
        vm.stopBroadcast();
        
        console.log("\n=== REGISTRATION COMPLETE ===");
        console.log("Oracle:", address(oracle));
        console.log("Token ID:");
        console.logBytes32(tokenId);
    }
}
