function normalizePoolUrl(input) {
  const trimmed = String(input || '').trim();
  if (!trimmed) throw new Error('Enter a URL');
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error('Invalid URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only http:// and https:// URLs are supported');
  if (!parsed.hostname || /\s/.test(parsed.hostname)) throw new Error('Invalid URL');
  parsed.protocol = parsed.protocol.toLowerCase();
  parsed.hostname = parsed.hostname.toLowerCase();
  return parsed.toString();
}

function duplicateKey(url) {
  const parsed = new URL(url);
  parsed.protocol = parsed.protocol.toLowerCase();
  parsed.hostname = parsed.hostname.toLowerCase();
  return parsed.toString();
}

function parseUrlPoolText(text) {
  const valid = [];
  const invalid = [];
  const seen = new Set();
  let duplicates = 0;
  String(text || '').split(/\r?\n/).forEach((raw, index) => {
    const input = raw.trim();
    if (!input) return;
    try {
      const normalized = normalizePoolUrl(input);
      const key = duplicateKey(normalized);
      if (seen.has(key)) {
        duplicates += 1;
        return;
      }
      seen.add(key);
      valid.push(normalized);
    } catch (error) {
      invalid.push({ line: index + 1, input, reason: error instanceof Error ? error.message : 'Invalid URL' });
    }
  });
  return { valid, duplicates, invalid };
}

function seedHash(value) {
  let h = 2166136261 >>> 0;
  const text = String(value ?? '');
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededRandom(seed) {
  let state = seedHash(seed) || 0x9e3779b9;
  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(values, random) {
  const copy = values.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function createUrlDeck(urls, seed = '') {
  const normalized = Array.from(new Set((urls || []).map(normalizePoolUrl)));
  if (normalized.length === 0) throw new Error('URL deck requires at least one valid URL');
  const random = seededRandom(seed);
  let deck = [];
  let index = 0;
  function refill() {
    deck = shuffle(normalized, random);
    index = 0;
  }
  refill();
  return {
    next() {
      if (index >= deck.length) refill();
      const value = deck[index];
      index += 1;
      return value;
    },
    get size() { return normalized.length; },
  };
}

module.exports = {
  normalizePoolUrl,
  parseUrlPoolText,
  createUrlDeck,
};
