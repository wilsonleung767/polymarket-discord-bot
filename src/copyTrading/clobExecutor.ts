/**
 * CLOB Order Executor
 * 
 * Translates incoming trade signals into CLOB orders.
 * Handles sizing, slippage, and order type mapping.
 */

import type { ActivityTrade } from '@catalyst-team/poly-sdk';
import { PolymarketClobClient, type PlaceOrderParams, type OrderResponse } from '../polymarket/clob/client.js';
import { MarketMetadataResolver } from '../polymarket/markets.js';

export interface CopyTradingConfig {
  sizeScale: number;
  maxSizePerTrade: number;
  minTradeSize: number;
  maxSlippage: number;
  orderType: 'FOK' | 'FAK' | 'GTC';
}

export interface ExecutionResult {
  success: boolean;
  copyUsdcAmount: number;
  orderResponse?: OrderResponse;
  error?: string;
}

/**
 * Executes copy trades using CLOB orders
 */
export class ClobExecutor {
  private clobClient: PolymarketClobClient;
  private marketResolver: MarketMetadataResolver;

  constructor(clobClient: PolymarketClobClient, marketResolver: MarketMetadataResolver) {
    this.clobClient = clobClient;
    this.marketResolver = marketResolver;
  }

  /**
   * Execute a copy trade from an incoming trade signal
   */
  async execute(
    trade: ActivityTrade,
    config: CopyTradingConfig
  ): Promise<ExecutionResult> {
    try {
      // Calculate copy amount using size scale
      const leaderNotional = trade.size * trade.price;
      let copyUsdcAmount = leaderNotional * config.sizeScale;

      // Enforce max size per trade
      if (copyUsdcAmount > config.maxSizePerTrade) {
        copyUsdcAmount = config.maxSizePerTrade;
      }

      // Check min trade size
      if (copyUsdcAmount < config.minTradeSize) {
        console.log(`⏭️  Trade too small: $${copyUsdcAmount.toFixed(2)} < $${config.minTradeSize}`);
        return {
          success: false,
          copyUsdcAmount,
          error: `Trade size $${copyUsdcAmount.toFixed(2)} below minimum $${config.minTradeSize}`,
        };
      }

      // Resolve market metadata (tokenID, tickSize, negRisk)
      const metadata = await this.marketResolver.resolve(trade.marketSlug, trade.outcome);

      // Calculate size based on original price (for display and fallback)
      let size = copyUsdcAmount / trade.price;

      // Apply slippage adjustment to price
      let adjustedPrice = trade.price;
      if (trade.side === 'BUY') {
        // For BUY orders, increase price to allow for slippage
        adjustedPrice = trade.price * (1 + config.maxSlippage);
      } else {
        // For SELL orders, decrease price to allow for slippage
        adjustedPrice = trade.price * (1 - config.maxSlippage);
      }

      // Round price to tick size
      const tickSize = parseFloat(metadata.tickSize);
      adjustedPrice = Math.round(adjustedPrice / tickSize) * tickSize;

      // Ensure price is within valid range [0.01, 0.99]
      adjustedPrice = Math.max(0.01, Math.min(0.99, adjustedPrice));

      // Round size to 2 decimal places (for display and SELL/GTC orders)
      size = Math.round(size * 100) / 100;

      // For FOK/FAK BUY orders, we'll pass usdcAmount directly to use market order sizing
      // For SELL or GTC orders, we'll use size
      const isFokFakBuy = (config.orderType === 'FOK' || config.orderType === 'FAK') && trade.side === 'BUY';

      if (isFokFakBuy) {
        console.log(`💱 Copy trade: ${trade.side} $${copyUsdcAmount.toFixed(2)} USDC @ $${adjustedPrice.toFixed(4)} (leader: $${trade.price.toFixed(4)})`);
        console.log(`   Expected shares: ~${(copyUsdcAmount / adjustedPrice).toFixed(4)}`);
      } else {
        console.log(`💱 Copy trade: ${trade.side} ${size.toFixed(2)} shares @ $${adjustedPrice.toFixed(4)} (leader: $${trade.price.toFixed(4)})`);
        console.log(`   USDC amount: $${(size * adjustedPrice).toFixed(2)} (leader: $${(trade.size * trade.price).toFixed(2)})`);
      }
      // Place order on CLOB
      const orderParams: PlaceOrderParams = {
        tokenID: metadata.tokenID,
        side: trade.side,
        price: adjustedPrice,
        size,
        tickSize: metadata.tickSize,
        negRisk: metadata.negRisk,
        orderType: config.orderType,
        // For FOK/FAK BUY orders, pass USDC amount for proper market order sizing
        usdcAmount: isFokFakBuy ? copyUsdcAmount : undefined,
      };

      const orderResponse = await this.clobClient.placeOrder(orderParams);

      return {
        success: orderResponse.success,
        copyUsdcAmount,
        orderResponse,
        error: orderResponse.error,
      };
    } catch (error: any) {
      console.error(`❌ Execution error:`, error);
      return {
        success: false,
        copyUsdcAmount: 0,
        error: error?.message || 'Unknown execution error',
      };
    }
  }
}
