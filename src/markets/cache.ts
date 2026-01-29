import type { GammaApiClient } from '@catalyst-team/poly-sdk';

interface MarketInfo {
  name: string;
  slug: string;
  tags: string[];
}

type GammaEventTag = {
  id?: string | number;
  label?: string;
  slug?: string;
};

type GammaEventResponse = {
  id?: string;
  slug?: string;
  title?: string;
  tags?: GammaEventTag[];
};

/**
 * Fetch event data directly from Gamma API
 */
async function fetchGammaEventBySlug(eventSlug: string): Promise<GammaEventResponse | null> {
  const url = `https://gamma-api.polymarket.com/events/slug/${encodeURIComponent(eventSlug)}`;
  
  try {
    const res = await fetch(url, { 
      headers: { accept: 'application/json' } 
    });

    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`Gamma events fetch failed: ${res.status} ${res.statusText}`);
    }

    return (await res.json()) as GammaEventResponse;
  } catch (error) {
    console.error(`Failed to fetch Gamma event ${eventSlug}:`, error);
    return null;
  }
}

/**
 * Simple in-memory cache for market metadata
 * Fetches tags from Gamma API for category filtering
 */
export class MarketCache {
  private cache: Map<string, MarketInfo> = new Map();
  private gammaApiClient: GammaApiClient;

  constructor(gammaApiClient: GammaApiClient) {
    this.gammaApiClient = gammaApiClient;
  }

  /**
   * Get market info by event slug, with caching
   * Fetches tags from Gamma API for accurate category filtering
   */
  async getMarketInfo(marketSlug: string): Promise<MarketInfo> {
    // Check cache first
    const cached = this.cache.get(marketSlug);
    if (cached) {
      return cached;
    }

    let tags: string[] = [];
    let name = '';
    let slug = marketSlug;
    
    // If we have a slug, fetch from Gamma API to get tags and name
    if (marketSlug) {
      try {
        console.log(`🔍 [DEBUG] Fetching market tags from Gamma API for marketSlug: ${marketSlug}`);
        const gammaEvent = await fetchGammaEventBySlug(marketSlug);
        if (gammaEvent) {
          // Extract tag slugs (e.g. "league-of-legends", "esports")
          tags = (gammaEvent.tags ?? [])
            .map(t => t.slug)
            .filter((v): v is string => Boolean(v));
          
          name = gammaEvent.title ?? gammaEvent.slug ?? '';
          slug = gammaEvent.slug ?? marketSlug;
          
          console.log(`✅ [DEBUG] Fetched tags: ${JSON.stringify(tags)}`);
          console.log(`✅ [DEBUG] Fetched name: ${name}`);
        } else {
          console.warn(`⚠️ [WARN] Gamma API returned null for marketSlug: ${marketSlug}`);
        }
      } catch (error) {
        console.error(`❌ [ERROR] Failed to fetch tags from Gamma API for ${marketSlug}:`, error);
      }
    }
    
    const info: MarketInfo = {
      name,
      slug,
      tags,
    };
    
    // Cache it
    this.cache.set(marketSlug, info);
    return info;
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
