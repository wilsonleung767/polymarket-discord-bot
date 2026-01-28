import { EmbedBuilder } from 'discord.js';
import type { SmartMoneyTrade, OrderResult } from '@catalyst-team/poly-sdk';

export interface TradeMessageData {
  trade: SmartMoneyTrade;
  result: OrderResult;
  marketName: string;
  marketSlug: string;
  leaderNotional: number;
  copyUsdcAmount: number;
  dryRun: boolean;
}

/**
 * Convert Unix timestamp (seconds) to UTC+8 formatted string
 */
function toUtc8String(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  
  // Convert to UTC+8 (Singapore/Hong Kong time)
  const utc8Offset = 8 * 60; // 8 hours in minutes
  const utc8Date = new Date(date.getTime() + utc8Offset * 60 * 1000);
  
  // Format: YYYY-MM-DD HH:mm:ss
  const year = utc8Date.getUTCFullYear();
  const month = String(utc8Date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(utc8Date.getUTCDate()).padStart(2, '0');
  const hours = String(utc8Date.getUTCHours()).padStart(2, '0');
  const minutes = String(utc8Date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(utc8Date.getUTCSeconds()).padStart(2, '0');
  
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * Format a copy trade event as a Discord embed
 */
export function formatTradeMessage(data: TradeMessageData): EmbedBuilder {
  const { trade, result, marketName, marketSlug, leaderNotional, copyUsdcAmount, dryRun } = data;

  // Determine color based on success and dry run
  let color: number;
  if (dryRun) {
    color = 0x95a5a6; // Gray for dry run
  } else if (result.success) {
    color = trade.side === 'BUY' ? 0x2ecc71 : 0xe74c3c; // Green for buy, red for sell
  } else {
    color = 0xe67e22; // Orange for failed
  }

  // Format timestamp to UTC+8
  const timestampUtc8 = toUtc8String(trade.timestamp);

  // Build the embed
  const embed = new EmbedBuilder()
    .setTitle(`${dryRun ? '[DRY RUN] ' : ''}${marketName}`)
    .setColor(color)
    .setTimestamp(new Date(trade.timestamp * 1000));

  // Add market link if slug is available
  if (marketSlug) {
    embed.setURL(`https://polymarket.com/event/${marketSlug}`);
  }

  // Add fields
  embed.addFields(
    {
      name: '👤 Trader',
      value: trade.traderName 
        ? `${trade.traderName}\n\`${trade.traderAddress.slice(0, 10)}...${trade.traderAddress.slice(-8)}\``
        : `\`${trade.traderAddress}\``,
      inline: true,
    },
    {
      name: '📊 Action',
      value: `**${trade.side}** ${trade.outcome || 'N/A'}`,
      inline: true,
    },
    {
      name: '💰 Leader Bet',
      value: `$${leaderNotional.toFixed(2)} USDC\n@ ${trade.price.toFixed(4)}`,
      inline: true,
    },
    {
      name: '🤖 Your Copy',
      value: `$${copyUsdcAmount.toFixed(2)} USDC`,
      inline: true,
    },
    {
      name: '⏰ Time (UTC+8)',
      value: timestampUtc8,
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

  // Add footer
  if (dryRun) {
    embed.setFooter({ text: '🧪 Dry Run Mode - No real trades executed' });
  } else if (trade.txHash) {
    embed.setFooter({ 
      text: `TX: ${trade.txHash.slice(0, 10)}...${trade.txHash.slice(-8)}` 
    });
  }

  return embed;
}
