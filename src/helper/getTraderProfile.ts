import { DataApiClient } from "@catalyst-team/poly-sdk";

// Trader profile cache (address -> { userName, profileUrl })
interface TraderProfile {
  userName?: string;
  profileUrl?: string;
}
const traderProfileCache = new Map<string, TraderProfile>();

export async function resolveTraderProfile(
  dataApi: DataApiClient,
  address: string,
): Promise<TraderProfile> {
  const normalized = address.toLowerCase();

  // Check cache first
  if (traderProfileCache.has(normalized)) {
    return traderProfileCache.get(normalized)!;
  }

  // Fetch from API
  try {
    const result = await dataApi.fetchLeaderboard({
      user: normalized,
      limit: 1,
    });

    if (result.entries.length > 0) {
      const entry = result.entries[0];
      const userName = entry.userName;

      const profile: TraderProfile = {
        userName,
        profileUrl: userName
          ? `https://polymarket.com/@${userName}`
          : undefined,
      };

      traderProfileCache.set(normalized, profile);
      return profile;
    }
  } catch (error) {
    console.error(`[Trader Profile] Failed to fetch ${normalized}:`, error);
  }

  // Cache negative result (no username)
  const fallback: TraderProfile = {};
  traderProfileCache.set(normalized, fallback);
  return fallback;
}
