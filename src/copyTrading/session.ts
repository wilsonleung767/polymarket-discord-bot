import type { PolymarketSDK, AutoCopyTradingSubscription, SmartMoneyTrade, OrderResult } from '@catalyst-team/poly-sdk';
import type { Client, TextChannel } from 'discord.js';
import { MarketCache } from '../markets/cache.js';
import { formatTradeMessage } from '../format/tradeMessage.js';

export interface SessionConfig {
  targetAddress: string;
  channelId: string;
  startedByUserId: string;
  dryRun: boolean;
  sizeScale: number;
  maxSizePerTrade: number;
  maxSlippage: number;
  minTradeSize: number;
  orderType: 'FOK' | 'FAK';
  categories?: string[];
}

export interface SessionState {
  config: SessionConfig;
  subscription: AutoCopyTradingSubscription;
  startTime: number;
}

/**
 * Global copy trading session manager
 * Only one active session allowed at a time
 */
export class CopyTradingSession {
  private sdk: PolymarketSDK;
  private discordClient: Client;
  private marketCache: MarketCache;
  private activeSession: SessionState | null = null;

  constructor(sdk: PolymarketSDK, discordClient: Client) {
    this.sdk = sdk;
    this.discordClient = discordClient;
    this.marketCache = new MarketCache(sdk);
  }

  /**
   * Check if a session is currently active
   */
  isActive(): boolean {
    return this.activeSession !== null;
  }

  /**
   * Get current session state
   */
  getSession(): SessionState | null {
    return this.activeSession;
  }

  /**
   * Start a new copy trading session
   */
  async start(config: SessionConfig): Promise<void> {
    // Stop existing session if any
    if (this.activeSession) {
      console.log('Stopping existing session before starting new one');
      await this.stop();
    }

    console.log(`Starting copy trading session for ${config.targetAddress}`);
    console.log(`Channel: ${config.channelId}, DryRun: ${config.dryRun}`);

    try {
      // Start auto copy trading
      const subscription = await this.sdk.smartMoney.startAutoCopyTrading({
        targetAddresses: [config.targetAddress],
        sizeScale: config.sizeScale,
        maxSizePerTrade: config.maxSizePerTrade,
        maxSlippage: config.maxSlippage,
        minTradeSize: config.minTradeSize,
        orderType: config.orderType,
        dryRun: config.dryRun,
        onTrade: async (trade: SmartMoneyTrade, result: OrderResult) => {
          console.log(`🎯 Trade detected from ${trade.traderAddress}: ${trade.side} ${trade.outcome} @ $${trade.price}`);
          await this.handleTrade(trade, result, config);
        },
        onError: (error: Error) => {
          console.error('❌ Copy trading error:', error.message);
          this.handleError(error, config.channelId);
        },
      });

      // Store session state
      this.activeSession = {
        config,
        subscription,
        startTime: Date.now(),
      };

      console.log(`Session started successfully. Tracking ${subscription.targetAddresses.length} address(es)`);
      console.log(`Target addresses: ${subscription.targetAddresses.join(', ')}`);
      console.log(`Listening for trades from: ${config.targetAddress}`);
      console.log(`Min trade size: $${config.minTradeSize}, Max per trade: $${config.maxSizePerTrade}`);
    } catch (error) {
      console.error('Failed to start copy trading session:', error);
      throw error;
    }
  }

  /**
   * Stop the active session
   */
  async stop(): Promise<void> {
    if (!this.activeSession) {
      console.log('No active session to stop');
      return;
    }

    console.log('Stopping copy trading session');
    
    try {
      this.activeSession.subscription.stop();
      this.activeSession = null;
      console.log('Session stopped successfully');
    } catch (error) {
      console.error('Error stopping session:', error);
      this.activeSession = null;
      throw error;
    }
  }

  /**
   * Handle a trade event
   */
  private async handleTrade(
    trade: SmartMoneyTrade,
    result: OrderResult,
    config: SessionConfig
  ): Promise<void> {
    try {
      // Fetch market info
      const marketInfo = await this.marketCache.getMarketInfo(trade.conditionId || '');

      // Filter by categories if specified
      if (config.categories && config.categories.length > 0) {
        const marketTags = marketInfo.tags.map(t => t.toLowerCase());
        const hasMatchingCategory = config.categories.some(cat => marketTags.includes(cat));
        
        if (!hasMatchingCategory) {
          console.log(`⏭️ Skipping trade - market tags [${marketInfo.tags.join(', ')}] don't match filter [${config.categories.join(', ')}]`);
          return;
        }
      }

      // Calculate amounts
      const leaderNotional = trade.size * trade.price;
      
      // Compute copy amount using same logic as SDK
      let copySize = trade.size * config.sizeScale;
      let copyValue = copySize * trade.price;
      
      // Enforce max size
      if (copyValue > config.maxSizePerTrade) {
        copySize = config.maxSizePerTrade / trade.price;
        copyValue = config.maxSizePerTrade;
      }

      const copyUsdcAmount = copyValue;

      // Format and send message
      const embed = formatTradeMessage({
        trade,
        result,
        marketName: marketInfo.name,
        marketSlug: marketInfo.slug,
        leaderNotional,
        copyUsdcAmount,
        dryRun: config.dryRun,
      });

      // Send to Discord channel
      const channel = await this.discordClient.channels.fetch(config.channelId);
      if (channel?.isTextBased()) {
        await (channel as TextChannel).send({ embeds: [embed] });
      }
    } catch (error) {
      console.error('Error handling trade:', error);
      // Don't throw - we don't want one trade error to stop the session
    }
  }

  /**
   * Handle an error from the SDK
   */
  private async handleError(error: Error, channelId: string): Promise<void> {
    console.error('Copy trading error:', error);

    try {
      const channel = await this.discordClient.channels.fetch(channelId);
      if (channel?.isTextBased()) {
        await (channel as TextChannel).send({
          content: `⚠️ **Copy Trading Error**: ${error.message}`,
        });
      }
    } catch (sendError) {
      console.error('Failed to send error message to Discord:', sendError);
    }
  }

  /**
   * Get statistics from active session
   */
  getStats() {
    if (!this.activeSession) {
      return null;
    }
    return this.activeSession.subscription.getStats();
  }
}
