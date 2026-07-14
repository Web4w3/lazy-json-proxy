# Proposal: File-Backed Lazy Proxy — `createLazyProxyFromFile()`

## Status

Open — implementation pending.  
Related issue: [#1 createLazyProxy() still requires a fully-parsed object](../../issues/1)

---

## Background

`lazy-json-proxy` provides `createLazyProxy(obj)`, which wraps an already-parsed
JavaScript object in a `Proxy` that defers property access until each key is
first read.  The declared goal is to keep large JSON objects off the V8 heap
by deserialising only the properties that a caller actually touches.

## Problem

The current API requires the caller to supply a pre-parsed JavaScript object:

```js
const obj = JSON.parse(await fs.readFile('large.json', 'utf8'));
const proxy = createLazyProxy(obj);
```

This means `JSON.parse` has already been called by the time the proxy is
constructed.  The entire JSON document has been parsed into a V8 object graph
and is fully resident in V8 memory.  Wrapping it in a proxy afterwards does
not reclaim that memory, nor does it prevent any of the parse work from
happening.

The proxy therefore provides no heap advantage over a plain object for the
large-file use case it targets.  It is only useful as a lazy evaluation
wrapper for objects that are already in memory for other reasons.

Additionally, `JSON.parse` in V8 first requires the source bytes to be decoded
into a UTF-16 JavaScript string.  For a 500 MB JSON file this decoding alone
allocates ~1 GB of V8 heap before any object keys or values are created.
The string representation is a separate V8 allocation from the resulting
object graph, so peak memory can briefly reach 3× the raw file size.

Node.js `Buffer` objects, by contrast, are allocated in the C++ heap (via
`malloc`/`mmap` depending on size) and are not counted against
`--max-old-space-size`.  A 500 MB Buffer does not trigger V8 GC pressure.

## Requirements for a Solution

Any acceptable solution must satisfy all of the following constraints.

### New entry point

1. The library must expose a new asynchronous factory function whose input is
   a **file path** (string), not a pre-parsed object.
2. A synchronous companion that accepts a `Buffer` (for callers who already
   have raw bytes from another source) must also be provided.
3. Both functions must return a proxy that is indistinguishable from a plain
   parsed object for the purposes of property access, `"key" in proxy`,
   `Object.keys()`, `JSON.stringify()`, and `for...of` iteration.

### Heap isolation

4. The raw JSON bytes must reside outside the V8 heap for the lifetime of the
   proxy.  The mechanism by which this is achieved is not prescribed, but the
   result must mean that a 500 MB JSON file does not contribute 500 MB to
   `process.memoryUsage().heapUsed`.
5. A property value that has never been accessed must not appear as a string or
   object on the V8 heap.
6. Once a cached value is evicted (see requirement 8), it must not remain on
   the V8 heap.

### Lazy deserialisation

7. Accessing a property must deserialise **only that property's value**, not
   the values of sibling properties.
8. The proxy must support an optional byte-budget LRU cache so that frequently
   accessed values are not re-parsed on every read.  When the cache budget is
   exhausted, the least-recently-used entry must be evicted and the raw bytes
   must remain accessible for future re-parsing.

### Nested values

9. Accessing a property whose value is itself a JSON object or array must
   return a proxy with the same lazy semantics — not a fully-materialised
   object.
10. Nested proxies must not share cache state with sibling proxies.  Accessing
    the same key name in two different nested objects must not cause one to
    evict or overwrite the other's cached value.

### API compatibility

11. The existing `createLazyProxy(obj)` signature must not change and must
    continue to work.
12. The new factory functions must be importable as named exports from the
    package root.

### Testability

13. It must be possible to write a deterministic test that verifies a large
    object is accessible without the raw JSON bytes appearing as a V8 string.
14. It must be possible to test that a value is re-parsed correctly after cache
    eviction.

---

## Out of Scope

- Streaming or chunked file reads.  The proposal targets random-access
  deserialisation, not sequential processing.
- Write-back / mutation of the underlying file.  The proxy is read-only.
- Support for JSON streams (NDJSON, JSON Lines).  Only single-document JSON
  objects and arrays are in scope.

---

## Open Questions

- Should the function accept an `AbortSignal` so long-lived proxies can
  release their file handle without the caller needing to hold a reference?
- Should accessing a missing key (`proxy.nonExistent`) return `undefined` (JS
  default) or throw, to help callers distinguish "key not in JSON" from
  "key not yet cached"?
- Is a synchronous `createLazyProxyFromFileSync()` (using `fs.readFileSync`)
  useful, or does the synchronous-Buffer variant cover all sync use cases?
