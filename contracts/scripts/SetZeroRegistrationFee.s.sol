// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";

interface IRegistrationHelper {
    function registrationFee() external view returns (uint256);
    function setRegistrationFee(uint256 newFee) external;
    function owner() external view returns (address);
}

/// @title SetZeroRegistrationFee
/// @notice Set the registration fee to 0 on the RegistrationHelper
contract SetZeroRegistrationFee is Script {
    // Base Mainnet RegistrationHelper address
    address constant REGISTRATION_HELPER = 0x18c1d9b21c5768eb2AEd96835a90d5F7D940BE94;
    
    function run() external {
        // Get the registration helper address from env or use default
        address helperAddr = vm.envOr("REGISTRATION_HELPER", REGISTRATION_HELPER);
        
        IRegistrationHelper helper = IRegistrationHelper(helperAddr);
        
        // Check current fee
        uint256 currentFee = helper.registrationFee();
        console.log("Current registration fee:", currentFee);
        console.log("Owner:", helper.owner());
        
        if (currentFee == 0) {
            console.log("Fee is already 0, no action needed");
            return;
        }
        
        // Get deployer private key from environment
        uint256 deployerPrivateKey = vm.envUint("EVM_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        console.log("Setting fee from:", deployer);
        
        require(deployer == helper.owner(), "Only owner can set fee");
        
        vm.startBroadcast(deployerPrivateKey);
        
        // Set fee to 0
        helper.setRegistrationFee(0);
        
        vm.stopBroadcast();
        
        // Verify
        uint256 newFee = helper.registrationFee();
        console.log("New registration fee:", newFee);
        require(newFee == 0, "Fee was not set to 0");
        
        console.log("Registration fee successfully set to 0");
    }
}
