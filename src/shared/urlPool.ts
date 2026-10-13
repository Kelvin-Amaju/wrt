export interface UrlPoolInvalidEntry {
  line: number;
  input: string;
  reason: string;
}

export interface UrlPoolParseResult {
  valid: string[];
  duplicates: number;
  invalid: UrlPoolInvalidEntry[];
}

export function normalizePoolUrl(input: string): string {
  const trimmed = String(input || '').trim();
  if (!trimmed) throw new Error('Enter a URL');
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;
  let parsed: URL;
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

function duplicateKey(url: string): string {
  const parsed = new URL(url);
  parsed.protocol = parsed.protocol.toLowerCase();
  parsed.hostname = parsed.hostname.toLowerCase();
  return parsed.toString();
}

export function parseUrlPool(text: string): UrlPoolParseResult {
  const valid: string[] = [];
  const invalid: UrlPoolInvalidEntry[] = [];
  const seen = new Set<string>();
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
