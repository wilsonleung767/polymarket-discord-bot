import { ChatInputCommandInteraction, EmbedBuilder, ChannelType } from 'discord.js';
import type { CopyTradingSession } from '../copyTrading/session.js';
import { config } from '../config.js';

/**
 * Handle /start command
 */
export async function handleStartCommand(
  interaction: ChatInputCommandInteraction,
  session: CopyTradingSession
): Promise<void> {
  try {
    // Defer reply since we might take a moment to start the session
    await interaction.deferReply();

    // Get parameters
    const targetAddress = interaction.options.getString('target', true);
    const channelOption = interaction.options.getChannel('channel');
    const dryRun = interaction.options.getBoolean('dryrun') ?? true; // Default to dry run for safety
    const sizeScale = interaction.options.getNumber('sizescale') ?? config.trading.sizeScale;
    const maxSizePerTrade = interaction.options.getNumber('maxsize') ?? config.trading.maxSizePerTrade;
    const maxSlippage = interaction.options.getNumber('slippage') ?? config.trading.maxSlippage;
    const minTradeSize = interaction.options.getNumber('minsize') ?? config.trading.minTradeSize;
    const orderType = (interaction.options.getString('ordertype') as 'FOK' | 'FAK') ?? config.trading.orderType;
    const categoriesInput = interaction.options.getString('categories');
    
    // Parse and validate categories (comma-separated)
    let categories: string[] | undefined;
    if (categoriesInput) {
      categories = categoriesInput
        .split(',')
        .map(c => c.trim().toLowerCase())
        .filter(c => c.length > 0);
      
      // Deduplicate
      categories = [...new Set(categories)];
      
      if (categories.length === 0) {
        categories = undefined;
      }
    }

    // Validate address format
    if (!targetAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
      await interaction.editReply({
        content: '❌ Invalid wallet address format. Expected 0x followed by 40 hex characters.',
      });
      return;
    }

    // Determine channel - priority: command option > default from config > current channel
    let targetChannelId: string | null = null;
    
    if (channelOption) {
      // Use channel from command option
      targetChannelId = channelOption.id;
    } else if (config.discord.defaultChannelId) {
      // Use default channel from config
      targetChannelId = config.discord.defaultChannelId;
    } else if (interaction.channel) {
      // Fall back to current channel
      targetChannelId = interaction.channel.id;
    }
    
    if (!targetChannelId) {
      await interaction.editReply({
        content: '❌ No channel available. Please specify a channel or set DEFAULT_CHANNEL_ID in .env',
      });
      return;
    }
    
    // Verify the channel exists and is text-based
    try {
      const targetChannel = await interaction.client.channels.fetch(targetChannelId);
      if (!targetChannel?.isTextBased()) {
        await interaction.editReply({
          content: '❌ Invalid channel. Must be a text channel.',
        });
        return;
      }
    } catch (error) {
      await interaction.editReply({
        content: '❌ Failed to access the specified channel. Please check the channel ID.',
      });
      return;
    }

    // Validate numeric parameters
    if (sizeScale <= 0 || sizeScale > 1) {
      await interaction.editReply({
        content: '❌ Size scale must be between 0 and 1 (e.g., 0.1 for 10%).',
      });
      return;
    }

    if (maxSizePerTrade <= 0) {
      await interaction.editReply({
        content: '❌ Max size per trade must be positive.',
      });
      return;
    }

    // Start session
    await session.start({
      targetAddress: targetAddress.toLowerCase(),
      channelId: targetChannelId,
      startedByUserId: interaction.user.id,
      dryRun,
      sizeScale,
      maxSizePerTrade,
      maxSlippage,
      minTradeSize,
      orderType,
      categories,
    });

    // Send success message
    const embed = new EmbedBuilder()
      .setTitle('✅ Copy Trading Started')
      .setColor(dryRun ? 0x95a5a6 : 0x2ecc71)
      .addFields(
        { name: '👤 Target Trader', value: `\`${targetAddress}\``, inline: false },
        { name: '📢 Signal Channel', value: `<#${targetChannelId}>`, inline: true },
        { name: '🧪 Mode', value: dryRun ? 'Dry Run' : '**LIVE TRADING**', inline: true },
        { name: '📊 Size Scale', value: `${(sizeScale * 100).toFixed(1)}%`, inline: true },
        { name: '💰 Max Per Trade', value: `$${maxSizePerTrade}`, inline: true },
        { name: '📉 Max Slippage', value: `${(maxSlippage * 100).toFixed(1)}%`, inline: true },
        { name: '🎯 Min Trade Size', value: `$${minTradeSize}`, inline: true },
        { name: '📋 Order Type', value: orderType, inline: true },
        { name: '🏷️ Categories', value: categories && categories.length > 0 ? categories.join(', ') : 'All', inline: true },
        { name: '👷 Started By', value: `<@${interaction.user.id}>`, inline: true }
      )
      .setTimestamp();

    if (dryRun) {
      embed.setFooter({ text: '⚠️ Dry Run Mode - No real trades will be executed' });
    } else {
      embed.setFooter({ text: '⚡ LIVE MODE - Real trades will be executed!' });
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('Error in handleStartCommand:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await interaction.editReply({
      content: `❌ Failed to start copy trading: ${errorMessage}`,
    });
  }
}

/**
 * Handle /stop command
 */
export async function handleStopCommand(
  interaction: ChatInputCommandInteraction,
  session: CopyTradingSession
): Promise<void> {
  try {
    await interaction.deferReply();

    if (!session.isActive()) {
      await interaction.editReply({
        content: '⚠️ No active copy trading session to stop.',
      });
      return;
    }

    // Get stats before stopping
    const stats = session.getStats();
    const sessionState = session.getSession();

    // Stop the session
    await session.stop();

    // Send summary
    const embed = new EmbedBuilder()
      .setTitle('🛑 Copy Trading Stopped')
      .setColor(0xe74c3c)
      .addFields(
        { name: '👤 Target Trader', value: `\`${sessionState?.config.targetAddress || 'N/A'}\``, inline: false },
        { name: '📊 Trades Detected', value: stats?.tradesDetected.toString() || '0', inline: true },
        { name: '✅ Trades Executed', value: stats?.tradesExecuted.toString() || '0', inline: true },
        { name: '⏭️ Trades Skipped', value: stats?.tradesSkipped.toString() || '0', inline: true },
        { name: '❌ Trades Failed', value: stats?.tradesFailed.toString() || '0', inline: true },
        { name: '💰 Total USDC Spent', value: `$${stats?.totalUsdcSpent.toFixed(2) || '0.00'}`, inline: true },
        { name: '⏱️ Session Duration', value: sessionState ? formatDuration(Date.now() - sessionState.startTime) : 'N/A', inline: true },
        { name: '🛑 Stopped By', value: `<@${interaction.user.id}>`, inline: false }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('Error in handleStopCommand:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await interaction.editReply({
      content: `❌ Failed to stop copy trading: ${errorMessage}`,
    });
  }
}

/**
 * Handle /status command
 */
export async function handleStatusCommand(
  interaction: ChatInputCommandInteraction,
  session: CopyTradingSession
): Promise<void> {
  try {
    await interaction.deferReply();

    if (!session.isActive()) {
      await interaction.editReply({
        content: '⚠️ No active copy trading session.',
      });
      return;
    }

    const sessionState = session.getSession();
    const stats = session.getStats();

    if (!sessionState || !stats) {
      await interaction.editReply({
        content: '⚠️ Session state unavailable.',
      });
      return;
    }

    const { config: sessionConfig } = sessionState;
    const duration = Date.now() - sessionState.startTime;

    const embed = new EmbedBuilder()
      .setTitle('📊 Copy Trading Status')
      .setColor(sessionConfig.dryRun ? 0x95a5a6 : 0x3498db)
      .addFields(
        { name: '👤 Target Trader', value: `\`${sessionConfig.targetAddress}\``, inline: false },
        { name: '📢 Signal Channel', value: `<#${sessionConfig.channelId}>`, inline: true },
        { name: '🧪 Mode', value: sessionConfig.dryRun ? 'Dry Run' : '**LIVE TRADING**', inline: true },
        { name: '⏱️ Running Time', value: formatDuration(duration), inline: true },
        { name: '📊 Size Scale', value: `${(sessionConfig.sizeScale * 100).toFixed(1)}%`, inline: true },
        { name: '💰 Max Per Trade', value: `$${sessionConfig.maxSizePerTrade}`, inline: true },
        { name: '📋 Order Type', value: sessionConfig.orderType, inline: true },
        { name: '🏷️ Categories', value: sessionConfig.categories && sessionConfig.categories.length > 0 ? sessionConfig.categories.join(', ') : 'All', inline: true },
        { name: '📈 Detected', value: stats.tradesDetected.toString(), inline: true },
        { name: '✅ Executed', value: stats.tradesExecuted.toString(), inline: true },
        { name: '⏭️ Skipped', value: stats.tradesSkipped.toString(), inline: true },
        { name: '❌ Failed', value: stats.tradesFailed.toString(), inline: true },
        { name: '💰 Total Spent', value: `$${stats.totalUsdcSpent.toFixed(2)}`, inline: true },
        { name: '👷 Started By', value: `<@${sessionConfig.startedByUserId}>`, inline: true }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('Error in handleStatusCommand:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await interaction.editReply({
      content: `❌ Failed to get status: ${errorMessage}`,
    });
  }
}

/**
 * Format duration in human-readable format
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}
