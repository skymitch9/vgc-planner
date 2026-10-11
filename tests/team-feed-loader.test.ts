import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { checkFeedUrl, fetchFeedPaste, loadFeed } from '../src/infra/team-feed.ts';

const FEED = readFileSync(new URL('./fixtures/team-feed.json', import.meta.url), 'utf8');

/** A fetch that answers from a function and counts its calls. */
function fakeFetch(answer: (url: string) => Response | Promise<Response>): typeof fetch & { calls: string[] } {
  const calls: string[] = [];
  const fn = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    return answer(url);
  }) as typeof fetch & { calls: string[] };
  fn.calls = calls;
  return fn;
}

test('checks the feed address before fetching anything', () => {
  assert.equal(checkFeedUrl(' https://teams.example/feed.json '), 'https://teams.example/feed.json');
  assert.throws(() => checkFeedUrl(''), /Enter the address/);
  assert.throws(() => checkFeedUrl('not a url'), /isn't a web address/);
  assert.throws(() => checkFeedUrl('ftp://teams.example/feed.json'), /must start with https/);
});

test('loads and validates a feed once per session, and again when asked', async () => {
  const fetchFn = fakeFetch(() => new Response(FEED, { status: 200 }));
  const url = 'https://cache.example/feed.json';
  const feed = await loadFeed(url, { fetchFn });
  assert.equal(feed.entries.length, 5);
  await loadFeed(url, { fetchFn });
  assert.equal(fetchFn.calls.length, 1, 'cached');
  await loadFeed(url, { fetchFn, fresh: true });
  assert.equal(fetchFn.calls.length, 2, 'fresh downloads again');
});

test('feed failures are sentences, not bare status codes, and are not cached', async () => {
  const url = 'https://fail.example/feed.json';
  await assert.rejects(loadFeed(url, { fetchFn: fakeFetch(() => new Response('nope', { status: 404 })) }), /The feed at https:\/\/fail\.example\/feed\.json answered 404: there is nothing at that address/);
  await assert.rejects(loadFeed(url, { fetchFn: fakeFetch(() => new Response('', { status: 503 })) }), /answered 503: the site that hosts it has a problem/);
  await assert.rejects(loadFeed(url, { fetchFn: fakeFetch(() => new Response('', { status: 403 })) }), /answered 403: the site refused/);
  await assert.rejects(loadFeed(url, { fetchFn: fakeFetch(() => new Response('<html>hi</html>', { status: 200 })) }), /didn't return JSON/);
  await assert.rejects(loadFeed(url, { fetchFn: fakeFetch(() => new Response('{"hello":1}', { status: 200 })) }), /didn't return a team feed/);
  await assert.rejects(loadFeed(url, { fetchFn: fakeFetch(() => { throw new TypeError('Failed to fetch'); }) }), /Couldn't reach fail\.example/);
  await assert.rejects(loadFeed(url, { fetchFn: fakeFetch(() => { throw new DOMException('timed out', 'TimeoutError'); }) }), /didn't answer within 15 seconds/);
  // After all those failures a good answer still gets through: failures were not cached.
  assert.equal((await loadFeed(url, { fetchFn: fakeFetch(() => new Response(FEED)) })).entries.length, 5);
});

test('fetches a paste as text, size-capped', async () => {
  assert.equal(await fetchFeedPaste('https://t.example/p.txt', fakeFetch(() => new Response('Rillaboom\r\n- Fake Out\r\n'))), 'Rillaboom\n- Fake Out');
  await assert.rejects(fetchFeedPaste('https://t.example/p.txt', fakeFetch(() => new Response('x'.repeat(20_001)))), /too large/);
  await assert.rejects(fetchFeedPaste('https://t.example/p.txt', fakeFetch(() => new Response('  '))), /empty/);
  await assert.rejects(fetchFeedPaste('https://t.example/p.txt', fakeFetch(() => new Response('', { status: 404 }))), /This team's paste answered 404/);
});
