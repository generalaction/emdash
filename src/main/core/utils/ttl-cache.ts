/**
 * Single-value async cache with TTL and in-flight deduplication.
 *
 * - Concurrent `get()` calls while a fetch is in-progress share one promise.
 * - On fetch error the cache is not populated; the next call retries.
 * - Call `invalidate()` to force re-fetch on the next `get()`.
 */
export class TTLCache<T> {
  private _cached: { value: T; expiresAt: number } | null = null;
  private _inFlight: Promise<T> | null = null;

  constructor(private readonly ttlMs: number) {}

  get(fetch: () => Promise<T>): Promise<T> {
    if (this._cached && this._cached.expiresAt > Date.now()) {
      return Promise.resolve(this._cached.value);
    }
    if (this._inFlight) return this._inFlight;

    this._inFlight = fetch()
      .then((value) => {
        this._cached = { value, expiresAt: Date.now() + this.ttlMs };
        return value;
      })
      .finally(() => {
        this._inFlight = null;
      });

    return this._inFlight;
  }

  invalidate(): void {
    this._cached = null;
  }
}
