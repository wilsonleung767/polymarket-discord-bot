import type {
  DataApiClient,
  GammaApiClient,
  SmartMoneyTrade,
  SmartMoneyService,
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
  skippedCount?: number;
}

/**
 * Global copy trading session manager
 * Only one active session allowed at a time
 */
export class CopyTradingSession {
  private smartMoneyService: SmartMoneyService;
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
    smartMoneyService: SmartMoneyService,
    dataApiClient: DataApiClient,
    gammaApiClient: GammaApiClient,
    discordClient: Client,
    clobClient: PolymarketClobClient,
  ) {
    this.smartMoneyService = smartMoneyService;
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
      // Subscribe to smart money trades using Data API polling
      const targetAddress = config.targetAddress.toLowerCase();

      console.log(
        `📡 Starting Data API polling for ${targetAddress}...`,
      );

      const subscription = this.smartMoneyService.subscribeSmartMoneyTrades(
        async (trade: SmartMoneyTrade) => {
          // Filter by target address
          const traderAddress = trade.traderAddress?.toLowerCase();
          if (!traderAddress || traderAddress !== targetAddress) {
            return;
          }

          // Deduplicate by transaction hash
          if (trade.txHash && this.isSeenTransaction(trade.txHash)) {
            return;
          }

          console.log(
            `🎯 Trade detected from ${traderAddress}: ${trade.side} ${trade.outcome} @ $${trade.price}`,
          );
          await this.handleTrade(trade, config);
        },
        { 
          filterAddresses: [targetAddress],
          smartMoneyOnly: false // Track all trades from target, not just smart money
        }
      );

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
   * Increment skip counter
   */
  private incrementSkipped(): void {
    if (this.activeSession) {
      this.activeSession.skippedCount = (this.activeSession.skippedCount ?? 0) + 1;
    }
  }

  /**
   * Handle a trade event
   */
  private async handleTrade(
    trade: SmartMoneyTrade,
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
        this.incrementSkipped();

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

      // Fetch market info (using marketSlug from trade)
      const slugToFetch = trade?.marketSlug || trade?.conditionId || "";
      const marketInfo = await this.marketCache.getMarketInfo(
        slugToFetch,
        trade?.conditionId ?? "",
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
          this.incrementSkipped();
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

      // Check minimum trade size BEFORE execution
      if (plannedCopyUsdcAmount < config.minTradeSize) {
        console.log(
          `⏭️ Skipping trade - amount $${plannedCopyUsdcAmount.toFixed(2)} < min $${config.minTradeSize}`,
        );
        this.incrementSkipped();
        return;
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
          this.incrementSkipped();

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
        // We already know it passes minTradeSize check above
        executionResult = {
          success: true,
          copyUsdcAmount: plannedCopyUsdcAmount,
        };
      } else {
        // Execute real trade
        executionResult = await this.clobExecutor.execute(trade, copyConfig);
      }

      const copyUsdcAmount = executionResult.copyUsdcAmount;

      // Check if execution failed due to "too small" (defensive - should be caught by pre-check)
      if (!executionResult.success && executionResult.error) {
        const isTooSmall = /too small|below minimum/i.test(executionResult.error);
        if (isTooSmall) {
          console.log(`⏭️ Trade rejected as too small: ${executionResult.error}`);
          this.incrementSkipped();
          // Don't count this in spending, just notify user
          const adaptedResult = {
            success: false,
            orderId: undefined,
            errorMsg: executionResult.error,
          };
          const embed = formatTradeMessage({
            trade: trade,
            result: adaptedResult as any,
            marketName: marketInfo.name,
            marketSlug: marketInfo.slug,
            eventSlug: marketInfo.eventSlug,
            leaderNotional,
            copyUsdcAmount,
            dryRun: config.dryRun,
          });
          const channel = await this.discordClient.channels.fetch(config.channelId);
          if (channel?.isTextBased()) {
            await (channel as TextChannel).send({ embeds: [embed] });
          }
          return;
        }
      }

      // Determine if this trade should count toward spending
      // Only count successful BUY orders (or dry-run simulated BUY orders)
      const shouldTrackSpending = 
        (config.dryRun || executionResult.success) && 
        trade.side === "BUY";

      // Track spending and check limits (always track, not just when totalLimit is set)
      if (this.activeSession && shouldTrackSpending) {
        // Check total limit BEFORE adding to cumulative
        if (config.totalLimit) {
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
        }

        // Update cumulative spending
        this.activeSession.cumulativeSpent += copyUsdcAmount;

        // Update per-market spending
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

      // Format result for Discord embed (adapt to old format)
      const adaptedResult = {
        success: executionResult.success,
        orderId: executionResult.orderResponse?.orderId,
        errorMsg: executionResult.error,
      };

      // Format and send message
      const embed = formatTradeMessage({
        trade: trade,
        result: adaptedResult as any,
        marketName: marketInfo.name,
        marketSlug: marketInfo.slug,
        eventSlug: marketInfo.eventSlug,
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

    // Build spend by market array for display
    const spentByMarket = Array.from(this.activeSession.spentByMarket.entries()).map(
      ([market, spent]) => ({ market, spent })
    );

    // Return session stats
    return {
      startTime: this.activeSession.startTime,
      targetAddress: this.activeSession.config.targetAddress,
      cumulativeSpent: this.activeSession.cumulativeSpent,
      dryRun: this.activeSession.config.dryRun,
      spentByMarket,
      skippedCount: this.activeSession.skippedCount || 0,
    };
  }
}
