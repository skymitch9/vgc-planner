/**
 * Downloading a team feed and the pastes it points to, straight from the site that publishes them (no cookies
 * sent, nothing goes through our server). The site must allow cross-origin reads (CORS), and a deployment with a
 * Content-Security-Policy must list the feed's origin in connect-src.
 */
import { config } from '../config.ts';
import { readFeed, type TeamFeed } from '../domain/team-feed.ts';

/** One download per feed URL per session; a failed one is forgotten so it can be retried. */
const cache = new Map<string, Promise<TeamFeed>>();

/** A friendlier name for a URL in messages: its host (and port). */
const hostOf = (url: string): string => { try { return new URL(url).host; } catch { return url; } };

/** Checks a feed address typed by the user; returns it normalised, or throws with what is wrong. */
export function checkFeedUrl(raw: string): string {
  const text = raw.trim();
  if (!text) throw new Error('Enter the address of a team feed first (it ends in .json).');
  let url: URL;
  try { url = new URL(text); } catch { throw new Error(`“${text.slice(0, 80)}” isn't a web address. A feed address looks like https://example.com/feed.json.`); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('A feed address must start with https:// (or http://).');
  return url.href;
}

/** GET with a timeout, turning every way it can fail into a sentence; `what` names the thing ("The feed at …"). */
async function get(url: string, accept: string, what: string, fetchFn: typeof fetch): Promise<Response> {
  let res: Response;
  try {
    res = await fetchFn(url, { credentials: 'omit', referrerPolicy: 'no-referrer', headers: { Accept: accept }, signal: AbortSignal.timeout(config.teamFeed.timeoutMs) });
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new Error(`${hostOf(url)} didn't answer within ${config.teamFeed.timeoutMs / 1000} seconds. Try again later.`);
    }
    throw new Error(`Couldn't reach ${hostOf(url)}. Check the address and your connection; the site may also not allow other sites to read it.`);
  }
  if (res.ok) return res;
  if (res.status === 404 || res.status === 410) throw new Error(`${what} answered ${res.status}: there is nothing at that address. Check it and try again.`);
  if (res.status >= 500) throw new Error(`${what} answered ${res.status}: the site that hosts it has a problem right now. Try again later.`);
  throw new Error(`${what} answered ${res.status}: the site refused to send it.`);
}

/** The body as text, refusing anything bigger than `max` characters. */
async function boundedText(res: Response, max: number, what: string): Promise<string> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max * 4) throw new Error(`${what} is too large to load.`);
  const body = await res.text();
  if (body.length > max) throw new Error(`${what} is too large to load.`);
  return body;
}

async function download(url: string, fetchFn: typeof fetch): Promise<TeamFeed> {
  const what = `The feed at ${url}`;
  const res = await get(url, 'application/json', what, fetchFn);
  const body = await boundedText(res, config.teamFeed.maxFeedChars, what);
  let json: unknown;
  try { json = JSON.parse(body); } catch { throw new Error(`${what} didn't return JSON, so it isn't a team feed. Check the address.`); }
  return readFeed(json);
}

/**
 * The feed at `url`, validated (see readFeed); errors are thrown as `Error`s whose message can be shown as is.
 * Kept for the session: `fresh` downloads it again.
 */
export function loadFeed(url: string, { fresh = false, fetchFn = fetch }: { fresh?: boolean; fetchFn?: typeof fetch } = {}): Promise<TeamFeed> {
  let href: string;
  try { href = checkFeedUrl(url); } catch (e) { return Promise.reject(e); }
  let pending = fresh ? undefined : cache.get(href);
  if (!pending) {
    pending = download(href, (input, init) => fetchFn(input, init));
    cache.set(href, pending);
    pending.catch(() => { if (cache.get(href) === pending) cache.delete(href); });
  }
  return pending;
}

/** The text of one team's paste (already resolved with resolvePaste), size-capped. */
export async function fetchFeedPaste(url: string, fetchFn: typeof fetch = fetch): Promise<string> {
  const what = "This team's paste";
  const res = await get(url, 'text/plain', what, (input, init) => fetchFn(input, init));
  const text = (await boundedText(res, config.teamFeed.maxPasteChars, what)).replace(/\r\n?/g, '\n').trim();
  if (!text) throw new Error(`${what} is empty.`);
  return text;
}
