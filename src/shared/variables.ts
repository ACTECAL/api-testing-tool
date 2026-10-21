// {{name}} variables from the active environment, as in Postman. Unknown names are left as they are and
// reported, so the user can see what is missing before sending.
import type { KeyValue } from './types';

const PATTERN = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;

export function variableMap(variables: KeyValue[] = []): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of variables) if (row.enabled && row.name.trim()) map.set(row.name.trim(), row.value);
  return map;
}

/** Replaces {{name}} with its value; one level only, so a value cannot pull in other variables. */
export function substitute(text: string, map: Map<string, string>, missing?: Set<string>): string {
  return String(text ?? '').replace(PATTERN, (match, name: string) => {
    if (map.has(name)) return map.get(name) as string;
    missing?.add(name);
    return match;
  });
}

/** Every variable name used in the text. */
export function variablesIn(text: string): string[] {
  return [...String(text ?? '').matchAll(PATTERN)].map((match) => match[1]);
}
