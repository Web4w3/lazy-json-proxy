/**
 * Scans a JSON string and builds a {key → {start, end}} span index for the
 * top-level container (object or array). Values are NOT parsed — we only
 * locate their byte spans so they can be parsed on demand.
 *
 * Returned spans are half-open: json.slice(start, end) is the raw value text.
 */

export class JsonSpanner {
  /**
   * Index a JSON string. Spans are character positions (for use with string.slice).
   * @param {string} json
   * @returns {{ type: 'object'|'array', spans: Map<string|number, {start:number, end:number}> }}
   */
  static index(json) {
    return JsonSpanner._scan(json, false);
  }

  /**
   * Index a JSON Buffer/Uint8Array. Spans are byte positions (for use with buf.slice).
   * All JSON structure characters are ASCII, so byte positions equal character positions
   * for structure; non-ASCII bytes only appear inside strings and are safely skipped.
   *
   * @param {Buffer|Uint8Array} buf
   * @returns {{ type: 'object'|'array', spans: Map<string|number, {start:number, end:number}> }}
   */
  static indexBuffer(buf) {
    return JsonSpanner._scan(buf, true);
  }

  static _scan(input, isBuffer) {
    const len = input.length;
    let i = 0;

    const code = isBuffer
      ? (pos) => input[pos]
      : (pos) => input.charCodeAt(pos);

    // skip leading whitespace
    while (i < len && isWSCode(code(i))) i++;
    if (i >= len) throw new SyntaxError('Empty input');

    const c = code(i);
    if (c === 0x7B) return { type: 'object', spans: JsonSpanner._scanObject(input, i, isBuffer) };
    if (c === 0x5B) return { type: 'array',  spans: JsonSpanner._scanArray(input, i, isBuffer) };
    throw new SyntaxError(`Expected '{' or '[', got code ${c}`);
  }

  static _scanObject(input, start, isBuffer) {
    const spans = new Map();
    const len = input.length;
    let i = start + 1;

    const code = isBuffer ? (pos) => input[pos] : (pos) => input.charCodeAt(pos);

    while (i < len) {
      while (i < len && isWSCode(code(i))) i++;
      if (code(i) === 0x7D) return spans; // '}'
      if (code(i) === 0x2C) { i++; continue; } // ','

      if (code(i) !== 0x22) throw new SyntaxError(`Expected '"' at ${i}`); // '"'
      const keyEnd = skipStringAt(input, i, isBuffer);
      const key = isBuffer
        ? JSON.parse(input.slice(i, keyEnd).toString('utf8'))
        : JSON.parse(input.slice(i, keyEnd));
      i = keyEnd;

      while (i < len && isWSCode(code(i))) i++;
      if (code(i) !== 0x3A) throw new SyntaxError(`Expected ':' at ${i}`); // ':'
      i++;

      while (i < len && isWSCode(code(i))) i++;
      const valStart = i;
      i = skipValueAt(input, i, isBuffer);
      spans.set(key, { start: valStart, end: i });
    }
    return spans;
  }

  static _scanArray(input, start, isBuffer) {
    const spans = new Map();
    const len = input.length;
    let i = start + 1;
    let idx = 0;

    const code = isBuffer ? (pos) => input[pos] : (pos) => input.charCodeAt(pos);

    while (i < len) {
      while (i < len && isWSCode(code(i))) i++;
      if (code(i) === 0x5D) return spans; // ']'
      if (code(i) === 0x2C) { i++; continue; } // ','

      const valStart = i;
      i = skipValueAt(input, i, isBuffer);
      spans.set(idx++, { start: valStart, end: i });
    }
    return spans;
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function isWSCode(c) {
  return c === 32 || c === 9 || c === 13 || c === 10;
}

function skipStringAt(input, pos, isBuffer) {
  const len = input.length;
  let i = pos + 1;
  while (i < len) {
    const c = isBuffer ? input[i++] : input.charCodeAt(i++);
    if (c === 0x5C) { i++; continue; } // backslash: skip next
    if (c === 0x22) return i;           // closing "
  }
  throw new SyntaxError(`Unterminated string at ${pos}`);
}

function skipValueAt(input, pos, isBuffer) {
  const code = isBuffer ? (p) => input[p] : (p) => input.charCodeAt(p);
  const len = input.length;
  const c = code(pos);

  if (c === 0x22) return skipStringAt(input, pos, isBuffer); // '"'

  if (c === 0x7B || c === 0x5B) { // '{' or '['
    const close = c === 0x7B ? 0x7D : 0x5D;
    let depth = 1;
    let i = pos + 1;
    while (i < len) {
      const ch = code(i++);
      if (ch === 0x22) { i = skipStringAt(input, i - 1, isBuffer); continue; }
      if (ch === c) depth++;
      else if (ch === close) { if (--depth === 0) return i; }
    }
    throw new SyntaxError(`Unterminated container at ${pos}`);
  }

  // scalar (number, boolean, null)
  let i = pos + 1;
  while (i < len) {
    const ch = code(i);
    if (ch === 0x2C || ch === 0x7D || ch === 0x5D || isWSCode(ch)) break;
    i++;
  }
  return i;
}

// Keep old string-specific exports for backward compatibility with existing tests
function isWS(c) { return c === ' ' || c === '\t' || c === '\r' || c === '\n'; }

function skipString(s, pos) { return skipStringAt(s, pos, false); }

/** @deprecated use skipValueAt directly */
export function skipValue(s, pos) { return skipValueAt(s, pos, false); }
