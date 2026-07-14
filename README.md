# @web4w3/lazy-json-proxy

Proxy-based lazy JSON deserializer — parses subtrees on demand and evicts cold parsed values from memory, keeping only the compact raw JSON string in the baseline footprint.

**Why:** Fully parsing a large JSON object with `JSON.parse` can multiply memory usage 3–5× (the raw string _plus_ every JS object, string, and number on the heap). If you only need to read a fraction of the keys, that's wasteful. This library wraps the raw JSON string in a `Proxy` and only parses the subtrees you actually access, evicting them from the cache when budget is exceeded and re-parsing on the next read.

## Install

```sh
npm install @web4w3/lazy-json-proxy
```

## Usage

```js
import { createLazyProxy } from '@web4w3/lazy-json-proxy';
import { readFileSync } from 'fs';

// Load the raw JSON (or receive it over the network, etc.)
const raw = readFileSync('huge.json', 'utf8');

// Wrap it — no parsing happens here
const doc = createLazyProxy(raw, { maxCacheBytes: 10_000_000 }); // 10 MB cache

// Access exactly what you need — only these subtrees are parsed
console.log(doc.metadata.createdAt);  // parses just the 'metadata' subtree
console.log(doc.results[0].title);    // parses just results[0]

// Cold entries are evicted when cache fills up and re-parsed on next access
```

## Memory model

| What | Memory |
|---|---|
| `JSON.parse` on a 200 MB file | ~600 MB–1 GB (string + full object tree) |
| `createLazyProxy` on a 200 MB file | ~200 MB baseline (raw string) + cache |
| With `maxCacheBytes: 10_000_000` | ~210 MB max |

Evicted parsed values are freed for GC. The raw string is always retained — it is the backing store. For access patterns that touch < ~30% of the data, this can dramatically reduce heap pressure.

## API

### `createLazyProxy(json, options?) → Proxy`

| Param | Type | Default | Description |
|---|---|---|---|
| `json` | `string` | — | Full JSON text. Top-level must be an object `{…}` or array `[…]`. |
| `options.maxCacheBytes` | `number` | `0` | Max raw JSON bytes to hold in the parsed-value cache per proxy level. `0` = unlimited. |

Returns a `Proxy` that behaves like the parsed value but parses subtrees lazily.

**Supported operations:**
- Property access: `proxy.key`, `proxy[index]`
- `in` operator: `'key' in proxy`
- `Object.keys(proxy)`, `Object.entries(proxy)`
- `for...of` on arrays
- `JSON.stringify(proxy)` — triggers full materialisation (defeats lazy purpose)
- `.length` on array proxies

### `JsonSpanner` (advanced)

Scans a JSON string and returns a `{start, end}` span index without parsing values. Useful for custom access patterns.

```js
import { JsonSpanner } from '@web4w3/lazy-json-proxy';

const { type, spans } = JsonSpanner.index('{"a":1,"b":[2,3]}');
// type === 'object'
// spans.get('a') === { start: 5, end: 6 }
// json.slice(spans.get('b').start, spans.get('b').end) === '[2,3]'
```

### `LruCache` (advanced)

Byte-budget LRU cache. Used internally; exported for custom proxy builders.

## Limitations

- The raw JSON string **must fit in memory** — this library saves the _parsed JS object_ overhead, not the string itself. For files larger than available heap, use a streaming parser instead.
- Nested proxy levels each have their own cache budget (not a single global budget).
- Mutations are not supported — the proxy is read-only.

## Requirements

Node.js ≥ 18. No runtime dependencies.

## License

MIT © [Web4w3 LLC](https://web4w3.com)
