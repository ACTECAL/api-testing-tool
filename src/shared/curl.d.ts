// Types for curl.js (shared with the web curl tester on actecal.com).
export type FormFile = { fileName: string; contentType: string | null; asText: boolean };
export type FormEntry = [string, string] | [string, string, FormFile];

export interface ParsedCurl {
  method: string;
  url: string;
  headers: [string, string][];
  body: string | null;
  form: FormEntry[] | null;
  bodyFile: { fileName: string } | null;
  timeoutSeconds: number | null;
  proxy: string | null;
  insecure: boolean;
  notes: string[];
}

export interface CurlRequest {
  method: string;
  url: string;
  headers: [string, string][];
  body?: string | null;
  form?: FormEntry[] | null;
  bodyFile?: { fileName: string } | null;
}

export class CurlError extends Error {}
export const FORBIDDEN_HEADERS: Set<string>;
export const FORBIDDEN_METHODS: Set<string>;
export function isForbiddenHeader(name: string): boolean;
export function tokenize(command: string): string[];
export function parseCurl(command: string): ParsedCurl;
export function preflightReasons(request: { method: string; headers: [string, string][] }): string[];
export function parseHeaderLines(text: string): { headers: [string, string][]; errors: string[]; notes: string[] };
export function toCurl(request: CurlRequest): string;
export function toFetchCode(request: CurlRequest): string;
