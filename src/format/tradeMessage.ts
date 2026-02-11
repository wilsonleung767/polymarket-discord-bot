import { EmbedBuilder } from 'discord.js';
import type { SmartMoneyTrade, OrderResult } from '@catalyst-team/poly-sdk';

export interface TradeMessageData {
  trade: SmartMoneyTrade;
  result: OrderResult;
  marketName: string;
  marketSlug: string;
  eventSlug?: string; // Parent event slug for grouped markets
  leaderNotional: number;
  copyUsdcAmount: number;
  dryRun: boolean;
}

/**
 * Normalize timestamp to milliseconds
 * SmartMoneyTrade.timestamp from poly-sdk 0.5.0 is already in milliseconds,
 * but we normalize defensively in case a timestamp arrives in seconds.
 */
function normalizeTimestamp(timestamp: number): number {
  // If timestamp is in seconds (< 1e12), convert to milliseconds
  return timestamp < 1e12 ? timestamp * 1000 : timestamp;
}

/**
 * Format a copy trade event as a Discord embed
 */
export function formatTradeMessage(data: TradeMessageData): EmbedBuilder {
  const { trade, result, marketName, marketSlug, eventSlug, leaderNotional, copyUsdcAmount, dryRun } = data;

  // Determine color based on action (BUY/SELL)
  let color: number;
  if (dryRun) {
    color = 0x95a5a6; // Gray for dry run
  } else {
    color = trade.side === 'BUY' ? 0x2ecc71 : 0xe74c3c; // Green for buy, red for sell
  }
  // Ensure marketName is non-empty for Discord embed title
  const displayName = marketName || marketSlug || 'Unknown Market';

  // Build the embed
  const embed = new EmbedBuilder()
    .setTitle(`${dryRun ? '[DRY RUN] ' : ''}${displayName}`)
    .setColor(color)
    .setTimestamp(new Date(normalizeTimestamp(trade.timestamp)));

  // Add market link if slug is available
  // Use proper URL format: /event/<eventSlug>/<marketSlug> for grouped markets
  if (marketSlug) {
    let marketUrl: string;
    if (eventSlug && eventSlug !== marketSlug) {
      // Grouped market - include parent event slug
      marketUrl = `https://polymarket.com/event/${eventSlug}/${marketSlug}`;
    } else {
      // Standalone market
      marketUrl = `https://polymarket.com/event/${marketSlug}`;
    }
    embed.setURL(marketUrl);
  }

  // Add fields
  const traderDisplay = trade.traderName
    ? `[${trade.traderName}](https://polymarket.com/@${trade.traderName})`
    : `\`${trade.traderAddress.slice(0, 10)}...${trade.traderAddress.slice(-8)}\``;
  
  embed.addFields(
    {
      name: '👤 Trader',
      value: traderDisplay,
      inline: true,
    },
    {
      name: '📊 Action',
      value: `**${trade.side}** ${trade.outcome || 'N/A'}`,
      inline: true,
    },
    {
      name: '💰 Leader Bet',
      value: `$${leaderNotional.toFixed(2)}\n@ ${trade.price.toFixed(4)}`,
      inline: true,
    },
    {
      name: '💵 Copied Amount',
      value: `$${copyUsdcAmount.toFixed(2)}`,
      inline: true,
    },
    {
      name: result.success ? '✅ Status' : '❌ Status',
      value: result.success 
        ? (result.orderId ? `Success\nOrder: \`${result.orderId.slice(0, 16)}...\`` : 'Success')
        : (result.errorMsg || 'Failed'),
      inline: true,
    }
  );

  // Add footer with clickable transaction link
  if (dryRun) {
    embed.setFooter({ text: '🧪 Dry Run Mode - No real trades executed' });
  } else if (trade.txHash) {
    // Note: Discord footers don't support hyperlinks, so we add TX as a field instead
    embed.addFields({
      name: '🔗 Transaction',
      value: `[\`${trade.txHash.slice(0, 10)}...${trade.txHash.slice(-8)}\`](https://polygonscan.com/tx/${trade.txHash})`,
      inline: false,
    });
  }

  return embed;
}
