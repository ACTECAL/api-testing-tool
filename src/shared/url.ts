// Keeps the URL bar and the Params table in step, as API clients do: editing one updates the other.
// Query strings are split and joined by hand, so {{variables}} and unusual characters survive as typed.
import { newRow, type KeyValue } from './types';

const decode = (text: string): string => {
  try {
    return decodeURIComponent(text.replace(/\+/g, ' '));
  } catch {
    return text;
  }
};

/** "https://x.test/a?b=1&c" → { base: "https://x.test/a", params: [b=1, c=""], hash: "" } */
export function splitUrl(url: string): { base: string; query: string; hash: string } {
  const hashAt = url.indexOf('#');
  const withoutHash = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const hash = hashAt >= 0 ? url.slice(hashAt) : '';
  const queryAt = withoutHash.indexOf('?');
  return queryAt >= 0 ? { base: withoutHash.slice(0, queryAt), query: withoutHash.slice(queryAt + 1), hash } : { base: withoutHash, query: '', hash };
}

/** Params rows from the URL's query string, reusing existing row ids (and disabled rows) where they match. */
export function paramsFromUrl(url: string, previous: KeyValue[] = []): KeyValue[] {
  const { query } = splitUrl(url);
  const pairs = query
    ? query
        .split('&')
        .filter((part) => part !== '')
        .map((part) => {
          const eq = part.indexOf('=');
          return eq >= 0 ? { name: decode(part.slice(0, eq)), value: decode(part.slice(eq + 1)) } : { name: decode(part), value: '' };
        })
    : [];
  const enabled = previous.filter((row) => row.enabled);
  const rows = pairs.map((pair, index) => {
    const same = enabled[index];
    return same ? { ...same, name: pair.name, value: pair.value } : newRow(pair);
  });
  // Disabled rows are not in the URL; keep them in the table.
  return [...rows, ...previous.filter((row) => !row.enabled)];
}

// Encodes what a query needs encoded, but leaves {{variables}} alone.
const encodePart = (text: string): string =>
  text
    .split(/(\{\{[^}]*\}\})/)
    .map((piece) => (/^\{\{[^}]*\}\}$/.test(piece) ? piece : encodeURIComponent(piece).replace(/%20/g, '+')))
    .join('');

/** The URL with its query rebuilt from the enabled params rows. */
export function urlWithParams(url: string, params: KeyValue[]): string {
  const { base, hash } = splitUrl(url);
  const query = params
    .filter((row) => row.enabled && (row.name || row.value))
    .map((row) => (row.value === '' ? encodePart(row.name) : `${encodePart(row.name)}=${encodePart(row.value)}`))
    .join('&');
  return `${base}${query ? `?${query}` : ''}${hash}`;
}
