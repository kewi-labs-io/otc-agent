# OTC E2E Verification Report

**Date**: December 18, 2025  
**Status**: ✅ All Flows Verified

---

## 1. Deployed Contract Addresses

### EVM Networks

| Network | OTC Contract | RegistrationHelper |
|---------|-------------|-------------------|
| **Base** | `0x23eD9EC8deb2F88Ec44a2dbbe1bbE7Be7EFc02b9` | `0x30E2Fc66C19a999b8E8112eF5A78E84AeeF441E0` |
| **BSC** | `0x0aD688d08D409852668b6BaF6c07978968070221` | `0x979C01B70B6aD54b8D3093Bf9a1D550F00560037` |
| **Ethereum** | `0x5f36221967E34e3A2d6548aaedF4D1E50FE34D46` | `0x60bD4C45c2512d0C652eecE6dfDA292EA9D3E06d` |

### Solana

| Component | Address |
|-----------|---------|
| **Program** | `q9MhHpeydqTdtPaNpzDoWvP1qY5s3sFHTF1uYcXjdsc` |
| **Desk** | `6CBcxFR6dSMJJ7Y4dQZTshJT2KxuwnSXioXEABxNVZPW` |

---

## 2. Contract Configuration (Base Mainnet)

```
Owner:       0x1b324Bfc7A0b93D621d8A85F3fF6375528bFae8D
Agent:       0x1b324Bfc7A0b93D621d8A85F3fF6375528bFae8D
USDC:        0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
Paused:      NO
Min USD:     $5.00
Quote Expiry: 1800s (30 min)
```

---

## 3. P2P Auto-Approval Implementation

### EVM (OTC.sol)

```solidity
// In createOfferFromConsignment():
if (c.isNegotiable) {
    // Negotiable: requires manual approval
    require(agentCommissionBps >= 25 && agentCommissionBps <= 150, "commission out of range");
} else {
    // P2P: auto-approved
    require(discountBps == c.fixedDiscountBps, "must use fixed discount");
    require(agentCommissionBps == 0, "P2P deals have no commission");
    o.approved = true;  // <-- AUTO APPROVAL
}

// Emit approval for P2P
if (!c.isNegotiable) {
    emit OfferApproved(offerId, msg.sender);
}

// In approveOffer() - guard against re-approval:
require(consignments[o.consignmentId].isNegotiable, "non-negotiable offers are P2P");
```

### Solana (lib.rs)

```rust
// In create_offer_from_consignment():
let auto_approved = !consignment.is_negotiable;
offer.approved = auto_approved;  // <-- AUTO APPROVAL

if auto_approved {
    emit!(OfferApproved { offer: offer_key, approver: beneficiary_key });
}

// In approve_offer() - guard against re-approval:
require!(consignment.is_negotiable, OtcError::NonNegotiableP2P);
```

---

## 4. Test Results (85/85 Passed)

### Full Lifecycle Tests
```
✅ test_FullCycle_HappyPath - P2P flow with auto-approval
✅ test_CancelFlow - Offer cancellation
✅ test_SolvencyProtection - Multi-consignment protection
```

### P2P Auto-Approval Verification
```
Event Trace from test_FullCycle_HappyPath:

1. OfferCreated(id: 1, beneficiary: 0x...05, agentCommissionBps: 0)
2. OfferApproved(id: 1, by: 0x...05)  <-- IMMEDIATE AUTO-APPROVAL
3. OfferPaid(id: 1, payer: 0x...05, amountPaid: 100000000)
4. TokensClaimed(id: 1, beneficiary: 0x...05, amount: 100e18)
```

### Agent Approval Verification  
```
Event Trace from test_DoubleReservationBug:

1. OfferCreated(id: 1, agentCommissionBps: 100)
   [NO OfferApproved here - requires manual approval]
2. [approver calls approveOffer()]
3. OfferApproved(id: 1, by: 0x...03)  <-- AGENT APPROVAL
4. OfferPaid(...)
```

---

## 5. Flow Verification

### P2P Flow (Non-Negotiable)
```
1. createConsignment(isNegotiable=false, fixedDiscount=0, fixedLockup=0)
2. createOfferFromConsignment(discount=0, lockup=0, commission=0)
   → offer.approved = true (AUTOMATIC)
   → OfferApproved event emitted
3. fulfillOffer() - Pay USDC/ETH
4. claim() - Receive tokens
```

### Agent Flow (Negotiable)
```
1. createConsignment(isNegotiable=true, discountRange=[0,1000], lockupRange=[0,30])
2. createOfferFromConsignment(discount=500, lockup=7, commission=100)
   → offer.approved = false (MANUAL REQUIRED)
3. approveOffer() - Agent/Approver signs
   → offer.approved = true
   → OfferApproved event emitted
4. fulfillOffer() - Pay USDC/ETH  
5. claim() - Receive tokens
```

---

## 6. Commission Validation

| Deal Type | Commission | Validation |
|-----------|-----------|------------|
| **P2P (Non-Negotiable)** | Must be 0 | `require(agentCommissionBps == 0)` |
| **Negotiable** | 25-150 bps | `require(agentCommissionBps >= 25 && <= 150)` |

---

## 7. Security Tests Passed

```
✅ test_EXPLOIT_CannotDoubleApprove
✅ test_EXPLOIT_CannotApproveCancelledOffer
✅ test_EXPLOIT_CannotClaimMoreThanPaid
✅ test_EXPLOIT_CannotOverReserveConsignment
✅ test_EXPLOIT_CannotReplayOffer
✅ test_EXPLOIT_CannotUnderpayETH
✅ test_PROTECTION_ReentrancyGuardWorks
✅ test_FIX_EmergencyRefundRestoresConsignment
✅ All fuzz tests (8 tests)
✅ All invariant tests (5 tests)
```

---

## 8. On-Chain Verification Commands

### Base Mainnet
```bash
# Check contract is deployed
cast code 0x23eD9EC8deb2F88Ec44a2dbbe1bbE7Be7EFc02b9 --rpc-url https://base-rpc.publicnode.com

# Check owner
cast call 0x23eD9EC8deb2F88Ec44a2dbbe1bbE7Be7EFc02b9 "owner()" --rpc-url https://base-rpc.publicnode.com

# Check not paused
cast call 0x23eD9EC8deb2F88Ec44a2dbbe1bbE7Be7EFc02b9 "paused()" --rpc-url https://base-rpc.publicnode.com
```

### Solana Mainnet
```bash
# Check program deployed
solana program show q9MhHpeydqTdtPaNpzDoWvP1qY5s3sFHTF1uYcXjdsc --url https://api.mainnet-beta.solana.com

# Check desk account
solana account 6CBcxFR6dSMJJ7Y4dQZTshJT2KxuwnSXioXEABxNVZPW --url https://api.mainnet-beta.solana.com
```

---

## 9. Summary

| Feature | Status |
|---------|--------|
| P2P Auto-Approval | ✅ Implemented |
| Agent Approval | ✅ Implemented |
| Commission Validation | ✅ Implemented |
| Fixed Discount/Lockup (P2P) | ✅ Implemented |
| Variable Discount/Lockup (Negotiable) | ✅ Implemented |
| Base Deployment | ✅ Verified |
| BSC Deployment | ✅ Verified |
| Ethereum Deployment | ✅ Verified |
| Solana Deployment | ✅ Verified |
| All Tests Passing | ✅ 85/85 |

**All flows verified and working correctly.**

