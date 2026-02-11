import type { GammaApiClient } from '@catalyst-team/poly-sdk';

interface MarketInfo {
  name: string;
  slug: string;
  eventSlug?: string; // Parent event slug for constructing correct Polymarket URLs
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
 * Fetch market data directly from Gamma API (raw response includes event info)
 */
async function fetchGammaMarketBySlug(marketSlug: string): Promise<any | null> {
  const url = `https://gamma-api.polymarket.com/markets?slug=${encodeURIComponent(marketSlug)}&limit=1`;
  
  try {
    const res = await fetch(url, { 
      headers: { accept: 'application/json' } 
    });

    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`Gamma markets fetch failed: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      return data[0];
    }
    return null;
  } catch (error) {
    console.error(`Failed to fetch Gamma market ${marketSlug}:`, error);
    return null;
  }
}

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
   * @param eventSlug - Primary slug to fetch (preferably eventSlug)
   * @param fallbackSlug - Fallback slug if name is empty (e.g., marketSlug)
   */
  async getMarketInfo(eventSlug: string, fallbackSlug?: string): Promise<MarketInfo> {
    // Check cache first
    const cacheKey = eventSlug || fallbackSlug || '';
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    let tags: string[] = [];
    let name = '';
    let slug = eventSlug || fallbackSlug || '';
    let parentEventSlug: string | undefined = undefined;
    
    // If we have a slug, fetch from Gamma API
    if (slug) {
      try {
        console.log(`🔍 [DEBUG] Fetching market info from Gamma API for slug: ${slug}`);
        
        // Try fetching as market slug first (raw API includes event info)
        const gammaMarket = await fetchGammaMarketBySlug(slug);
        if (gammaMarket) {
          console.log(`✅ [DEBUG] Found market: ${gammaMarket.question}`);
          
          // Extract parent event slug from events array
          if (gammaMarket.events && Array.isArray(gammaMarket.events) && gammaMarket.events.length > 0) {
            parentEventSlug = gammaMarket.events[0].slug;
            console.log(`✅ [DEBUG] Found parent event slug: ${parentEventSlug}`);
          }
          
          // Extract tags from market
          if (gammaMarket.tags) {
            tags = Array.isArray(gammaMarket.tags) ? gammaMarket.tags : [];
          }
          
          // Use market question as name
          name = gammaMarket.question || gammaMarket.slug || '';
          slug = gammaMarket.slug || slug;
          
          console.log(`✅ [DEBUG] Market tags: ${JSON.stringify(tags)}`);
          console.log(`✅ [DEBUG] Market name: ${name}`);
        } else {
          // Slug doesn't match a market, try as event
          console.log(`🔍 [DEBUG] No market found, trying as event slug: ${slug}`);
          const gammaEvent = await fetchGammaEventBySlug(slug);
          if (gammaEvent) {
            tags = (gammaEvent.tags ?? [])
              .map(t => t.slug)
              .filter((v): v is string => Boolean(v));
            
            name = gammaEvent.title ?? gammaEvent.slug ?? '';
            slug = gammaEvent.slug ?? slug;
            
            console.log(`✅ [DEBUG] Event tags: ${JSON.stringify(tags)}`);
            console.log(`✅ [DEBUG] Event name: ${name}`);
          } else {
            console.warn(`⚠️ [WARN] Gamma API returned null for slug: ${slug}`);
          }
        }
      } catch (error) {
        console.error(`❌ [ERROR] Failed to fetch from Gamma API for ${slug}:`, error);
      }
    }
    
    // If name is still empty, use fallback
    if (!name && fallbackSlug) {
      name = fallbackSlug;
      console.log(`📝 [DEBUG] Using fallback name: ${fallbackSlug}`);
    }
    
    const info: MarketInfo = {
      name,
      slug,
      eventSlug: parentEventSlug,
      tags,
    };
    
    // Cache it
    this.cache.set(cacheKey, info);
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
