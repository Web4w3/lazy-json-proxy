import { JsonSpanner } from './JsonSpanner.js';
import { LruCache } from './LruCache.js';

const LAZY_PROXY = Symbol('LazyProxy');

/**
 * Wraps a JSON string in a Proxy that parses values on first access and
 * evicts cold parsed values from memory when the cache budget is exceeded.
 *
 * The raw JSON string is always retained (it IS the compact representation).
 * Only the materialised JS objects/arrays are subject to eviction.
 * On re-access after eviction, the subtree is re-parsed from the raw string.
 *
 * @param {string}  json                       Full JSON text (object or array).
 * @param {object}  [options]
 * @param {number}  [options.maxCacheBytes=0]  Parsed-value cache size cap in bytes.
 *                                              0 = unlimited (no eviction).
 * @returns {Proxy}
 */
export function createLazyProxy(json, options = {}) {
  const { maxCacheBytes = 0 } = options;
  return _makeProxy(json, new LruCache(maxCacheBytes));
}

// ─── internal ────────────────────────────────────────────────────────────────

function _makeProxy(json, cache) {
  const { type, spans } = JsonSpanner.index(json);

  // A plain target object/array we attach our metadata to.
  // Proxied operations read from `spans` and `cache`, not from target.
  const target = type === 'array' ? [] : {};

  target[LAZY_PROXY] = true;
  target._json   = json;
  target._spans  = spans;
  target._cache  = cache;
  target._type   = type;

  return new Proxy(target, type === 'array' ? ARRAY_HANDLER : OBJECT_HANDLER);
}

function _resolve(target, prop) {
  const { _json, _spans, _cache } = target;
  const span = _spans.get(prop);
  if (span === undefined) return undefined;

  const cached = _cache.get(prop);
  if (cached !== undefined) return cached;

  const rawValue = _json.slice(span.start, span.end);
  const value = _deserialize(rawValue, _cache);
  _cache.set(prop, value, rawValue.length);
  return value;
}

function _deserialize(rawValue, cache) {
  const first = rawValue[0];
  // Each nested proxy gets its own cache to avoid key collisions between
  // sibling objects that share the same property names.
  if (first === '{' || first === '[') return _makeProxy(rawValue, new LruCache(cache._max));
  return JSON.parse(rawValue);
}

// ─── Proxy handlers ──────────────────────────────────────────────────────────

const OBJECT_HANDLER = {
  get(target, prop, receiver) {
    if (prop === LAZY_PROXY)      return true;
    if (prop === 'toJSON')        return () => _materialize(target);
    if (prop === Symbol.iterator) return _objectIterator.bind(null, target);
    if (typeof prop === 'symbol') return Reflect.get(target, prop, receiver);
    const strProp = String(prop);
    if (strProp in target && !(strProp in Object.prototype)) return Reflect.get(target, prop, receiver);
    return _resolve(target, strProp);
  },

  has(target, prop) {
    return target._spans.has(String(prop));
  },

  ownKeys(target) {
    return [...target._spans.keys()];
  },

  getOwnPropertyDescriptor(target, prop) {
    const strProp = String(prop);
    if (target._spans.has(strProp)) {
      return { configurable: true, enumerable: true, writable: false, value: _resolve(target, strProp) };
    }
    return undefined;
  },
};

const ARRAY_HANDLER = {
  get(target, prop, receiver) {
    if (prop === LAZY_PROXY) return true;
    if (prop === 'toJSON')   return () => _materialize(target);
    if (prop === 'length')   return target._spans.size;
    if (prop === Symbol.iterator)  return _arrayIterator.bind(null, target);
    if (prop === Symbol.toPrimitive || prop === Symbol.toStringTag) return Reflect.get(target, prop, receiver);
    if (typeof prop === 'symbol')  return Reflect.get(target, prop, receiver);
    const idx = Number(prop);
    if (Number.isInteger(idx) && idx >= 0) return _resolve(target, idx);
    return Reflect.get(target, prop, receiver);
  },

  has(target, prop) {
    const idx = Number(prop);
    return Number.isInteger(idx) && target._spans.has(idx);
  },

  ownKeys(target) {
    return [...target._spans.keys()].map(String).concat(['length']);
  },

  getOwnPropertyDescriptor(target, prop) {
    if (prop === 'length') return { configurable: false, enumerable: false, writable: true, value: target._spans.size };
    const idx = Number(prop);
    if (Number.isInteger(idx) && idx >= 0 && target._spans.has(idx)) {
      return { configurable: true, enumerable: true, writable: false, value: _resolve(target, idx) };
    }
    return undefined;
  },
};

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Recursively materialise a lazy proxy into a plain JS value. */
function _materialize(target) {
  if (target._type === 'array') {
    const arr = [];
    for (let i = 0; i < target._spans.size; i++) arr.push(_maybeUnwrap(_resolve(target, i)));
    return arr;
  }
  const obj = {};
  for (const key of target._spans.keys()) obj[key] = _maybeUnwrap(_resolve(target, key));
  return obj;
}

function _maybeUnwrap(v) {
  if (v && typeof v === 'object' && v[LAZY_PROXY]) {
    return _materialize(v._type === 'array' ? v : v);
  }
  return v;
}

function* _objectIterator(target) {
  for (const key of target._spans.keys()) yield [key, _resolve(target, key)];
}

function* _arrayIterator(target) {
  for (let i = 0; i < target._spans.size; i++) yield _resolve(target, i);
}
