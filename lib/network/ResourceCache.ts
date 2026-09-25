import AsyncStorage from "@react-native-async-storage/async-storage";
import { NetworkManager } from "@/lib/network/NetworkManager";

export interface CacheEntry<T = any> {
  data: T;
  timestamp: number;
  ttlMs: number;
}

export interface CacheQueryResult<T = any> {
  data: T | null;
  isFresh: boolean;
  ageMs: number;
}

const STORAGE_PREFIX = "@hrms_resource_cache_v1_";

class ResourceCacheClass {
  private memoryCache = new Map<string, CacheEntry>();

  /**
   * Get cached data and check freshness against its TTL.
   */
  public get<T>(key: string, customTtlMs?: number): CacheQueryResult<T> {
    const entry = this.memoryCache.get(key) as CacheEntry<T> | undefined;
    if (!entry) {
      return { data: null, isFresh: false, ageMs: Infinity };
    }

    const ageMs = Date.now() - entry.timestamp;
    const effectiveTtl = customTtlMs ?? entry.ttlMs;
    const isFresh = ageMs < effectiveTtl;

    if (isFresh) {
      NetworkManager.recordCacheHit(key);
    }

    return {
      data: entry.data,
      isFresh,
      ageMs,
    };
  }

  /**
   * Load from persistent storage (AsyncStorage) into memory on app/screen startup.
   */
  public async hydrate<T>(key: string, ttlMs: number = 15_000): Promise<T | null> {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_PREFIX + key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.timestamp === "number" && "data" in parsed) {
        this.memoryCache.set(key, {
          data: parsed.data,
          timestamp: parsed.timestamp,
          ttlMs,
        });
        return parsed.data as T;
      }
    } catch (e) {
      console.warn(`[ResourceCache] Failed to hydrate cache for ${key}`, e);
    }
    return null;
  }

  /**
   * Save data into memory and asynchronously persist to disk.
   */
  public async set<T>(key: string, data: T, ttlMs: number = 15_000): Promise<void> {
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttlMs,
    };
    this.memoryCache.set(key, entry);

    try {
      await AsyncStorage.setItem(
        STORAGE_PREFIX + key,
        JSON.stringify({ data, timestamp: entry.timestamp })
      );
    } catch (e) {
      console.warn(`[ResourceCache] Failed to persist cache for ${key}`, e);
    }
  }

  /**
   * Update existing cache entry in place without clearing it.
   */
  public async update<T>(
    key: string,
    updater: (prev: T | null) => T,
    ttlMs: number = 15_000
  ): Promise<T> {
    const current = this.get<T>(key).data;
    const updatedData = updater(current);
    await this.set(key, updatedData, ttlMs);
    return updatedData;
  }

  /**
   * Targeted invalidation.
   * Can invalidate an exact key or all keys matching a prefix/resource pattern.
   * (e.g. invalidate("attendance") or invalidate("dashboard"))
   */
  public async invalidate(resourcePattern: string): Promise<void> {
    const matchedKeys: string[] = [];

    for (const key of this.memoryCache.keys()) {
      if (key === resourcePattern || key.includes(resourcePattern)) {
        matchedKeys.push(key);
      }
    }

    for (const key of matchedKeys) {
      const current = this.memoryCache.get(key);
      if (current) {
        // Expire immediately by setting timestamp to 0
        this.memoryCache.set(key, { ...current, timestamp: 0 });
      }
    }

    if (__DEV__) {
      console.log(
        `[ResourceCache] Invalidated ${matchedKeys.length} keys matching "${resourcePattern}"`
      );
    }
  }

  /**
   * Clear all cache entries.
   */
  public clear(): void {
    this.memoryCache.clear();
  }
}

export const ResourceCache = new ResourceCacheClass();

