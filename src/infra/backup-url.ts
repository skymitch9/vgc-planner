/**
 * Fetching a backup file (this app's export JSON) from a web address, for the Import dialog's "Backup file" tab and
 * the `?import=<url>` link. Nothing here touches the library: the text it returns goes through the same path as a
 * chosen file (validated by the codec, merged only when the user presses Import). The server must allow
 * cross-origin reads (CORS), and a deployment with a Content-Security-Policy must list its origin in connect-src.
 */
import { config } from '../config.ts';
import { DataError, readExport } from '../domain/codec.ts';

/** The query parameter of a link that opens the Import dialog on a backup's address. */
export const IMPORT_PARAM = 'import';

const hostOf = (url: string): string => { try { return new URL(url).host; } catch { return url; } };

/** Checks an address typed by the user; returns it normalised, or throws with what is wrong. */
export function checkBackupUrl(raw: string): string {
  const text = raw.trim();
  if (!text) throw new Error('Enter the address of a backup file first (it usually ends in .json).');
  let url: URL;
  try { url = new URL(text); } catch { throw new Error(`“${text.slice(0, 80)}” isn't a web address. A backup's address looks like https://example.com/backup.json.`); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('A backup address must start with https:// (or http://).');
  if (url.username || url.password) throw new Error('A backup address can’t contain a user name or password.');
  return url.href;
}

/** What an HTTP error status means, in words. */
const STATUS_WORDS: Readonly<Record<number, string>> = {
  400: 'bad request', 401: 'sign-in required', 403: 'access refused', 404: 'not found', 408: 'request timed out', 410: 'gone',
  429: 'too many requests', 500: 'server error', 502: 'bad gateway', 503: 'unavailable', 504: 'gateway timeout',
};
const statusWords = (status: number): string => STATUS_WORDS[status] ?? (status >= 500 ? 'server error' : 'request refused');

/** The body as text, refusing (and cancelling) anything over `maxBytes`. */
async function boundedText(res: Response, maxBytes: number, tooLarge: () => Error): Promise<string> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) { void res.body?.cancel(); throw tooLarge(); }
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { void reader.cancel(); throw tooLarge(); }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return new TextDecoder().decode(all);
}

/**
 * Downloads the backup at `raw` and checks that it is one (the codec's own validation), returning its JSON text.
 * No cookies or referrer are sent. Every failure is an `Error` whose message can be shown as is.
 */
export async function fetchBackup(raw: string, fetchFn: typeof fetch = fetch): Promise<string> {
  const url = checkBackupUrl(raw);
  const host = hostOf(url);
  const { timeoutMs, maxBytes } = config.backupUrl;
  let res: Response;
  try {
    res = await fetchFn(url, {
      credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store',
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') throw new Error(`The server at ${host} didn't answer within ${timeoutMs / 1000} seconds. Try again later.`);
    throw new Error(`The server at ${host} could not be reached. Check the address and your connection; the server may also not allow other sites to read from it, or this site may not be allowed to connect to it.`);
  }
  if (!res.ok) {
    void res.body?.cancel();
    const advice = res.status === 404 || res.status === 410 ? ' Check the address and try again.' : res.status >= 500 ? ' Try again later.' : '';
    throw new Error(`The server at ${host} answered ${res.status} (${statusWords(res.status)}).${advice}`);
  }
  const text = await boundedText(res, maxBytes, () => new Error(`The file at ${host} is too large to be a backup (${maxBytes / 1_000_000} MB at most).`));
  let json: unknown;
  try { json = JSON.parse(text); } catch { throw new Error(`The file at ${url} is not a planner backup: it isn't JSON. Check the address.`); }
  try { readExport(json); } catch (e) { throw new Error(`The file at ${url} is not a planner backup. ${e instanceof DataError ? e.message : ''}`.trim()); }
  return text;
}

/**
 * Reads `?import=<url>` from a page address. Returns null when there is none; otherwise the address to fetch (or null
 * when it isn't http(s)) and the page address without the parameter, for history.replaceState.
 */
export function readImportLink(href: string): { url: string | null; cleaned: string } | null {
  let page: URL;
  try { page = new URL(href); } catch { return null; }
  if (!page.searchParams.has(IMPORT_PARAM)) return null;
  const raw = page.searchParams.get(IMPORT_PARAM) ?? '';
  page.searchParams.delete(IMPORT_PARAM);
  const cleaned = `${page.pathname}${page.search}${page.hash}`;
  let url: string | null;
  try { url = checkBackupUrl(raw); } catch { url = null; }
  return { url, cleaned };
}
