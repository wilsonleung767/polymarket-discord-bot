# CLOB Market Order Fix Summary

## Problem
The CLOB was rejecting FOK/FAK orders with error:
```
Error: invalid amounts, the market buy orders maker amount supports a max accuracy of 2 decimals, taker amount a max of 4 decimals
```

## Root Cause
1. **Wrong order creation method**: Using `createOrder()` (limit-style) for FOK/FAK instead of `createMarketOrder()`
2. **Invalid rounding**: For BUY orders, `createOrder()` does:
   - `rawTakerAmt = roundDown(size, 2)` → shares forced to 2 decimals
   - `rawMakerAmt = rawTakerAmt * price` → USDC can have 4+ decimals
   - This violates "USDC max 2 decimals" for market orders
3. **Poor error handling**: Lost the real error message from CLOB API

## Solution

### 1. Updated `PlaceOrderParams` interface
Added optional `usdcAmount` field for market order sizing:
```typescript
export interface PlaceOrderParams {
  // ... existing fields ...
  /** For BUY + FOK/FAK orders: USDC amount to spend (used for market order sizing) */
  usdcAmount?: number;
}
```

### 2. Modified `placeOrder()` method
- **For FOK/FAK orders**: Use `client.createMarketOrder()` with proper amount
  - BUY: `amount = usdcAmount` (USDC to spend)
  - SELL: `amount = size` (shares to sell)
- **For GTC orders**: Keep using `client.createOrder()`

### 3. Improved error handling
Added check for `orderResponse.error` before checking `orderResponse.success`:
```typescript
if (orderResponse.error) {
  const errorMsg = typeof orderResponse.error === 'string' 
    ? orderResponse.error 
    : JSON.stringify(orderResponse.error);
  console.error(`❌ Order placement failed (status ${orderResponse.status}): ${errorMsg}`);
  return { success: false, error: errorMsg, orderType: params.orderType };
}
```

### 4. Updated `ClobExecutor`
- For BUY + FOK/FAK: Pass `usdcAmount` to spend exactly the scaled amount
- For SELL or GTC: Use share-based sizing
- Added clear logging to show what's being sent

## Market Order Rounding Rules (from SDK)

For tickSize `0.01`:

### BUY Market Orders
- **Maker amount (USDC)**: Max 2 decimals → `roundDown(usdcAmount, 2)`
- **Taker amount (shares)**: Max 4 decimals → `roundDown(usdcAmount / price, 4)`

### SELL Market Orders
- **Maker amount (shares)**: Max 2 decimals → `roundDown(size, 2)`
- **Taker amount (USDC)**: Max 4 decimals → `roundDown(size * price, 4)`

## Test Results
All test cases pass with proper rounding:
- ✅ BUY $2.0448 → rounds to $2.04 USDC (2 decimals), 3.1875 shares (4 decimals)
- ✅ BUY $10.00 at $0.6397 → 10 USDC (0 decimals), 15.873 shares (3 decimals)
- ✅ SELL 5.5 shares → 5.5 shares (1 decimal), 3.52 USDC (2 decimals)

## Files Modified
1. `src/polymarket/clob/client.ts` - Updated order placement logic
2. `src/copyTrading/clobExecutor.ts` - Pass usdcAmount for market orders

## Next Steps
- Monitor order placement for successful execution
- Verify actual filled amounts match expected amounts
- Consider adding retry logic for transient errors
