// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title TestToken
 * @dev Simple ERC20 token for testing the OTC desk
 * Allows anyone to mint tokens for testing purposes
 */
contract TestToken is ERC20, Ownable {
    uint256 public constant MAX_SUPPLY = 1_000_000_000 * 10**18; // 1 billion tokens
    
    constructor() ERC20("Test OTC Token", "TBT") Ownable(msg.sender) {
        // Mint initial supply to deployer
        _mint(msg.sender, 100_000_000 * 10**18); // 100 million tokens
    }
    
    /**
     * @dev Public mint function for testing
     * Anyone can mint up to 10,000 tokens at a time
     */
    function mint(uint256 amount) external {
        require(amount <= 10_000 * 10**18, "Cannot mint more than 10,000 tokens at once");
        require(totalSupply() + amount <= MAX_SUPPLY, "Would exceed max supply");
        _mint(msg.sender, amount);
    }
    
    /**
     * @dev Owner can mint any amount (for funding the otc contract)
     */
    function ownerMint(address to, uint256 amount) external onlyOwner {
        require(totalSupply() + amount <= MAX_SUPPLY, "Would exceed max supply");
        _mint(to, amount);
    }
    
    /**
     * @dev Burn tokens
     */
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}


