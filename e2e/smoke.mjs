/**
 * End-to-end smoke test: drives the real app in Chromium.
 *
 *   npm run build && npm run preview &        # serves http://localhost:4173
 *   npx playwright install chromium           # once
 *   npm run test:e2e                          # BASE_URL=... to test another host
 *
 * It covers: creating a team and a gameplan, picking leads, editing a turn, turn results from the real
 * damage calculator (needs the app to be able to load it), export, reload persistence and import.
 * It also fails on any console error, which includes Content-Security-Policy violations.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4173';

const mine = `Rillaboom
Ability: Grassy Surge
EVs: 32 HP / 32 Atk / 2 Spe
Adamant Nature
- Fake Out

Garchomp
Ability: Rough Skin
EVs: 2 HP / 32 Atk / 32 Spe
Adamant Nature
- Earthquake`;
const theirs = `Incineroar
Ability: Intimidate
EVs: 32 HP / 32 Atk / 2 Spe
Adamant Nature
- Flare Blitz

Kingambit
Ability: Defiant
EVs: 32 HP / 32 Atk / 2 Spe
Adamant Nature
- Protect`;

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1700, height: 1000 } })).newPage();
const problems = [];
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

try {
  await page.goto(BASE_URL);
  await page.waitForSelector('.empty h2');

  // team
  await page.click('.empty button[data-act="new-team"]');
  await page.fill('#nt-name', 'Rain offense');
  await page.fill('#nt-paste', mine);
  await page.click('.modal-foot .btn.primary');
  await page.waitForSelector('#team-name');
  // The builder opens on the first Pokémon, with its Stat Points in the stat table.
  await page.waitForSelector('.slots .slot.on');
  assert.equal(await page.inputValue('.sp-in[data-stat="atk"]'), '32');
  // Pickers only offer legal moves: nothing in Champions can have Spore.
  await page.click('.move-in[data-move="3"]');
  await page.keyboard.type('spore');
  assert.equal(await page.locator('.pick-row').count(), 0);
  await page.keyboard.press('Escape');
  // Top builds adds the most common set as a new slot.
  await page.click('#top-builds');
  await page.fill('#tb-search', 'incineroar');
  await page.click('[data-add="Incineroar"]');
  await page.waitForSelector('.slot.on[title^="Incineroar"]');
  await page.click('[data-mode="paste"]');
  assert.match(await page.textContent('.mon-grid'), /SP 32 HP \/ 32 Atk \/ 2 Spe/);
  assert.match(await page.inputValue('#team-paste'), /Incineroar @ Sitrus Berry[\s\S]*- Fake Out/);

  // gameplan
  await page.click('.section-head button[data-act="new-plan"]');
  await page.fill('#np-name', 'Intimidate balance');
  await page.fill('#np-paste', theirs);
  await page.click('.modal-foot .btn.primary');
  await page.waitForSelector('#canvas');

  const pick = async (side, kind, i, name) => {
    await page.click(`[data-act="pick-slot"][data-side="${side}"][data-kind="${kind}"][data-i="${i}"]`);
    await page.click(`#ctx-menu button:has-text("${name}")`);
  };
  await pick('me', 'lead', 0, 'Rillaboom'); await pick('me', 'lead', 1, 'Garchomp');
  await pick('opp', 'lead', 0, 'Incineroar'); await pick('opp', 'lead', 1, 'Kingambit');

  // turn 1
  await page.click('.addbox.first');
  await page.waitForSelector('#drawer:not(.hidden)');
  assert.equal(await page.locator('.act-edit').count(), 4, 'a new turn is seeded with the four leads');
  // A Pokémon with moves in its paste gets a <select>; one without gets a text box.
  const setMove = async (i, move) => {
    const el = page.locator(`#a-move-${i}`);
    if (await el.evaluate((e) => e.tagName === 'SELECT')) await el.selectOption(move); else await el.fill(move);
  };
  await setMove(0, 'Fake Out'); await page.selectOption('#a-target-0', 'Incineroar');
  // Earthquake hits everyone around it: its target is fixed to "All" (only legal targets are offered).
  await setMove(1, 'Earthquake');
  await page.waitForFunction(() => document.querySelector('#a-target-1')?.disabled === true, null, { timeout: 30_000 });
  assert.equal(await page.inputValue('#a-target-1'), 'All');
  await setMove(2, 'Flare Blitz'); await page.selectOption('#a-target-2', 'Rillaboom');
  await setMove(3, 'Protect');
  await page.waitForSelector('.turn-result .hp-row', { timeout: 30_000 }); // first run downloads the calculator
  assert.match(await page.textContent('.turn-result'), /End of turn/);
  await page.click('.rerun');
  await page.waitForSelector('.turn-result .hp-row');

  // branch
  await page.click('[data-act="add-branch-child"]');
  await page.fill('#d-tag', 'If Incineroar Protects');
  await page.press('#d-tag', 'Enter');
  assert.equal(await page.locator('.turn').count(), 2);

  // export, reload, import
  await page.click('.topbar [data-act="export-plan"]');
  const exported = await page.inputValue('#exp');
  assert.equal(JSON.parse(exported).format, 'vgc-gameplan-planner');
  await page.click('.modal-foot .btn:has-text("Close")');

  await page.waitForTimeout(500); // saving is debounced
  await page.reload();
  await page.waitForSelector('#canvas');
  assert.equal(await page.locator('.turn').count(), 2, 'turns survive a reload');

  await page.click('.side-foot [data-act="import"]');
  await page.fill('#imp-text', exported);
  await page.click('.modal-foot .btn.primary');
  await page.waitForSelector('.toast');
  assert.match(await page.textContent('.toast'), /Imported 0 new teams and 1 gameplan/);

  assert.deepEqual(problems, [], 'no console errors or CSP violations');
  console.log('E2E OK');
} catch (error) {
  await page.screenshot({ path: 'e2e-failure.png' });
  console.error('E2E failed; screenshot saved to e2e-failure.png');
  throw error;
} finally {
  await browser.close();
}
