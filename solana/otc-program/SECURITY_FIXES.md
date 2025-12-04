# Security Fixes Required for OTC Program

## Critical Fixes

### 1. Add Offer-to-Desk Validation

All instructions that operate on offers must validate `offer.desk == desk.key()`:

```rust
// ApproveOffer - line 1064
#[derive(Accounts)]
pub struct ApproveOffer<'info> {
    pub desk: Account<'info, Desk>,
    #[account(mut, constraint = offer.desk == desk.key() @ OtcError::BadState)]  // ADD THIS
    pub offer: Account<'info, Offer>,
    pub approver: Signer<'info>,
}

// CancelOffer - line 1072
#[derive(Accounts)]
pub struct CancelOffer<'info> {
    pub desk: Account<'info, Desk>,
    #[account(mut, constraint = offer.desk == desk.key() @ OtcError::BadState)]  // ADD THIS
    pub offer: Account<'info, Offer>,
    pub caller: Signer<'info>,
}

// FulfillOfferUsdc - line 1080
#[derive(Accounts)]
pub struct FulfillOfferUsdc<'info> {
    #[account(mut)]
    pub desk: Account<'info, Desk>,
    #[account(mut, constraint = offer.desk == desk.key() @ OtcError::BadState)]  // ADD THIS
    pub offer: Account<'info, Offer>,
    // ...
}

// FulfillOfferSol - line 1099
#[derive(Accounts)]
pub struct FulfillOfferSol<'info> {
    #[account(mut)]
    pub desk: Account<'info, Desk>,
    #[account(mut, constraint = offer.desk == desk.key() @ OtcError::BadState)]  // ADD THIS
    pub offer: Account<'info, Offer>,
    // ...
}

// Claim - line 1113
#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub desk: Account<'info, Desk>,
    pub desk_signer: Signer<'info>,
    #[account(mut, constraint = offer.desk == desk.key() @ OtcError::BadState)]  // ADD THIS
    pub offer: Account<'info, Offer>,
    // ...
}
```

### 2. Add TokenRegistry-to-Desk Validation

```rust
// CreateOffer - line 1049
#[derive(Accounts)]
pub struct CreateOffer<'info> {
    #[account(mut)]
    pub desk: Account<'info, Desk>,
    #[account(constraint = token_registry.desk == desk.key() @ OtcError::BadState)]  // ADD THIS
    pub token_registry: Account<'info, TokenRegistry>,
    // ...
}

// CreateOfferFromConsignment - line 962
#[derive(Accounts)]
pub struct CreateOfferFromConsignment<'info> {
    #[account(mut)]
    pub desk: Account<'info, Desk>,
    #[account(mut)]
    pub consignment: Account<'info, Consignment>,
    #[account(constraint = token_registry.desk == desk.key() @ OtcError::BadState)]  // ADD THIS
    pub token_registry: Account<'info, TokenRegistry>,
    // ...
}

// DepositTokens - line 1034
#[derive(Accounts)]
pub struct DepositTokens<'info> {
    #[account(mut)]
    pub desk: Account<'info, Desk>,
    #[account(constraint = token_registry.desk == desk.key() @ OtcError::BadState)]  // ADD THIS
    pub token_registry: Account<'info, TokenRegistry>,
    // ...
}
```

### 3. Add Treasury Owner Validation

```rust
// Claim - line 1113
#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub desk: Account<'info, Desk>,
    pub desk_signer: Signer<'info>,
    #[account(mut, constraint = offer.desk == desk.key() @ OtcError::BadState)]
    pub offer: Account<'info, Offer>,
    #[account(
        mut, 
        constraint = desk_token_treasury.mint == offer.token_mint,
        constraint = desk_token_treasury.owner == desk.key() @ OtcError::BadState  // ADD THIS
    )]
    pub desk_token_treasury: Account<'info, TokenAccount>,
    #[account(
        mut, 
        constraint = beneficiary_token_ata.mint == offer.token_mint,
        constraint = beneficiary_token_ata.owner == offer.beneficiary @ OtcError::BadState  // ADD THIS
    )]
    pub beneficiary_token_ata: Account<'info, TokenAccount>,
    // ...
}
```

### 4. Fix Pool Price Oracle

Replace spot price with TWAP or add protections:

```rust
pub fn update_token_price_from_pool(
    ctx: Context<UpdateTokenPriceFromPool>,
    max_price_deviation_bps: u16,  // ADD PARAMETER
) -> Result<()> {
    let registry = &mut ctx.accounts.token_registry;
    require!(registry.pool_address != Pubkey::default(), OtcError::FeedNotConfigured);
    
    // ADD: Verify pool is from a known AMM program (Raydium, Orca, etc.)
    // This requires checking the pool account's owner against known program IDs
    let pool_owner = ctx.accounts.pool.owner;
    let known_amm_programs = [
        // Raydium AMM V4
        Pubkey::try_from("675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8").unwrap(),
        // Orca Whirlpool
        Pubkey::try_from("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc").unwrap(),
    ];
    require!(known_amm_programs.contains(&pool_owner), OtcError::BadState);
    
    // ... rest of price calculation ...
    
    // ADD: Price deviation check
    if registry.token_usd_price_8d > 0 && max_price_deviation_bps > 0 {
        let old_price = registry.token_usd_price_8d;
        let price_diff = if price_8d > old_price {
            price_8d - old_price
        } else {
            old_price - price_8d
        };
        let max_deviation = (old_price as u128 * max_price_deviation_bps as u128) / 10000u128;
        require!(price_diff as u128 <= max_deviation, OtcError::PriceDeviationTooLarge);
    }
    
    // ADD: Staleness check
    let now = Clock::get()?.unix_timestamp;
    if registry.prices_updated_at > 0 {
        let min_update_interval = 60; // At least 60 seconds between updates
        require!(
            now - registry.prices_updated_at >= min_update_interval,
            OtcError::StalePrice
        );
    }
    
    Ok(())
}
```

### 5. Add Inventory Reservation System

Add reservation tracking to prevent overbooking:

```rust
// In TokenRegistry struct, add:
pub reserved_amount: u64,

// In create_offer, add reservation:
pub fn create_offer(...) -> Result<()> {
    // ... existing validation ...
    
    // Check and reserve inventory
    let treasury_balance = ctx.accounts.desk_token_treasury.amount;
    let available = treasury_balance.checked_sub(registry.reserved_amount)
        .ok_or(OtcError::InsuffInv)?;
    require!(available >= token_amount, OtcError::InsuffInv);
    
    // Reserve tokens
    let registry = &mut ctx.accounts.token_registry;
    registry.reserved_amount = registry.reserved_amount
        .checked_add(token_amount)
        .ok_or(OtcError::Overflow)?;
    
    // ... rest of offer creation ...
}

// In cancel_offer and claim, release reservation:
registry.reserved_amount = registry.reserved_amount
    .checked_sub(offer.token_amount)
    .ok_or(OtcError::Overflow)?;
```

### 6. Fix Emergency Refund Consistency

Remove deprecated `token_reserved` usage:

```rust
// In emergency_refund_sol and emergency_refund_usdc, REMOVE:
// desk.token_reserved = desk.token_reserved.checked_sub(offer.token_amount)...

// Instead, update the TokenRegistry:
// First, add token_registry to the accounts:
pub token_registry: Account<'info, TokenRegistry>,

// Then in the function:
let registry = &mut ctx.accounts.token_registry;
registry.reserved_amount = registry.reserved_amount
    .checked_sub(offer.token_amount)
    .ok_or(OtcError::Overflow)?;
```

### 7. Add Consignment-to-Desk Validation

```rust
// CreateOfferFromConsignment
#[account(
    mut, 
    constraint = consignment.desk == desk.key() @ OtcError::BadState,
    constraint = consignment.is_active @ OtcError::BadState
)]
pub consignment: Account<'info, Consignment>,
```

### 8. Add Minimum Quote Expiry

```rust
pub fn set_limits(..., quote_expiry_secs: i64, ...) -> Result<()> {
    require!(quote_expiry_secs >= 60, OtcError::AmountRange); // At least 60 seconds
    // ...
}
```

## New Error Codes Needed

```rust
#[error_code]
pub enum OtcError {
    // ... existing errors ...
    #[msg("Invalid pool program")] InvalidPoolProgram,
    #[msg("Update too frequent")] UpdateTooFrequent,
}
```

## Testing Requirements

After implementing these fixes:

1. Run the security audit tests:
   ```bash
   anchor test -- --grep "Security Audit"
   ```

2. All "VULNERABILITY" assertions should now properly fail (meaning the attack is prevented)

3. Run fuzzing with Trident:
   ```bash
   cargo install trident-cli
   trident init
   trident fuzz run
   ```

## Deployment Checklist

- [ ] All constraint validations added
- [ ] Pool price oracle hardened
- [ ] Inventory reservation system implemented
- [ ] Emergency refund consistency fixed
- [ ] Security tests pass
- [ ] Fuzzing completed
- [ ] External audit scheduled

