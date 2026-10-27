/**
 * Extract the exact bytes of the top-level "payload" object from a message string.
 * Signatures are computed over these raw bytes, so receivers never re-serialise JSON
 * (key order / number formatting would differ between Node and the ESP32).
 * Returns null if the message has no top-level "payload" object.
 */
export function extractRawPayload(message: string): string | null {
  let i = skipWs(message, 0);
  if (message[i] !== '{') return null;
  i++;
  while (i < message.length) {
    i = skipWs(message, i);
    if (message[i] === '}') return null;
    if (message[i] !== '"') return null;
    const keyEnd = skipString(message, i);
    if (keyEnd < 0) return null;
    const key = message.slice(i + 1, keyEnd - 1);
    i = skipWs(message, keyEnd);
    if (message[i] !== ':') return null;
    i = skipWs(message, i + 1);
    const valueEnd = skipValue(message, i);
    if (valueEnd < 0) return null;
    if (key === 'payload') return message[i] === '{' ? message.slice(i, valueEnd) : null;
    i = skipWs(message, valueEnd);
    if (message[i] === ',') i++;
    else if (message[i] === '}') return null;
    else return null;
  }
  return null;
}

function skipWs(s: string, i: number): number {
  while (i < s.length && (s[i] === ' ' || s[i] === '\n' || s[i] === '\r' || s[i] === '\t')) i++;
  return i;
}

/** s[i] must be '"'; returns index just past the closing quote, or -1. */
function skipString(s: string, i: number): number {
  i++;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') i += 2;
    else if (c === '"') return i + 1;
    else i++;
  }
  return -1;
}

/** Returns index just past the JSON value starting at i, or -1. */
function skipValue(s: string, i: number): number {
  const c = s[i];
  if (c === '"') return skipString(s, i);
  if (c === '{' || c === '[') {
    let depth = 0;
    while (i < s.length) {
      const ch = s[i];
      if (ch === '"') {
        i = skipString(s, i);
        if (i < 0) return -1;
        continue;
      }
      if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') {
        depth--;
        if (depth === 0) return i + 1;
      }
      i++;
    }
    return -1;
  }
  // number, true, false, null
  while (i < s.length && !',}] \n\r\t'.includes(s[i]!)) i++;
  return i;
}
