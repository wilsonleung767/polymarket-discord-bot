# Polymarket Copy Trading Discord Bot

A TypeScript Discord bot that enables real-time auto copy trading on Polymarket using the `@catalyst-team/poly-sdk`. Follow specific trader wallets and automatically mirror their trades with customizable parameters.

## Features

- **Real-time Copy Trading**: Automatically copy trades from any Polymarket wallet address
- **Single Global Session**: One active copy trading session at a time for simplicity
- **Flexible Configuration**: Customize size scale, max bet, slippage, and more
- **Dry Run Mode**: Test your strategy without risking real funds
- **Discord Integration**: Receive trade signals with detailed embeds in your Discord channel
- **UTC+8 Timestamps**: All trade signals include timestamps in UTC+8 timezone
- **Comprehensive Statistics**: Track detected, executed, skipped, and failed trades

## Prerequisites

- Node.js 18+ (recommend 20)
- npm or pnpm
- Discord Bot Token and Application ID
- Polymarket wallet private key (with USDC balance for live trading)

## Setup

### 1. Clone and Install Dependencies

```bash
cd C:\Users\wilso\Documents\code\polymarket-bot
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Discord Bot Configuration
DISCORD_TOKEN=your_discord_bot_token_here
DISCORD_APP_ID=your_discord_application_id_here
GUILD_ID=your_guild_id_for_dev_testing
DEFAULT_CHANNEL_ID=your_default_channel_id_here

# Polymarket Trading Configuration
POLY_PRIVATE_KEY=0x_your_polymarket_private_key_here

# Trading Parameters (Optional - defaults shown)
SIZE_SCALE=0.1
MAX_SIZE_PER_TRADE=10
MAX_SLIPPAGE=0.03
MIN_TRADE_SIZE=5
ORDER_TYPE=FOK
```

**To get your Discord Channel ID:**
1. Enable Developer Mode in Discord (User Settings → Advanced → Developer Mode)
2. Right-click on the channel where you want trade signals posted
3. Click "Copy Channel ID"
4. Paste it into `DEFAULT_CHANNEL_ID` in `.env`

### 3. Create Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application" and give it a name
3. Go to "Bot" tab and click "Add Bot"
4. Copy the bot token to `DISCORD_TOKEN` in `.env`
5. Copy the Application ID from "General Information" to `DISCORD_APP_ID`
6. Enable these bot permissions:
   - Send Messages
   - Embed Links
   - Read Message History
   - Use Slash Commands
7. Go to "OAuth2" → "URL Generator":
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: Same as above
8. Use the generated URL to invite the bot to your server
9. Copy your server (guild) ID to `GUILD_ID` for instant command updates during development

### 4. Register Slash Commands

```bash
npm run register-commands
```

This will register `/start`, `/stop`, and `/status` commands to your Discord server.

### 5. Run the Bot

**Development mode (with auto-reload):**
```bash
npm run dev
```

**Production mode:**
```bash
npm run build
npm start
```

## Usage

### Start Copy Trading

```
/start target:0xABCDEF1234567890... [options]
```

**Parameters:**
- `target` (required): Wallet address to copy trade (0x...)
- `channel` (optional): Channel to post trade signals (defaults to DEFAULT_CHANNEL_ID from .env, or current channel)
- `dryrun` (optional): Dry run mode, no real trades (default: true)
- `sizescale` (optional): Size scale, e.g., 0.1 for 10% (default: 0.1)
- `maxsize` (optional): Max USDC per trade (default: 10)
- `slippage` (optional): Max slippage, e.g., 0.03 for 3% (default: 0.03)
- `minsize` (optional): Min trade size to copy in USDC (default: 5)
- `ordertype` (optional): FOK or FAK (default: FOK)

**Example (Dry Run):**
```
/start target:0x1234567890abcdef1234567890abcdef12345678 dryrun:true
```

**Example (Live Trading):**
```
/start target:0x1234567890abcdef1234567890abcdef12345678 dryrun:false sizescale:0.2 maxsize:50
```

### Check Status

```
/status
```

Shows current session info, statistics, and configuration.

### Stop Copy Trading

```
/stop
```

Stops the active session and displays summary statistics.

## Trade Signal Format

When a copy trade is triggered, the bot posts an embed message with:

- **Market Name**: The prediction market being traded
- **Trader**: Name and address of the wallet being copied
- **Action**: BUY/SELL + outcome (Yes/No)
- **Leader Bet**: The original trader's bet amount and price
- **Your Copy**: Your scaled bet amount
- **Time (UTC+8)**: Timestamp in UTC+8 timezone
- **Status**: Success/failure with order ID or error message

## Project Structure

```
polymarket-bot/
├── src/
│   ├── commands/
│   │   ├── handlers.ts      # Command logic (start/stop/status)
│   │   └── register.ts      # Slash command registration
│   ├── copyTrading/
│   │   └── session.ts       # Copy trading session manager
│   ├── format/
│   │   └── tradeMessage.ts  # Discord embed formatter (UTC+8)
│   ├── markets/
│   │   └── cache.ts         # Market metadata cache
│   ├── config.ts            # Environment config parser
│   └── index.ts             # Main bot entry point
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

## Important Notes

- **Polymarket Minimum Order**: $1 USDC. Orders below this will be automatically skipped.
- **Single Session**: Only one copy trading session can be active at a time.
- **WebSocket Connection**: The bot maintains a persistent WebSocket connection to Polymarket for real-time trade detection.
- **Market Cache**: Market metadata is cached to reduce API calls.
- **Graceful Shutdown**: The bot handles SIGINT/SIGTERM and stops active sessions before exiting.

## Security

- **Never commit `.env`** - it contains sensitive credentials
- Keep your `POLY_PRIVATE_KEY` secure - it controls your Polymarket wallet
- Start with dry run mode (`dryrun:true`) to test before live trading
- Use small amounts when testing live trades

## Troubleshooting

**Commands not showing up:**
- Make sure you ran `npm run register-commands`
- For instant updates, set `GUILD_ID` in `.env`
- Global commands can take up to 1 hour to propagate

**Bot not connecting:**
- Check `DISCORD_TOKEN` is correct
- Verify bot has proper permissions in your server
- Check console for error messages

**Trades not executing:**
- Verify `POLY_PRIVATE_KEY` is correct
- Ensure wallet has USDC balance
- Check if `dryrun` is set to `false` for live trading
- Verify the target wallet address is correct

**Polymarket SDK errors:**
- Make sure `@catalyst-team/poly-sdk` is properly installed
- Check that the local SDK path in `package.json` is correct
- Verify network connectivity to Polymarket APIs

## License

MIT
