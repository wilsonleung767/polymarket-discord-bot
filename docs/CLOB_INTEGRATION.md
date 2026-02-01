# CLOB Integration

This bot now uses direct CLOB order posting instead of the SDK's auto-exec feature for better control and reliability.

## Configuration

Add the following environment variables to your `.env` file:

```bash
# Required
POLY_PRIVATE_KEY=0x_your_private_key
POLY_FUNDER=0x_your_funder_address
POLY_SIGNATURE_TYPE=1

# Optional
POLY_CLOB_HOST=https://clob.polymarket.com
```

### Finding Your Funder Address

Your funder address is your Polymarket profile address. You can find it:
1. Go to your Polymarket profile
2. Look at the URL: `https://polymarket.com/@username`
3. Click on your profile picture and copy the wallet address shown

### Signature Type

- `0`: Browser wallet (MetaMask, etc.)
- `1`: Email/Magic wallet (most common)

## How It Works

The integration follows this flow:

1. **Trade Listening**: Uses `RealtimeServiceV2.subscribeAllActivity()` to listen for trades from target addresses
2. **Market Resolution**: Resolves `tokenID`, `tickSize`, and `negRisk` from Gamma + CLOB APIs
3. **Order Execution**: Calculates copy size, applies slippage, and posts orders via CLOB client
4. **Discord Notifications**: Sends formatted trade embeds to Discord

## Testing

### Smoke Test

Test your CLOB configuration with a small order:

```bash
npm run test-clob will-trump-win-the-2024-presidential-election YES 1
```

This will:
1. Initialize the CLOB client with your credentials
2. Resolve market metadata for the specified market and outcome
3. Fetch current market price
4. Calculate order parameters
5. Ask for confirmation
6. Place a real order if confirmed

**⚠️ WARNING**: This places a REAL order on Polymarket. Use a small test amount!

### Dry Run Mode

Test trade copying without placing real orders:

```bash
/start address:0x... dry_run:true
```

This will:
- Listen for trades from the target address
- Calculate copy amounts
- Show what would be traded
- NOT place any actual orders

## Architecture

### Components

1. **PolymarketClobClient** (`src/polymarket/clob/client.ts`)
   - Wraps `@polymarket/clob-client` 
   - Handles API key creation/caching
   - Provides simplified `placeOrder()` interface

2. **MarketMetadataResolver** (`src/polymarket/markets.ts`)
   - Resolves tokenID, tickSize, negRisk from Gamma + CLOB APIs
   - Caches results for 5 minutes
   - Handles outcome matching (YES/NO, etc.)

3. **ClobExecutor** (`src/copyTrading/clobExecutor.ts`)
   - Translates trade signals into CLOB orders
   - Handles sizing logic (sizeScale, maxSizePerTrade, minTradeSize)
   - Applies slippage adjustment
   - Rounds prices to tick size

4. **CopyTradingSession** (`src/copyTrading/session.ts`)
   - Manages active copy trading sessions
   - Subscribes to WebSocket activity feed
   - Filters trades by target address
   - Coordinates execution and Discord notifications

## Order Sizing Logic

Given a leader's trade:

1. **Base Copy Amount**: `leaderNotional * sizeScale`
2. **Max Size Enforcement**: If result > `maxSizePerTrade`, cap at `maxSizePerTrade`
3. **Min Size Check**: If result < `minTradeSize`, skip trade
4. **Total Limit Check**: If `totalLimit` set, stop session when cumulative spending exceeds limit

Example:
- Leader trades: 100 shares @ $0.65 = $65
- Your settings: `sizeScale=0.1`, `maxSizePerTrade=10`
- Your copy: $65 * 0.1 = $6.50

## Slippage Handling

For each order:

1. **BUY orders**: Increase price by `maxSlippage` (e.g., 0.65 → 0.6695 at 3% slippage)
2. **SELL orders**: Decrease price by `maxSlippage` (e.g., 0.65 → 0.6305)
3. **Tick size rounding**: Round to nearest valid tick (usually 0.01)
4. **Price bounds**: Clamp to [0.01, 0.99]

## Order Types

- **FOK (Fill or Kill)**: Order must be completely filled immediately or cancelled
- **FAK (Fill and Kill)**: Order fills as much as possible immediately, remainder cancelled
- **GTC (Good Till Cancelled)**: Order stays on order book until filled or manually cancelled

Default: `FOK` (safer for copy trading)

## Troubleshooting

### "CLOB client not initialized"
- Ensure you called `initialize()` before placing orders
- Check that your private key and funder address are correct

### "Market not found"
- Verify the market slug is correct
- Try using the exact slug from the Polymarket URL

### "Outcome not found in market"
- Check that the outcome exists (YES/NO, UP/DOWN, etc.)
- Outcome matching is case-insensitive

### Order placement fails
- Check your USDC balance on Polygon
- Verify your allowance is approved for the CTF Exchange contract
- Ensure you have enough MATIC for gas fees

### Orders not executing
- Check slippage settings (too low may cause orders to fail)
- Verify market has sufficient liquidity
- Try GTC orders instead of FOK for better fill rates

## Example .env

```bash
# Discord
DISCORD_TOKEN=your_bot_token
DISCORD_APP_ID=your_app_id
DEFAULT_CHANNEL_ID=your_channel_id

# Polymarket
POLY_PRIVATE_KEY=0xabcdef...
POLY_FUNDER=0x7994956c7f4ca3754b449d4551970053d280c8c3
POLY_SIGNATURE_TYPE=1
POLY_CLOB_HOST=https://clob.polymarket.com

# Trading
SIZE_SCALE=0.1
MAX_SIZE_PER_TRADE=10
MAX_SLIPPAGE=0.03
MIN_TRADE_SIZE=5
ORDER_TYPE=FOK
```

## Migration Notes

This implementation **replaces** the SDK's `startAutoCopyTrading()` with a more direct approach:

### Before (SDK auto-exec):
```typescript
smartMoneyService.startAutoCopyTrading({
  targetAddresses: [...],
  // ... config
})
```

### After (CLOB direct):
```typescript
realtimeService.subscribeAllActivity({
  onTrade: async (trade) => {
    // Filter + execute via CLOB
  }
})
```

### Benefits:
- ✅ Better control over execution logic
- ✅ More transparent order placement
- ✅ Direct access to CLOB features
- ✅ Easier debugging and logging
- ✅ No SDK black-box behavior

### Trade-offs:
- ⚠️ More code to maintain
- ⚠️ Need to handle edge cases manually
- ⚠️ Must implement own deduplication logic
