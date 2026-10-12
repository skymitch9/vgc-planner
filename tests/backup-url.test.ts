import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildExport, mergeImport, readExport } from '../src/domain/codec.ts';
import { newPlan, newTeam } from '../src/domain/model.ts';
import { checkBackupUrl, fetchBackup, readImportLink } from '../src/infra/backup-url.ts';

/** A backup of one team with one gameplan, as the app's Export writes it. */
function backupText(): string {
  const team = newTeam('Rain', 'Pelipper @ Damp Rock\nAbility: Drizzle\n- Hurricane');
  team.plans.push(newPlan('vs Sun'));
  return JSON.stringify(buildExport({ teams: [team] }, { type: 'all' }), null, 2);
}

/** A fetch that answers from a function and records what it was asked. */
function fakeFetch(answer: (url: string) => Response | Promise<Response>): typeof fetch & { calls: { url: string; init?: RequestInit }[] } {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return answer(String(input));
  }) as typeof fetch & { calls: { url: string; init?: RequestInit }[] };
  fn.calls = calls;
  return fn;
}

test('checks a backup address before fetching anything: http(s) only', () => {
  assert.equal(checkBackupUrl(' https://files.example/backup.json '), 'https://files.example/backup.json');
  assert.equal(checkBackupUrl('http://192.168.1.20:8080/teams.json'), 'http://192.168.1.20:8080/teams.json');
  assert.throws(() => checkBackupUrl(''), /Enter the address of a backup/);
  assert.throws(() => checkBackupUrl('backup.json'), /isn't a web address/);
  assert.throws(() => checkBackupUrl('ftp://files.example/backup.json'), /must start with https/);
  assert.throws(() => checkBackupUrl('javascript:alert(1)'), /must start with https/);
  assert.throws(() => checkBackupUrl('file:///C:/backup.json'), /must start with https/);
  assert.throws(() => checkBackupUrl('data:application/json,{}'), /must start with https/);
  assert.throws(() => checkBackupUrl('https://me:secret@files.example/backup.json'), /user name or password/);
});

test('fetches a backup without cookies or referrer and returns text the codec accepts', async () => {
  const text = backupText();
  const fetchFn = fakeFetch(() => new Response(text, { headers: { 'content-type': 'application/json' } }));
  const got = await fetchBackup('https://files.example/backup.json', fetchFn);
  assert.equal(got, text);
  assert.equal(fetchFn.calls.length, 1);
  const init = fetchFn.calls[0]!.init!;
  assert.equal(init.credentials, 'omit');
  assert.equal(init.referrerPolicy, 'no-referrer');
  assert.ok(init.signal, 'the request has a timeout');
  // The same text merges exactly like a chosen file would.
  const library = { teams: [] };
  const summary = mergeImport(library, readExport(JSON.parse(got)));
  assert.equal(summary.newTeams, 1);
  assert.equal(summary.plans, 1);
});

test('a bad address is refused before any request is made', async () => {
  const fetchFn = fakeFetch(() => new Response(backupText()));
  await assert.rejects(fetchBackup('ftp://files.example/backup.json', fetchFn), /must start with https/);
  assert.equal(fetchFn.calls.length, 0);
});

test('HTTP errors are worded with the host, never a bare status code', async () => {
  const url = 'https://files.example:8443/missing.json';
  const answering = (status: number) => fakeFetch(() => new Response('nope', { status }));
  await assert.rejects(fetchBackup(url, answering(404)), /^Error: The server at files\.example:8443 answered 404 \(not found\)\. Check the address/);
  await assert.rejects(fetchBackup(url, answering(410)), /answered 410 \(gone\)/);
  await assert.rejects(fetchBackup(url, answering(403)), /answered 403 \(access refused\)\.$/);
  await assert.rejects(fetchBackup(url, answering(503)), /answered 503 \(unavailable\)\. Try again later/);
  await assert.rejects(fetchBackup(url, answering(599)), /answered 599 \(server error\)/);
  await assert.rejects(fetchBackup(url, answering(418)), /answered 418 \(request refused\)/);
});

test('network failures and timeouts are worded', async () => {
  const url = 'https://files.example/backup.json';
  await assert.rejects(fetchBackup(url, fakeFetch(() => { throw new TypeError('Failed to fetch'); })), /The server at files\.example could not be reached/);
  await assert.rejects(fetchBackup(url, fakeFetch(() => { throw new DOMException('timed out', 'TimeoutError'); })), /didn't answer within 15 seconds/);
});

test('anything that is not a backup is refused with why', async () => {
  const url = 'https://files.example/page';
  const answering = (body: string) => fakeFetch(() => new Response(body));
  await assert.rejects(fetchBackup(url, answering('<!doctype html><p>Hello</p>')), /is not a planner backup: it isn't JSON/);
  await assert.rejects(fetchBackup(url, answering('')), /is not a planner backup: it isn't JSON/);
  await assert.rejects(fetchBackup(url, answering('{"hello":1}')), /is not a planner backup\. Unrecognized file/);
  await assert.rejects(fetchBackup(url, answering('[1,2,3]')), /is not a planner backup/);
});

test('oversized answers are refused, by declared length or while reading', async () => {
  const url = 'https://files.example/huge.json';
  const big = ' '.repeat(2_000_001);
  await assert.rejects(fetchBackup(url, fakeFetch(() => new Response('{}', { headers: { 'content-length': '5000000' } }))), /too large to be a backup \(2 MB at most\)/);
  // No length declared (a streamed answer): the cap applies while the body is read.
  const streamed = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode(big)); controller.close(); },
  });
  await assert.rejects(fetchBackup(url, fakeFetch(() => new Response(streamed))), /too large to be a backup/);
  // Right at the cap is still fine to read (then judged on its content).
  await assert.rejects(fetchBackup(url, fakeFetch(() => new Response(' '.repeat(2_000_000)))), /isn't JSON/);
});

test('reads ?import=<url> from the page address and gives the address without it', () => {
  const backup = 'https://files.example/backup.json?v=2&x=1';
  assert.deepEqual(readImportLink(`https://planner.example/?import=${encodeURIComponent(backup)}`), { url: backup, cleaned: '/' });
  assert.deepEqual(
    readImportLink(`https://planner.example/app/?share=abc&import=${encodeURIComponent('http://10.0.0.5:3000/b.json')}#top`),
    { url: 'http://10.0.0.5:3000/b.json', cleaned: '/app/?share=abc#top' },
    'other parameters and the hash are kept',
  );
  assert.equal(readImportLink('https://planner.example/?share=abc'), null, 'no parameter: nothing to do');
  assert.equal(readImportLink('https://planner.example/'), null);
  // Anything that isn't http(s) is ignored (url null) but still taken out of the address bar.
  assert.deepEqual(readImportLink(`https://planner.example/?import=${encodeURIComponent('javascript:alert(1)')}`), { url: null, cleaned: '/' });
  assert.deepEqual(readImportLink('https://planner.example/?import=file:///etc/passwd'), { url: null, cleaned: '/' });
  assert.deepEqual(readImportLink('https://planner.example/?import='), { url: null, cleaned: '/' });
  assert.deepEqual(readImportLink('https://planner.example/?import=not%20a%20url&a=1'), { url: null, cleaned: '/?a=1' });
});
