/**
 * Market Metadata Resolver
 * 
 * Resolves tokenID, tickSize, and negRisk from Gamma + CLOB APIs by marketSlug + outcome.
 * Caches results to avoid redundant API calls.
 */

import type { GammaApiClient } from '@catalyst-team/poly-sdk';
import type { ClobClient } from '@polymarket/clob-client';

export interface MarketMetadata {
  tokenID: string;
  tickSize: string;
  negRisk: boolean;
  question: string;
  conditionId: string;
}

interface MarketCacheEntry {
  metadata: Map<string, MarketMetadata>; // outcome -> metadata
  timestamp: number;
}

/**
 * Market metadata resolver with caching
 */
export class MarketMetadataResolver {
  private cache: Map<string, MarketCacheEntry> = new Map();
  private gammaClient: GammaApiClient;
  private clobClient: ClobClient;
  private cacheLifetime: number = 5 * 60 * 1000; // 5 minutes

  constructor(gammaClient: GammaApiClient, clobClient: ClobClient, cacheLifetime?: number) {
    this.gammaClient = gammaClient;
    this.clobClient = clobClient;
    if (cacheLifetime !== undefined) {
      this.cacheLifetime = cacheLifetime;
    }
  }

  /**
   * Resolve market metadata for a given market slug and outcome
   */
  async resolve(marketSlug: string, outcome: string): Promise<MarketMetadata> {
    // Normalize outcome to uppercase
    const normalizedOutcome = outcome.toUpperCase();

    // Check cache first
    const cached = this.cache.get(marketSlug);
    if (cached && Date.now() - cached.timestamp < this.cacheLifetime) {
      const metadata = cached.metadata.get(normalizedOutcome);
      if (metadata) {
        console.log(`📦 Cache hit for ${marketSlug} / ${normalizedOutcome}`);
        return metadata;
      }
    }

    // Fetch from Gamma API to get basic market info and conditionId
    console.log(`🌐 Fetching market metadata for ${marketSlug}...`);
    const gammaMarket = await this.gammaClient.getMarketBySlug(marketSlug);

    if (!gammaMarket) {
      throw new Error(`Market not found: ${marketSlug}`);
    }

    // Fetch detailed market data from CLOB API using conditionId
    const clobMarket = await this.clobClient.getMarket(gammaMarket.conditionId);
    
    if (!clobMarket || !clobMarket.tokens) {
      throw new Error(`CLOB market data not found for condition ${gammaMarket.conditionId}`);
    }

    // Parse outcomes and build metadata map
    const metadataMap = new Map<string, MarketMetadata>();

    for (const token of clobMarket.tokens) {
      const tokenOutcome = token.outcome.toUpperCase();
      
      // Fetch tick size and negRisk for this token
      const tickSize = await this.clobClient.getTickSize(token.token_id);
      const negRisk = await this.clobClient.getNegRisk(token.token_id);
      
      metadataMap.set(tokenOutcome, {
        tokenID: token.token_id,
        tickSize: tickSize.toString(),
        negRisk,
        question: gammaMarket.question || marketSlug,
        conditionId: gammaMarket.conditionId,
      });
    }

    // Cache the results
    this.cache.set(marketSlug, {
      metadata: metadataMap,
      timestamp: Date.now(),
    });

    // Return requested outcome
    const metadata = metadataMap.get(normalizedOutcome);
    if (!metadata) {
      throw new Error(`Outcome "${outcome}" not found in market ${marketSlug}. Available: ${Array.from(metadataMap.keys()).join(', ')}`);
    }

    console.log(`✅ Resolved ${marketSlug} / ${normalizedOutcome} -> Token ${metadata.tokenID}`);
    return metadata;
  }

  /**
   * Clear cache (useful for testing or manual refresh)
   */
  clearCache(): void {
    this.cache.clear();
    console.log('🧹 Market metadata cache cleared');
  }

  /**
   * Get cache size (for monitoring)
   */
  getCacheSize(): number {
    return this.cache.size;
  }
}
