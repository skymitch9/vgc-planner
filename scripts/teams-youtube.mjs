/**
 * YouTube paste harvester: the fourth top-teams source. Content creators link their teams (pokepast.es /
 * vrpastes.com) in video descriptions, usually with the real spread, so these are teams with CONFIRMED spreads.
 *
 * Per channel handle: channels.list (forHandle) -> the uploads playlist -> playlistItems.list, newest first, until
 * MAX_VIDEOS videos or one published before SINCE. Each call costs 1 unit of the YouTube Data API quota (10,000 a
 * day), so a refresh is a handful of units.
 *
 * The API key is YOUTUBE_API_KEY from the environment, else the `YOUTUBE_API_KEY=` line of .dev.vars. Without one
 * this source is skipped. The key never appears in a log line or an error message (see `hideKey`).
 *
 * Pure apart from `readYoutubeKey` (one file read), so tests run everything on saved API responses.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parsePasteLink } from '../src/domain/paste-links.ts';
import { toID } from './teams-common.mjs';

/** Channel handles (without @). CybertronVGC is Aaron "Cybertron" Zheng. */
export const CHANNELS = ['WolfeyVGC', 'CybertronVGC'];
/** Reg M-C era: older videos are older regulations. */
export const SINCE = '2026-08-01';
export const MAX_VIDEOS = 200;
export const API = 'https://www.googleapis.com/youtube/v3';

/** The key from `env`, else from `<root>/.dev.vars`; '' when there is none. */
export function readYoutubeKey(root, env = process.env) {
  if (env.YOUTUBE_API_KEY?.trim()) return env.YOUTUBE_API_KEY.trim();
  const file = path.join(root, '.dev.vars');
  if (!fs.existsSync(file)) return '';
  const line = fs.readFileSync(file, 'utf8').match(/^\s*YOUTUBE_API_KEY\s*=\s*(.*)$/m)?.[1] ?? '';
  return line.trim().replace(/^(["'])(.*)\1$/, '$2');
}

/** `text` with every occurrence of `key` replaced, so an error message can be printed. */
export const hideKey = (text, key) => (key ? String(text).split(key).join('<key>') : String(text));

export const channelUrl = (handle, key) =>
  `${API}/channels?part=contentDetails,snippet&forHandle=${encodeURIComponent(handle)}&key=${encodeURIComponent(key)}`;
export const playlistUrl = (playlistId, pageToken, key) =>
  `${API}/playlistItems?part=snippet&maxResults=50&playlistId=${encodeURIComponent(playlistId)}` +
  (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '') +
  `&key=${encodeURIComponent(key)}`;
/** The `load` key for a playlist page: "<playlistId>" for the first, "<playlistId>~<pageToken>" after. */
export const playlistKey = (playlistId, pageToken) => (pageToken ? `${playlistId}~${pageToken}` : playlistId);
export const splitPlaylistKey = (key) => {
  const [playlistId, pageToken = ''] = String(key).split('~');
  return { playlistId, pageToken };
};
export const videoUrl = (id) => `https://www.youtube.com/watch?v=${id}`;

/** channels.list JSON -> `{ id, title, uploads }`, or null when the handle matched nothing. */
export function readChannel(json) {
  const item = JSON.parse(json).items?.[0];
  const uploads = item?.contentDetails?.relatedPlaylists?.uploads;
  return uploads ? { id: item.id, title: item.snippet?.title ?? '', uploads } : null;
}

/**
 * playlistItems.list JSON -> the videos published on or after `since` (newest first, as the uploads playlist is),
 * the next page token, and whether an older video was reached (time to stop).
 */
export function readPlaylistPage(json, since) {
  const j = JSON.parse(json);
  const videos = [];
  let reachedSince = false;
  for (const item of j.items ?? []) {
    const s = item.snippet ?? {};
    const id = s.resourceId?.videoId;
    const date = String(s.publishedAt ?? '').slice(0, 10);
    if (!id || !date) continue;
    if (date < since) {
      reachedSince = true;
      continue;
    }
    videos.push({ id, title: String(s.title ?? '').trim(), date, url: videoUrl(id), description: String(s.description ?? ''), channel: s.channelTitle ?? '' });
  }
  return { videos, next: j.nextPageToken ?? null, reachedSince };
}

const LINK = /(?:https?:\/\/)?(?:www\.)?(?:pokepast\.es|vrpastes\.com)\/[^\s<>()[\]"'`]+/gi;

/** The pokepast.es / vrpastes.com links in a video description, normalised and without duplicates, in order. */
export function descriptionLinks(text) {
  const out = [];
  const seen = new Set();
  for (const m of String(text ?? '').matchAll(LINK)) {
    const link = parsePasteLink(m[0].replace(/[.,;:!?]+$/, ''));
    if (!link || seen.has(`${link.site}:${link.id}`)) continue;
    seen.add(`${link.site}:${link.id}`);
    out.push(link);
  }
  return out;
}

/** "species@item" of every member, sorted: two teams are the same team when these match. */
export const teamKey = (sets) => sets.map((s) => `${toID(s.species)}@${toID(s.item)}`).sort().join('|');
/** Same six species holding the same items. */
export const sameTeam = (a, b) => a.length === b.length && teamKey(a) === teamKey(b);

/**
 * Copies `from`'s spreads onto the members of `target` that have none, when the natures agree (a spread written
 * for another nature isn't that player's spread); an empty nature takes the paste's. Returns how many members got
 * one. Neither team needs to be in the same order.
 */
export function attachSpreads(target, from) {
  let n = 0;
  for (const s of target.sets) {
    if (s.evs) continue;
    const p = from.find((x) => toID(x.species) === toID(s.species));
    if (!p?.evs || (s.nature && p.nature && toID(s.nature) !== toID(p.nature))) continue;
    s.evs = p.evs;
    if (!s.nature && p.nature) s.nature = p.nature;
    n++;
  }
  return n;
}

/**
 * Every video in range from every channel. `load(kind, key)` returns the API's JSON text (or null):
 * 'youtube-channel' with a handle, 'youtube-playlist' with `playlistKey(...)`.
 */
export async function harvestVideos({ load, channels = CHANNELS, since = SINCE, maxVideos = MAX_VIDEOS, log = () => {} }) {
  const videos = [];
  let calls = 0;
  for (const handle of channels) {
    calls++;
    const cj = await load('youtube-channel', handle);
    const channel = cj ? readChannel(cj) : null;
    if (!channel) {
      log(`  youtube: channel @${handle} not found`);
      continue;
    }
    let token = '';
    let n = 0;
    for (;;) {
      calls++;
      const pj = await load('youtube-playlist', playlistKey(channel.uploads, token));
      if (!pj) break;
      const page = readPlaylistPage(pj, since);
      for (const v of page.videos) {
        if (n >= maxVideos) break;
        videos.push({ ...v, channel: channel.title || v.channel || handle });
        n++;
      }
      if (n >= maxVideos || page.reachedSince || !page.next) break;
      token = page.next;
    }
    log(`  youtube: @${handle} (${channel.title}): ${n} videos since ${since}`);
  }
  return { videos, calls };
}
