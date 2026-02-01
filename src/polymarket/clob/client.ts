/**
 * CLOB Client Wrapper
 * 
 * Wraps @polymarket/clob-client with convenient order posting methods.
 * Handles API key creation/caching and order submission.
 */

import { ClobClient, OrderType, Side, ApiKeyCreds } from '@polymarket/clob-client';
import type { Wallet } from '@ethersproject/wallet';
import { Wallet as EthersWallet } from '@ethersproject/wallet'

export interface PlaceOrderParams {
  tokenID: string;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  tickSize: string;
  negRisk: boolean;
  orderType: 'FOK' | 'FAK' | 'GTC';
  /** For BUY + FOK/FAK orders: USDC amount to spend (used for market order sizing) */
  usdcAmount?: number;
}

export interface OrderResponse {
  success: boolean;
  orderId?: string;
  transactionHash?: string;
  error?: string;
  orderType?: string;
}

/**
 * Polymarket CLOB Client for order execution
 */
export class PolymarketClobClient {
  private client: ClobClient;
  private apiCreds: ApiKeyCreds | null = null;
  private signer: Wallet;
  private host: string;
  private chainId: number;
  private funderAddress: string;
  private signatureType: number;

  constructor(
    host: string,
    chainId: number,
    privateKey: string,
    funderAddress: string,
    signatureType: number
  ) {
    // Store config for re-instantiation
    this.host = host;
    this.chainId = chainId;
    this.funderAddress = funderAddress;
    this.signatureType = signatureType;
    
    // Create ethers v6 wallet first, then convert to v5 format for CLOB client
    const ethersV6Wallet = new EthersWallet(privateKey);
    
    // CLOB client expects ethers v5 Wallet - we'll pass the v6 wallet and let it handle compatibility
    this.signer = ethersV6Wallet as any as Wallet;
    
    this.client = new ClobClient(
      host,
      chainId,
      this.signer,
      undefined, // creds will be set later
      signatureType,
      funderAddress
    );
  }

  /**
   * Initialize API credentials (call once on startup)
   */
  async initialize(): Promise<void> {
    if (this.apiCreds) {
      console.log('CLOB client already initialized');
      return;
    }

    console.log('Creating/deriving CLOB API key...');
    this.apiCreds = await this.client.createOrDeriveApiKey();
    
    // Reinitialize client with credentials AND original config
    this.client = new ClobClient(
      this.host,
      this.chainId,
      this.signer,
      this.apiCreds,
      this.signatureType,
      this.funderAddress
    );
    
    console.log(`✅ CLOB API key initialized (key: ${this.apiCreds.key.slice(0, 8)}...)`);
  }

  /**
   * Place an order on the CLOB
   */
  async placeOrder(params: PlaceOrderParams): Promise<OrderResponse> {
    if (!this.apiCreds) {
      throw new Error('CLOB client not initialized. Call initialize() first.');
    }

    try {
      // Map order type
      const clobOrderType = this.mapOrderType(params.orderType);
      
      // Map side
      const side: Side = params.side === 'BUY' ? Side.BUY : Side.SELL;

      let signedOrder;
      
      // For FOK/FAK orders, use createMarketOrder to get proper rounding
      // For BUY: amount = USDC to spend (max 2 decimals), taker = shares (max 4 decimals)
      // For SELL: amount = shares to sell (max 2 decimals), taker = USDC (max 4 decimals)
      if (params.orderType === 'FOK' || params.orderType === 'FAK') {
        // Determine the amount based on side
        let amount: number;
        if (params.side === 'BUY' && params.usdcAmount !== undefined) {
          // For BUY, use USDC amount directly (spending-based)
          amount = params.usdcAmount;
          console.log(`📤 Placing ${params.orderType} market order: ${params.side} $${amount.toFixed(2)} USDC @ $${params.price.toFixed(4)}`);
        } else {
          // For SELL or if usdcAmount not provided, use size (share-based)
          amount = params.size;
          console.log(`📤 Placing ${params.orderType} market order: ${params.side} ${amount.toFixed(2)} shares @ $${params.price.toFixed(4)}`);
        }
        
        console.log(`   Token: ${params.tokenID}, TickSize: ${params.tickSize}, NegRisk: ${params.negRisk}`);

        const marketOrderArgs = {
          tokenID: params.tokenID,
          price: params.price,
          amount,
          side,
          feeRateBps: 0,
          
        };

        signedOrder = await this.client.createMarketOrder(marketOrderArgs, {
          tickSize: params.tickSize as "0.1" | "0.01" | "0.001" | "0.0001",
          negRisk: params.negRisk,
        });
      } else {
        // For GTC orders, use regular createOrder
        console.log(`📤 Placing ${params.orderType} order: ${params.side} ${params.size.toFixed(2)} @ $${params.price.toFixed(4)}`);
        console.log(`   Token: ${params.tokenID}, TickSize: ${params.tickSize}, NegRisk: ${params.negRisk}`);

        const orderArgs = {
          tokenID: params.tokenID,
          price: params.price,
          size: params.size,
          side,
          feeRateBps: 0,
          expiration: 0,
        };

        signedOrder = await this.client.createOrder(orderArgs);
      }
      
      const orderResponse = await this.client.postOrder(signedOrder, clobOrderType);

      // Check for errors - postOrder can return { error: ..., status: ... } on HTTP errors
      if (orderResponse.error) {
        const errorMsg = typeof orderResponse.error === 'string' 
          ? orderResponse.error 
          : JSON.stringify(orderResponse.error);
        console.error(`❌ Order placement failed (status ${orderResponse.status}): ${errorMsg}`);
        return {
          success: false,
          error: errorMsg,
          orderType: params.orderType,
        };
      }

      // Check if order was actually successful
      if (!orderResponse.success || !orderResponse.orderID) {
        const errorMsg = orderResponse.errorMsg || 'Unknown error - no orderID returned';
        console.error(`❌ Order placement failed: ${errorMsg}`);
        return {
          success: false,
          error: errorMsg,
          orderType: params.orderType,
        };
      }

      console.log(`✅ Order placed successfully: ${orderResponse.orderID}`);

      return {
        success: true,
        orderId: orderResponse.orderID,
        transactionHash: orderResponse.transactionsHashes?.[0],
        orderType: params.orderType,
      };
    } catch (error: any) {
      console.error(`❌ Order placement failed:`, error);
      
      return {
        success: false,
        error: error?.message || 'Unknown error',
        orderType: params.orderType,
      };
    }
  }

  /**
   * Map our order type to CLOB OrderType enum
   */
  private mapOrderType(type: 'FOK' | 'FAK' | 'GTC'): OrderType {
    switch (type) {
      case 'FOK':
        return OrderType.FOK;
      case 'FAK':
        return OrderType.FAK;
      case 'GTC':
        return OrderType.GTC;
      default:
        return OrderType.FOK;
    }
  }

  /**
   * Get signer address
   */
  getAddress(): string {
    return (this.signer as any).address;
  }
}
