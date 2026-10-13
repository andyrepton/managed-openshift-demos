/**
 * TTL cache that keeps serving stale values when the refresh fails.
 *
 * The wizard re-queries on every change to the form, while Azure's published prices
 * move rarely, so almost every request should be a cache hit. The stale-on-error
 * behaviour matters more than the hit rate though: if Azure is unreachable we would
 * rather show yesterday's price with a warning than a blank panel or an error.
 */
export interface CacheEntry<T> {
  value: T;
  /** When this value was fetched. */
  storedAt: number;
  /** True if it is past its TTL and a refresh has since failed. */
  stale: boolean;
}

export class TtlCache<T> {
  private readonly entries = new Map<string, { value: T; storedAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Return the cached value, refreshing it if expired.
   *
   * If the refresh throws and we hold an expired value, that value is returned with
   * `stale: true` rather than propagating the error. With nothing cached at all, the
   * error propagates - there is nothing honest to show.
   */
  async get(key: string, load: () => Promise<T>): Promise<CacheEntry<T>> {
    const hit = this.entries.get(key);
    const fresh = hit !== undefined && this.now() - hit.storedAt < this.ttlMs;

    if (fresh) {
      return { value: hit.value, storedAt: hit.storedAt, stale: false };
    }

    try {
      const value = await load();
      const storedAt = this.now();
      this.entries.set(key, { value, storedAt });
      return { value, storedAt, stale: false };
    } catch (err) {
      if (hit) {
        return { value: hit.value, storedAt: hit.storedAt, stale: true };
      }
      throw err;
    }
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}
