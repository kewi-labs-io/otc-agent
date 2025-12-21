// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";

interface IOTC {
    function setLimits(uint256 minUsd, uint256 maxToken, uint256 expirySecs, uint256 unlockDelaySecs) external;
    function minUsdAmount() external view returns (uint256);
    function maxTokenPerOrder() external view returns (uint256);
    function quoteExpirySeconds() external view returns (uint256);
    function defaultUnlockDelaySeconds() external view returns (uint256);
}

contract SetMinUsdZero is Script {
    function run() external {
        address otcAddress = 0x5a1C9911E104F18267505918894fd7d343739657;
        
        uint256 deployerPrivateKey = vm.envUint("MAINNET_PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        IOTC otc = IOTC(otcAddress);
        
        // Get current values
        uint256 currentMinUsd = otc.minUsdAmount();
        uint256 maxToken = otc.maxTokenPerOrder();
        uint256 expirySecs = otc.quoteExpirySeconds();
        uint256 unlockDelaySecs = otc.defaultUnlockDelaySeconds();
        
        console.log("Current minUsdAmount:", currentMinUsd);
        console.log("maxTokenPerOrder:", maxToken);
        console.log("quoteExpirySeconds:", expirySecs);
        console.log("defaultUnlockDelaySeconds:", unlockDelaySecs);
        
        // Set minUsd to 0, keep other values
        otc.setLimits(0, maxToken, expirySecs, unlockDelaySecs);
        
        console.log("Set minUsdAmount to 0");
        console.log("New minUsdAmount:", otc.minUsdAmount());

        vm.stopBroadcast();
    }
}
