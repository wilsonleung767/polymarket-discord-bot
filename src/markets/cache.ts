import type { PolymarketSDK } from '@catalyst-team/poly-sdk';

interface MarketInfo {
  name: string;
  slug: string;
  tags: string[];
}

/**
 * Simple in-memory cache for market metadata
 * Reduces API calls when the same market is traded multiple times
 */
export class MarketCache {
  private cache: Map<string, MarketInfo> = new Map();
  private sdk: PolymarketSDK;

  constructor(sdk: PolymarketSDK) {
    this.sdk = sdk;
  }

  /**
   * Get market info by conditionId, with caching
   */
  async getMarketInfo(conditionId: string): Promise<MarketInfo> {
    // Check cache first
    const cached = this.cache.get(conditionId);
    if (cached) {
      return cached;
    }

    // Fetch from API
    try {
      const market = await this.sdk.markets.getMarket(conditionId);
      const info: MarketInfo = {
        name: market.question || market.question || 'Unknown Market',
        slug: market.slug || '',
        tags: (market as any).tags || [],
      };
      
      // Cache it
      this.cache.set(conditionId, info);
      return info;
    } catch (error) {
      console.error(`Failed to fetch market ${conditionId}:`, error);
      
      // Return fallback
      const fallback: MarketInfo = {
        name: `Market ${conditionId.slice(0, 10)}...`,
        slug: '',
        tags: [],
      };
      return fallback;
    }
  }

  /**
   * Clear cache (useful for testing or memory management)
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache size
   */
  size(): number {
    return this.cache.size;
  }
}
