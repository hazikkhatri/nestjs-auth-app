// src/cache/cache.service.ts
import { Injectable, Inject, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  constructor(
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) {}

  /**
   * Get value from cache
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      return await this.cacheManager.get<T>(key);
    } catch (error) {
      this.logger.warn(`Cache GET failed for key "${key}": ${error.message}`);
      return null;
    }
  }

  /**
   * Set value in cache with optional TTL (milliseconds)
   */
  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    try {
      await this.cacheManager.set(key, value, ttlMs);
    } catch (error) {
      this.logger.warn(`Cache SET failed for key "${key}": ${error.message}`);
    }
  }

  /**
   * Delete a cache key
   */
  async del(key: string): Promise<void> {
    try {
      await this.cacheManager.del(key);
    } catch (error) {
      this.logger.warn(`Cache DEL failed for key "${key}": ${error.message}`);
    }
  }

  /**
   * Get or set pattern - fetch from cache or compute and store
   */
  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    ttlMs?: number,
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null && cached !== undefined) {
      return cached;
    }

    const value = await factory();
    await this.set(key, value, ttlMs);
    return value;
  }

  /**
   * Delete multiple keys matching a prefix
   * (Requires Redis in production for pattern deletion)
   */
  async delByPrefix(prefix: string): Promise<void> {
    try {
      // This only works with a Redis client that supports KEYS or SCAN
      const store = (this.cacheManager as any).store;
      if (store?.keys) {
        const keys: string[] = await store.keys(`${prefix}*`);
        if (keys.length > 0) {
          await Promise.all(keys.map((key) => this.del(key)));
        }
      }
    } catch (error) {
      this.logger.warn(`Cache DEL BY PREFIX failed: ${error.message}`);
    }
  }

  /**
   * Wrap a function with caching
   */
  wrap<T>(key: string, fn: () => Promise<T>, ttlMs?: number): Promise<T> {
    return this.getOrSet(key, fn, ttlMs);
  }
}
