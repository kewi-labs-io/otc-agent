// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IOTC Interface
/// @notice Interface for the OTC contract's external functions
interface IOTC {
    function registerToken(bytes32 tokenId, address tokenAddress, address priceOracle) external;
    
    /// @notice Get token info by tokenId
    /// @return tokenAddress The token contract address
    /// @return decimals Token decimals
    /// @return isActive Whether the token is active
    /// @return priceOracle The price oracle address
    function tokens(bytes32 tokenId) external view returns (
        address tokenAddress,
        uint8 decimals,
        bool isActive,
        address priceOracle
    );
}

