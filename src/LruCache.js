/**
 * LRU cache keyed by string/number, with a byte-based eviction budget.
 * Entries are evicted oldest-first when adding a new entry would exceed maxBytes.
 */
export class LruCache {
  /** @param {number} maxBytes  Max total tracked bytes. 0 = unlimited. */
  constructor(maxBytes = 0) {
    this._max = maxBytes;
    this._map = new Map(); // key → { value, bytes }
    this._bytes = 0;
  }

  get size() { return this._map.size; }
  get bytes() { return this._bytes; }

  get(key) {
    const entry = this._map.get(key);
    if (entry === undefined) return undefined;
    // promote to most-recently-used
    this._map.delete(key);
    this._map.set(key, entry);
    return entry.value;
  }

  /** @param {number} bytes  Estimated memory cost of `value` in bytes. */
  set(key, value, bytes = 0) {
    if (this._map.has(key)) {
      this._bytes -= this._map.get(key).bytes;
      this._map.delete(key);
    }
    if (this._max > 0) this._evict(bytes);
    this._map.set(key, { value, bytes });
    this._bytes += bytes;
  }

  has(key) { return this._map.has(key); }

  delete(key) {
    const entry = this._map.get(key);
    if (entry) { this._bytes -= entry.bytes; this._map.delete(key); return true; }
    return false;
  }

  clear() { this._map.clear(); this._bytes = 0; }

  _evict(needed) {
    if (this._max === 0) return;
    const iter = this._map.keys();
    while (this._bytes + needed > this._max) {
      const { value: oldest, done } = iter.next();
      if (done) break;
      this._bytes -= this._map.get(oldest).bytes;
      this._map.delete(oldest);
    }
  }
}
