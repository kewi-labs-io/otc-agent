// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {OTC} from "../contracts/OTC.sol";
import {MockERC20} from "../contracts/MockERC20.sol";
import {MockAggregatorV3} from "../contracts/mocks/MockAggregator.sol";
import {IAggregatorV3} from "../contracts/interfaces/IAggregatorV3.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title UnenforcedFeaturesTest
 * @notice Documents and tests unenforced consignment flags
 * @dev These flags exist in the struct but aren't enforced in business logic
 *      May be placeholders for future features or bugs to be fixed
 */
contract UnenforcedFeaturesTest is Test {
    OTC public otc;
    MockERC20 public token;
    MockERC20 public usdc;
    MockAggregatorV3 public ethFeed;
    MockAggregatorV3 public tokenFeed;
    
    address public owner = address(1);
    address public agent = address(2);
    address public approver = address(3);
    address public consigner = address(4);
    address public buyer = address(5);
    address public randomUser = address(6);
    
    bytes32 public tokenId;

    function setUp() public {
        vm.startPrank(owner);
        
        token = new MockERC20("Test", "TST", 18, 100_000_000e18);
        usdc = new MockERC20("USDC", "USDC", 6, 100_000_000e6);
        ethFeed = new MockAggregatorV3(8, 3000e8);
        tokenFeed = new MockAggregatorV3(8, 1e8);
        
        otc = new OTC(owner, IERC20(address(usdc)), IAggregatorV3(address(ethFeed)), agent);
        otc.setApprover(approver, true);
        
        tokenId = keccak256("TST");
        otc.registerToken(tokenId, address(token), address(tokenFeed));
        
        token.transfer(consigner, 10_000_000e18);
        usdc.transfer(buyer, 10_000_000e6);
        usdc.transfer(randomUser, 10_000_000e6);
        vm.deal(consigner, 100 ether);
        vm.deal(buyer, 100 ether);
        
        vm.stopPrank();
    }

    // ============================================================
    // UNENFORCED #1: isPrivate Flag
    // ============================================================
    
    /**
     * @notice DOCUMENTATION: isPrivate flag is stored but NOT enforced
     * @dev Anyone can create offers on "private" consignments
     *      This may be intentional (placeholder) or a bug
     */
    function test_UNENFORCED_PrivateNotEnforced() public {
        // Create "private" consignment
        vm.startPrank(consigner);
        token.approve(address(otc), 1000e18);
        otc.createConsignment{value: 0.001 ether}(
            tokenId, 1000e18, false, 0, 0, 0, 0, 0, 0, 100e18, 1000e18, 
            true, // isFractionalized
            true, // isPrivate = TRUE
            500, 3600
        );
        vm.stopPrank();
        
        // Verify isPrivate is stored
        (,,,,,,,,,,,,,, bool isPrivate,,,,) = otc.consignments(1);
        assertTrue(isPrivate, "isPrivate should be true");
        
        // Random user can still create offers (NOT ENFORCED)
        vm.prank(randomUser);
        uint256 offerId = otc.createOfferFromConsignment(1, 100e18, 0, OTC.PaymentCurrency.USDC, 0);
        
        assertGt(offerId, 0, "UNENFORCED: Random user created offer on private consignment");
        
        console.log("WARNING: isPrivate flag is NOT enforced in createOfferFromConsignment");
        console.log("Anyone can create offers on private consignments");
    }

    // ============================================================
    // UNENFORCED #2: isFractionalized Flag  
    // ============================================================
    
    /**
     * @notice DOCUMENTATION: isFractionalized flag is stored but NOT enforced
     * @dev The flag doesn't affect offer creation logic
     *      Fractionalization would require NFT-like sub-division logic
     */
    function test_UNENFORCED_FractionalizedNotUsed() public {
        // Create non-fractionalized consignment
        vm.startPrank(consigner);
        token.approve(address(otc), 1000e18);
        otc.createConsignment{value: 0.001 ether}(
            tokenId, 1000e18, false, 0, 0, 0, 0, 0, 0, 100e18, 1000e18, 
            false, // isFractionalized = FALSE
            false, 500, 3600
        );
        vm.stopPrank();
        
        // Multiple offers can still be created (fractionalization happens anyway)
        vm.startPrank(buyer);
        otc.createOfferFromConsignment(1, 100e18, 0, OTC.PaymentCurrency.USDC, 0);
        otc.createOfferFromConsignment(1, 100e18, 0, OTC.PaymentCurrency.USDC, 0);
        otc.createOfferFromConsignment(1, 100e18, 0, OTC.PaymentCurrency.USDC, 0);
        vm.stopPrank();
        
        console.log("WARNING: isFractionalized flag has no effect on offer logic");
        console.log("Multiple offers can always be created regardless of flag value");
    }

    // ============================================================
    // UNENFORCED #3: maxTimeToExecute Flag
    // ============================================================
    
    /**
     * @notice DOCUMENTATION: maxTimeToExecute flag is stored but NOT fully enforced
     * @dev The offer expiry uses quoteExpirySeconds, not maxTimeToExecute
     *      maxTimeToExecute could be used for different per-consignment expiry
     */
    function test_UNENFORCED_MaxTimeToExecuteNotUsedInExpiry() public {
        // Set a short maxTimeToExecute
        vm.startPrank(consigner);
        token.approve(address(otc), 1000e18);
        otc.createConsignment{value: 0.001 ether}(
            tokenId, 1000e18, false, 0, 0, 0, 0, 0, 0, 100e18, 1000e18, true, false, 500, 
            60 // maxTimeToExecute = 60 seconds
        );
        vm.stopPrank();
        
        vm.prank(buyer);
        uint256 offerId = otc.createOfferFromConsignment(1, 100e18, 0, OTC.PaymentCurrency.USDC, 0);
        
        vm.prank(approver);
        otc.approveOffer(offerId);
        
        // Warp 5 minutes (past maxTimeToExecute but within quoteExpirySeconds)
        vm.warp(block.timestamp + 5 minutes);
        
        // Fulfillment still works because quoteExpirySeconds (30 min) is used, not maxTimeToExecute
        vm.startPrank(buyer);
        usdc.approve(address(otc), 100e6);
        otc.fulfillOffer(offerId); // Does NOT fail even though maxTimeToExecute passed
        vm.stopPrank();
        
        console.log("WARNING: maxTimeToExecute is stored but NOT used for offer expiry");
        console.log("quoteExpirySeconds (global) is used instead");
    }

    // ============================================================
    // RECOMMENDATION: Fix or Document These Features
    // ============================================================
    
    /**
     * @notice Summary of unenforced features
     * @dev These should either be:
     *      1. Implemented properly
     *      2. Removed from the struct
     *      3. Documented as placeholders for future use
     *
     * UNENFORCED FLAGS:
     * - isPrivate: Should restrict who can create offers (e.g., whitelist)
     * - isFractionalized: Purpose unclear, possibly for NFT-like ownership
     * - maxTimeToExecute: Should override quoteExpirySeconds per-consignment
     */
    function test_Summary() public pure {
        // This test documents the unenforced features
        // No assertions - just documentation
    }
}

/**
 * @title PotentialImprovementsTest
 * @notice Tests demonstrating potential improvements
 */
contract PotentialImprovementsTest is Test {
    OTC public otc;
    MockERC20 public token;
    MockERC20 public usdc;
    MockAggregatorV3 public ethFeed;
    MockAggregatorV3 public tokenFeed;
    
    address public owner = address(1);
    address public agent = address(2);
    address public approver = address(3);
    address public consigner = address(4);
    address public buyer = address(5);
    
    bytes32 public tokenId;

    function setUp() public {
        vm.startPrank(owner);
        
        token = new MockERC20("Test", "TST", 18, 100_000_000e18);
        usdc = new MockERC20("USDC", "USDC", 6, 100_000_000e6);
        ethFeed = new MockAggregatorV3(8, 3000e8);
        tokenFeed = new MockAggregatorV3(8, 1e8);
        
        otc = new OTC(owner, IERC20(address(usdc)), IAggregatorV3(address(ethFeed)), agent);
        otc.setApprover(approver, true);
        
        tokenId = keccak256("TST");
        otc.registerToken(tokenId, address(token), address(tokenFeed));
        
        token.transfer(consigner, 10_000_000e18);
        usdc.transfer(buyer, 10_000_000e6);
        vm.deal(consigner, 100 ether);
        vm.deal(buyer, 100 ether);
        
        vm.stopPrank();
    }

    /**
     * @notice Test: Anyone can pay for someone else's offer (by design?)
     * @dev If restrictFulfillToBeneficiaryOrApprover is false, anyone can pay
     *      This might be intentional (gift purchases) or unintended
     */
    function test_DESIGN_AnyoneCanPayForOffer() public {
        vm.startPrank(consigner);
        token.approve(address(otc), 1000e18);
        otc.createConsignment{value: 0.001 ether}(
            tokenId, 1000e18, false, 0, 0, 0, 0, 0, 0, 100e18, 1000e18, true, false, 500, 3600
        );
        vm.stopPrank();
        
        // Buyer creates offer
        vm.prank(buyer);
        uint256 offerId = otc.createOfferFromConsignment(1, 100e18, 0, OTC.PaymentCurrency.USDC, 0);
        
        vm.prank(approver);
        otc.approveOffer(offerId);
        
        // Random person pays for buyer's offer
        address randomPayer = address(100);
        vm.prank(owner);
        usdc.transfer(randomPayer, 100e6);
        
        vm.startPrank(randomPayer);
        usdc.approve(address(otc), 100e6);
        otc.fulfillOffer(offerId);
        vm.stopPrank();
        
        // Buyer (beneficiary) still gets the tokens
        vm.prank(buyer);
        otc.claim(offerId);
        
        assertEq(token.balanceOf(buyer), 100e18, "Buyer (beneficiary) received tokens");
        
        console.log("NOTE: Third party paid for buyer's offer");
        console.log("Buyer received tokens even though they didn't pay");
        console.log("This may be intentional (gift feature) or unintended");
    }

    /**
     * @notice Test: requiredApprovals can be changed mid-offer
     * @dev Changing requiredApprovals affects all existing unapproved offers
     *      This could be problematic for consistency
     */
    function test_DESIGN_RequiredApprovalsCanChangeMidOffer() public {
        vm.startPrank(owner);
        otc.setRequiredApprovals(2);
        address approver2 = address(10);
        otc.setApprover(approver2, true);
        vm.stopPrank();
        
        vm.startPrank(consigner);
        token.approve(address(otc), 1000e18);
        otc.createConsignment{value: 0.001 ether}(
            tokenId, 1000e18, false, 0, 0, 0, 0, 0, 0, 100e18, 1000e18, true, false, 500, 3600
        );
        vm.stopPrank();
        
        vm.prank(buyer);
        uint256 offerId = otc.createOfferFromConsignment(1, 100e18, 0, OTC.PaymentCurrency.USDC, 0);
        
        // First approval
        vm.prank(approver);
        otc.approveOffer(offerId);
        
        // Offer not yet approved (needs 2)
        (,,,,,,,,,,, bool approved,,,,,) = otc.offers(offerId);
        assertFalse(approved, "Not yet approved with 1 of 2");
        
        // Admin changes requirement to 1
        vm.prank(owner);
        otc.setRequiredApprovals(1);
        
        // Offer is STILL not approved (requires another approval call to trigger check)
        (,,,,,,,,,,, approved,,,,,) = otc.offers(offerId);
        assertFalse(approved, "Still not approved after requirement change");
        
        // But next approval from same approver fails
        vm.prank(approver);
        vm.expectRevert("already approved by you");
        otc.approveOffer(offerId);
        
        // Different approver can push it through
        vm.prank(approver2);
        otc.approveOffer(offerId);
        
        (,,,,,,,,,,, approved,,,,,) = otc.offers(offerId);
        assertTrue(approved, "Now approved");
        
        console.log("NOTE: Changing requiredApprovals mid-offer requires additional approval");
        console.log("Even if new requirement is met, offer won't auto-approve");
    }
}

