import type { PolymarketSDK,  GammaApiClient } from '@catalyst-team/poly-sdk';

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
  private gammaApiClient: GammaApiClient;

  constructor(sdk: PolymarketSDK, gammaApiClient: GammaApiClient) {
    this.sdk = sdk;
    this.gammaApiClient = gammaApiClient;
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
      // First get basic market info (has slug but no tags)
      const market = await this.sdk.markets.getMarket(conditionId);
      const slug = market.slug || '';
      const name = market.question || 'Unknown Market';
      
      let tags: string[] = [];
      
      // If we have a slug, fetch from Gamma API to get tags
      if (slug) {
        try {
          const gammaMarket = await this.gammaApiClient.getMarketBySlug(slug);
          tags = gammaMarket?.tags || [];
        } catch (gammaError) {
          console.warn(`Failed to fetch tags from Gamma for ${slug}:`, gammaError);
        }
      }
      
      const info: MarketInfo = {
        name,
        slug,
        tags,
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
