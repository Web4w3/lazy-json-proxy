/**
 * Scans a JSON string and builds a {key → {start, end}} span index for the
 * top-level container (object or array). Values are NOT parsed — we only
 * locate their byte spans so they can be parsed on demand.
 *
 * Returned spans are half-open: json.slice(start, end) is the raw value text.
 */

export class JsonSpanner {
  /**
   * @param {string} json  Full JSON text (object or array at top level).
   * @returns {{ type: 'object'|'array', spans: Map<string|number, {start:number, end:number}> }}
   */
  static index(json) {
    const s = json;
    let i = 0;

    // skip leading whitespace
    while (i < s.length && isWS(s[i])) i++;
    if (i >= s.length) throw new SyntaxError('Empty input');

    const root = s[i];
    if (root === '{') return { type: 'object', spans: JsonSpanner._indexObject(s, i) };
    if (root === '[') return { type: 'array',  spans: JsonSpanner._indexArray(s, i) };
    throw new SyntaxError(`Expected '{' or '[', got '${root}'`);
  }

  static _indexObject(s, start) {
    const spans = new Map();
    let i = start + 1; // skip opening '{'

    while (i < s.length) {
      while (i < s.length && isWS(s[i])) i++;
      if (s[i] === '}') return spans;
      if (s[i] === ',') { i++; continue; }

      // read key
      if (s[i] !== '"') throw new SyntaxError(`Expected '"' at ${i}`);
      const keyEnd = skipString(s, i);
      const key = JSON.parse(s.slice(i, keyEnd));
      i = keyEnd;

      // skip colon
      while (i < s.length && isWS(s[i])) i++;
      if (s[i] !== ':') throw new SyntaxError(`Expected ':' at ${i}`);
      i++;

      // locate value span
      while (i < s.length && isWS(s[i])) i++;
      const valStart = i;
      i = skipValue(s, i);
      spans.set(key, { start: valStart, end: i });
    }
    return spans;
  }

  static _indexArray(s, start) {
    const spans = new Map();
    let i = start + 1; // skip opening '['
    let idx = 0;

    while (i < s.length) {
      while (i < s.length && isWS(s[i])) i++;
      if (s[i] === ']') return spans;
      if (s[i] === ',') { i++; continue; }

      const valStart = i;
      i = skipValue(s, i);
      spans.set(idx++, { start: valStart, end: i });
    }
    return spans;
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function isWS(c) {
  return c === ' ' || c === '\t' || c === '\r' || c === '\n';
}

/** Returns the index AFTER the closing '"' of a JSON string starting at pos. */
function skipString(s, pos) {
  let i = pos + 1; // skip opening '"'
  while (i < s.length) {
    const c = s[i++];
    if (c === '\\') { i++; continue; } // skip escaped char
    if (c === '"') return i;
  }
  throw new SyntaxError(`Unterminated string at ${pos}`);
}

/**
 * Returns the index AFTER the complete JSON value starting at pos.
 * The value can be a string, number, boolean, null, object, or array.
 */
export function skipValue(s, pos) {
  const c = s[pos];
  if (c === '"') return skipString(s, pos);
  if (c === '{' || c === '[') {
    const close = c === '{' ? '}' : ']';
    let depth = 1;
    let i = pos + 1;
    while (i < s.length) {
      const ch = s[i++];
      if (ch === '"') { i = skipString(s, i - 1); continue; }
      if (ch === c) depth++;
      else if (ch === close) { if (--depth === 0) return i; }
    }
    throw new SyntaxError(`Unterminated ${c} at ${pos}`);
  }
  // number, boolean, null — scan to delimiter
  let i = pos + 1;
  while (i < s.length) {
    const ch = s[i];
    if (ch === ',' || ch === '}' || ch === ']' || isWS(ch)) break;
    i++;
  }
  return i;
}
