import type {
  RealtimeServiceV2,
  DataApiClient,
  GammaApiClient,
  ActivityTrade,
} from "@catalyst-team/poly-sdk";
import type { Client, TextChannel } from "discord.js";
import { ClobClient } from "@polymarket/clob-client";
import { MarketCache } from "../markets/cache.js";
import { formatTradeMessage } from "../format/tradeMessage.js";
import { PolymarketClobClient } from "../polymarket/clob/client.js";
import { MarketMetadataResolver } from "../polymarket/markets.js";
import { ClobExecutor, type CopyTradingConfig } from "./clobExecutor.js";
import { config as appConfig } from "../config.js";

export interface SessionConfig {
  targetAddress: string;
  channelId: string;
  startedByUserId: string;
  dryRun: boolean;
  sizeScale: number;
  maxSizePerTrade: number;
  maxSlippage: number;
  minTradeSize: number;
  orderType: "FOK" | "FAK";
  categories?: string[];
  totalLimit?: number;
  maxOdds?: number; // Max odds (price) for BUY trades only
  maxTotalPerMarket?: number; // Max total USDC per market (BUY trades only)
}

export interface SessionState {
  config: SessionConfig;
  subscription: { unsubscribe: () => void };
  startTime: number;
  cumulativeSpent: number;
  spentByMarket: Map<string, number>; // Track USDC spent per market slug (for BUY trades)
  skippedCount: number; // Track number of trades skipped due to filters
}

/**
 * Global copy trading session manager
 * Only one active session allowed at a time
 */
export class CopyTradingSession {
  private realtimeService: RealtimeServiceV2;
  private dataApiClient: DataApiClient;
  private gammaApiClient: GammaApiClient;
  private discordClient: Client;
  private marketCache: MarketCache;
  private clobClient: PolymarketClobClient;
  private marketResolver: MarketMetadataResolver;
  private clobExecutor: ClobExecutor;
  private activeSession: SessionState | null = null;
  private seenTransactions: Set<string> = new Set();

  constructor(
    realtimeService: RealtimeServiceV2,
    dataApiClient: DataApiClient,
    gammaApiClient: GammaApiClient,
    discordClient: Client,
    clobClient: PolymarketClobClient,
  ) {
    this.realtimeService = realtimeService;
    this.dataApiClient = dataApiClient;
    this.gammaApiClient = gammaApiClient;
    this.discordClient = discordClient;
    this.marketCache = new MarketCache(gammaApiClient);
    this.clobClient = clobClient;

    // Initialize CLOB client with raw ClobClient for metadata resolver
    const rawClobClient = new ClobClient(
      appConfig.polymarket.clobHost,
      137, // Polygon mainnet
      undefined, // No signer needed for read-only ops
      undefined,
      undefined,
      undefined,
    );

    this.marketResolver = new MarketMetadataResolver(
      gammaApiClient,
      rawClobClient,
    );
    this.clobExecutor = new ClobExecutor(clobClient, this.marketResolver);
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
   * Check if transaction hash has been seen (deduplication)
   */
  private isSeenTransaction(txHash: string): boolean {
    if (this.seenTransactions.has(txHash)) {
      return true;
    }
    this.seenTransactions.add(txHash);

    // Keep only last 2000 transactions
    if (this.seenTransactions.size > 2000) {
      const firstItem = this.seenTransactions.values().next().value;
      if (firstItem) {
        this.seenTransactions.delete(firstItem);
      }
    }

    return false;
  }

  /**
   * Start a new copy trading session
   */
  async start(config: SessionConfig): Promise<void> {
    // Stop existing session if any
    if (this.activeSession) {
      console.log("Stopping existing session before starting new one");
      await this.stop();
    }

    console.log(`Starting copy trading session for ${config.targetAddress}`);
    console.log(`Channel: ${config.channelId}, DryRun: ${config.dryRun}`);

    try {
      // Add delay to ensure WebSocket connection is fully registered on Polymarket's backend
      console.log(
        "⏳ Waiting 1 second for WebSocket connection to stabilize...",
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Subscribe to all activity and filter by target address
      const targetAddress = config.targetAddress.toLowerCase();

      const subscription = this.realtimeService.subscribeAllActivity({
        onTrade: async (trade: ActivityTrade) => {
          // Filter by target address
          const traderAddress = trade.trader?.address?.toLowerCase();
          if (!traderAddress || traderAddress !== targetAddress) {
            return;
          }

          // Deduplicate by transaction hash
          if (this.isSeenTransaction(trade.transactionHash)) {
            return;
          }

          console.log(
            `🎯 Trade detected from ${traderAddress}: ${trade.side} ${trade.outcome} @ $${trade.price}`,
          );
          await this.handleTrade(trade, config);
        },
        onError: (error: Error) => {
          console.error("❌ Copy trading error:", error.message);
          this.handleError(error, config.channelId);
        },
      });

      // Store session state
      this.activeSession = {
        config,
        subscription,
        startTime: Date.now(),
        cumulativeSpent: 0,
        spentByMarket: new Map<string, number>(),
        skippedCount: 0,
      };

      console.log(
        `Session started successfully. Tracking: ${config.targetAddress}`,
      );
      console.log(
        `Min trade size: $${config.minTradeSize}, Max per trade: $${config.maxSizePerTrade}`,
      );
    } catch (error) {
      console.error("Failed to start copy trading session:", error);
      throw error;
    }
  }

  /**
   * Stop the active session
   */
  async stop(): Promise<void> {
    if (!this.activeSession) {
      console.log("No active session to stop");
      return;
    }

    console.log("Stopping copy trading session");

    try {
      this.activeSession.subscription.unsubscribe();
      this.activeSession = null;
      this.seenTransactions.clear();
      console.log("Session stopped successfully");
    } catch (error) {
      console.error("Error stopping session:", error);
      this.activeSession = null;
      throw error;
    }
  }

  /**
   * Handle a trade event
   */
  private async handleTrade(
    trade: ActivityTrade,
    config: SessionConfig,
  ): Promise<void> {
    try {
      // Check max odds limit for BUY trades
      if (
        config.maxOdds !== undefined &&
        trade.side === "BUY" &&
        trade.price > config.maxOdds
      ) {
        console.log(
          `⏭️ Skipping BUY trade - price ${trade.price} exceeds max odds ${config.maxOdds}`,
        );

        // Increment skip counter
        if (this.activeSession) {
          this.activeSession.skippedCount++;
        }

        // Optionally send a small notification to the channel
        try {
          const channel = await this.discordClient.channels.fetch(
            config.channelId,
          );
          if (channel?.isTextBased()) {
            await (channel as TextChannel).send({
              content:
                `⏭️ **Trade Skipped (Max Odds Exceeded)**\n` +
                `BUY ${trade.outcome} @ $${trade.price.toFixed(2)} > max $${config.maxOdds.toFixed(2)}\n` +
                `Target: \`${config.targetAddress.slice(0, 8)}...\``,
            });
          }
        } catch (notifyError) {
          console.error(
            "Failed to send max odds skip notification:",
            notifyError,
          );
        }

        return;
      }

      // Fetch market info (using eventSlug from trade object, fallback to marketSlug)
      const slugToFetch = trade?.eventSlug || trade?.marketSlug || "";
      const marketInfo = await this.marketCache.getMarketInfo(
        slugToFetch,
        trade?.marketSlug ?? "",
      );

      // Filter by categories if specified
      if (config.categories && config.categories.length > 0) {
        console.log(
          `🔍 [DEBUG] Categories filter active: ${JSON.stringify(config.categories)}`,
        );
        const marketTags = marketInfo.tags.map((t) => t.toLowerCase());
        console.log(
          `🏷️ [DEBUG] Market tags (lowercase): ${JSON.stringify(marketTags)}`,
        );
        const hasMatchingCategory = config.categories.some((cat) =>
          marketTags.includes(cat),
        );
        console.log(`✅ [DEBUG] Has matching category: ${hasMatchingCategory}`);

        if (!hasMatchingCategory) {
          console.log(
            `⏭️ Skipping trade - market tags [${marketInfo.tags.join(", ")}] don't match filter [${config.categories.join(", ")}]`,
          );
          
          // Increment skip counter
          if (this.activeSession) {
            this.activeSession.skippedCount++;
          }
          
          return;
        }
      }

      // Calculate amounts
      const leaderNotional = trade.size * trade.price;

      // Pre-compute planned copy USDC amount
      let plannedCopyUsdcAmount = leaderNotional * config.sizeScale;
      if (plannedCopyUsdcAmount > config.maxSizePerTrade) {
        plannedCopyUsdcAmount = config.maxSizePerTrade;
      }

      // Check per-market limit for BUY trades
      if (
        config.maxTotalPerMarket !== undefined &&
        trade.side === "BUY" &&
        this.activeSession
      ) {
        const currentMarketSpent =
          this.activeSession.spentByMarket.get(marketInfo.slug) ?? 0;
        const projectedMarketTotal = currentMarketSpent + plannedCopyUsdcAmount;

        if (projectedMarketTotal > config.maxTotalPerMarket) {
          console.log(
            `⏭️ Skipping BUY trade - market cap reached for ${marketInfo.slug}`,
          );
          console.log(
            `   Current: $${currentMarketSpent.toFixed(2)}, Planned: $${plannedCopyUsdcAmount.toFixed(2)}, Cap: $${config.maxTotalPerMarket}`,
          );

          // Increment skip counter
          if (this.activeSession) {
            this.activeSession.skippedCount++;
          }

          // Send notification to channel
          try {
            const channel = await this.discordClient.channels.fetch(
              config.channelId,
            );
            if (channel?.isTextBased()) {
              await (channel as TextChannel).send({
                content:
                  `⏭️ **Trade Skipped (Market Cap Reached)**\n` +
                  `Market: ${marketInfo.name}\n` +
                  `Current spent: $${currentMarketSpent.toFixed(2)}\n` +
                  `Trade amount: $${plannedCopyUsdcAmount.toFixed(2)}\n` +
                  `Market cap: $${config.maxTotalPerMarket}`,
              });
            }
          } catch (notifyError) {
            console.error(
              "Failed to send market cap skip notification:",
              notifyError,
            );
          }

          return;
        }
      }

      // Build copy trading config
      const copyConfig: CopyTradingConfig = {
        sizeScale: config.sizeScale,
        maxSizePerTrade: config.maxSizePerTrade,
        minTradeSize: config.minTradeSize,
        maxSlippage: config.maxSlippage,
        orderType: config.orderType,
      };

      // Execute copy trade (or skip in dry run mode)
      let executionResult;
      if (config.dryRun) {
        // In dry run, calculate copy amount but don't execute
        let copyUsdcAmount = leaderNotional * config.sizeScale;
        if (copyUsdcAmount > config.maxSizePerTrade) {
          copyUsdcAmount = config.maxSizePerTrade;
        }

        executionResult = {
          success: true,
          copyUsdcAmount,
        };
      } else {
        // Execute real trade
        executionResult = await this.clobExecutor.execute(trade, copyConfig);
      }

      const copyUsdcAmount = executionResult.copyUsdcAmount;

      // Check total limit before tracking spending
      if (config.totalLimit && this.activeSession) {
        const newTotal = this.activeSession.cumulativeSpent + copyUsdcAmount;

        if (newTotal > config.totalLimit) {
          console.log(
            `🛑 Total limit reached: $${this.activeSession.cumulativeSpent.toFixed(2)} + $${copyUsdcAmount.toFixed(2)} = $${newTotal.toFixed(2)} > $${config.totalLimit}`,
          );

          // Send limit reached notification
          const channel = await this.discordClient.channels.fetch(
            config.channelId,
          );
          if (channel?.isTextBased()) {
            await (channel as TextChannel).send({
              content: `🛑 **Total Limit Reached!**\n\nSession stopped automatically.\nTotal spent: $${this.activeSession.cumulativeSpent.toFixed(2)}\nLimit: $${config.totalLimit}\n\nUse \`/start\` to begin a new session.`,
            });
          }

          // Stop the session
          await this.stop();
          return;
        }

        // Update cumulative spending (even in dry run for tracking)
        this.activeSession.cumulativeSpent += copyUsdcAmount;

        // Update per-market spending for BUY trades
        if (trade.side === "BUY") {
          const currentMarketSpent =
            this.activeSession.spentByMarket.get(marketInfo.slug) ?? 0;
          this.activeSession.spentByMarket.set(
            marketInfo.slug,
            currentMarketSpent + copyUsdcAmount,
          );
          console.log(
            `📊 Market spending updated for ${marketInfo.slug}: $${(currentMarketSpent + copyUsdcAmount).toFixed(2)}`,
          );
        }
      }

      // Format result for Discord embed (adapt to old format)
      const adaptedResult = {
        success: executionResult.success,
        orderId: executionResult.orderResponse?.orderId,
        errorMsg: executionResult.error,
      };

      // Convert ActivityTrade to SmartMoneyTrade format for formatting
      const adaptedTrade = {
        traderAddress: trade.trader?.address || "",
        traderName: trade.trader?.name,
        side: trade.side,
        outcome: trade.outcome,
        price: trade.price,
        size: trade.size,
        timestamp: Math.floor(trade.timestamp / 1000), // Convert to seconds
        txHash: trade.transactionHash,
        marketSlug: trade.marketSlug,
      };

      // Format and send message
      const embed = formatTradeMessage({
        trade: adaptedTrade as any,
        result: adaptedResult as any,
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
      console.error("Error handling trade:", error);
      // Don't throw - we don't want one trade error to stop the session
    }
  }

  /**
   * Handle an error from the SDK
   */
  private async handleError(error: Error, channelId: string): Promise<void> {
    console.error("Copy trading error:", error);

    try {
      const channel = await this.discordClient.channels.fetch(channelId);
      if (channel?.isTextBased()) {
        await (channel as TextChannel).send({
          content: `⚠️ **Copy Trading Error**: ${error.message}`,
        });
      }
    } catch (sendError) {
      console.error("Failed to send error message to Discord:", sendError);
    }
  }

  /**
   * Get statistics from active session
   */
  getStats() {
    if (!this.activeSession) {
      return null;
    }

    // Convert Map to array for JSON serialization
    const spentByMarket = Array.from(
      this.activeSession.spentByMarket.entries(),
    ).map(([market, spent]) => ({ market, spent }));

    // Return basic session stats (without SDK getStats method)
    return {
      startTime: this.activeSession.startTime,
      targetAddress: this.activeSession.config.targetAddress,
      cumulativeSpent: this.activeSession.cumulativeSpent,
      dryRun: this.activeSession.config.dryRun,
      skippedCount: this.activeSession.skippedCount,
      spentByMarket,
    };
  }
}
