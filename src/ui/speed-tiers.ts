/**
 * "Speed tiers": the team being edited in turn order, at each member's real Level 50 Speed (and its Mega's), mixed
 * with the format's most used Pokémon from the usage data (most common spread, plus the max-Speed benchmark), with
 * toggles for Tailwind, Trick Room, Choice Scarf and one Speed stage. Click a member to see how it fares.
 *
 * An added "Meta speed list" view (off by default) lists the top 30 / 60 / 100 used Pokémon at Min, Max and Max
 * Nature+ with their usage, the team mixed in, a name filter, and opponent toggles (Icy Wind, Paralyzed, Scarf).
 */
import type { Dex } from '../domain/dex.ts';
import { REGULATION } from '../domain/regulation.ts';
import type { FoeToggles, MetaRow, SpeedEntry, SpeedToggles } from '../domain/speed-tiers.ts';
import { NO_FOE_TOGGLES, NO_TOGGLES, filterMeta, matchup, metaEntries, metaMatchup, metaSpeedList, speedTiers, teamEntries, threatEntries } from '../domain/speed-tiers.ts';
import type { PokemonSet } from '../domain/types.ts';
import { esc } from './dom.ts';
import { monIcon } from './icons.ts';

/** How many of the most used Pokémon to list. */
const THREATS = 40;
/** Top-N choices for the meta list; the middle one is the default. */
const META_SIZES = [30, 60, 100] as const;

type View = 'tiers' | 'meta';

export function openSpeedTiers(dex: Dex, team: readonly PokemonSet[]): void {
  const mine = teamEntries(team, dex);
  const entries: SpeedEntry[] = [...mine, ...threatEntries(dex, THREATS)];
  const usage = dex.usage;
  const t: SpeedToggles = { ...NO_TOGGLES };
  const f: FoeToggles = { ...NO_FOE_TOGGLES };
  let view: View = 'tiers';
  let size: number = META_SIZES[1];
  let query = '';
  let picked: string | null = null;

  const tiersIntro = `Level 50 Speed from each paste's nature and Stat Points, fastest first${usage ? `, against the ${THREATS} most used Pokémon (Smogon usage for ${esc(usage.month)}): their most common spread and the max-Speed benchmark` : ''}. Click one of your Pokémon to compare it.`;
  const metaIntro = (): string => `The ${size} most used Pokémon${usage ? ` (Smogon usage for ${esc(usage.month)})` : ''} at Level 50: Min is 0 Speed SP with a neutral nature, Max is 32 SP neutral, Max+ is 32 SP with a +Speed nature. Placed by Max+ (by Min under Trick Room), your team mixed in. Click one of your Pokémon to colour what it outspeeds.`;

  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="Speed tiers">
    <div class="modal-head"><h2>Speed tiers · ${esc(REGULATION.label)}</h2>
      <p id="st-intro">${tiersIntro}</p>
      ${usage ? `<div class="st-toggles mt-s"><label>View <select class="input sm" id="st-view"><option value="tiers" selected>Speed tiers</option><option value="meta">Meta speed list</option></select></label></div>` : ''}
      <div class="st-toggles mt-s">
        <label><input type="checkbox" data-t="tailwind"> Tailwind <span class="hint">(my team ×2)</span></label>
        <label><input type="checkbox" data-t="trickRoom"> Trick Room</label>
        <label><input type="checkbox" data-t="scarf"> Choice Scarf <span class="hint">(Scarf threats ×1.5)</span></label>
        <label>My Speed <select class="input sm" data-t="stage"><option value="-1">−1</option><option value="0" selected>±0</option><option value="1">+1</option></select></label>
      </div>
      <div class="st-toggles mt-s" id="st-meta-controls" hidden>
        <label>Top <select class="input sm" id="st-size">${META_SIZES.map((n) => `<option value="${n}"${n === size ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
        <span class="hint">Opponents:</span>
        <label><input type="checkbox" data-f="icyWind"> Icy Wind <span class="hint">(−1)</span></label>
        <label><input type="checkbox" data-f="paralyzed"> Paralyzed <span class="hint">(×0.5)</span></label>
        <label><input type="checkbox" data-f="scarf"> Choice Scarf <span class="hint">(all ×1.5)</span></label>
        <input class="input sm st-filter" id="st-filter" type="search" placeholder="Filter by name" aria-label="Filter Pokémon by name">
      </div></div>
    <div class="modal-body st-list" id="st-list"></div>
    <div class="modal-foot"><span class="hint tb-foot" id="st-summary"></span><button class="btn" id="st-close">Close</button></div></div>`;
  document.body.appendChild(overlay);
  const list = overlay.querySelector<HTMLElement>('#st-list')!;
  const summary = overlay.querySelector<HTMLElement>('#st-summary')!;
  const intro = overlay.querySelector<HTMLElement>('#st-intro')!;
  const metaControls = overlay.querySelector<HTMLElement>('#st-meta-controls')!;

  const drawTiers = (): void => {
    const rows = speedTiers(entries, t);
    list.innerHTML = rows.map((r) => `<div class="st-row${r.mine ? ' mine' : ''}${picked === r.key ? ' picked' : ''}"${r.mine ? ` data-key="${esc(r.key)}" role="button" tabindex="0"` : ''}>
        <span class="st-spe">${r.effective}${r.effective !== r.speed ? `<span class="hint"> (${r.speed})</span>` : ''}</span>
        ${monIcon(r.name, 'sm')}<span class="st-name"><b>${esc(r.name)}</b>${r.mine ? ' <span class="chip st-tag">Your team</span>' : ''}${r.scarf ? ' <span class="chip st-tag">Scarf</span>' : ''}${r.tie ? ' <span class="chip st-tag tie">Tie</span>' : ''}</span>
        <span class="st-spread">${esc(r.spread)}</span></div>`).join('') || '<p class="hint">No Pokémon on this team yet.</p>';
    const me = rows.find((r) => r.key === picked);
    if (me) {
      const m = matchup(rows, me.key, t);
      summary.textContent = `${me.name}: ${t.trickRoom ? 'moves before' : 'outspeeds'} ${m.outspeeds} · ties ${m.ties} · ${t.trickRoom ? 'moves after' : 'slower than'} ${m.slower} of the listed threats`;
    } else summary.textContent = t.trickRoom ? 'Trick Room: slowest moves first.' : '';
  };

  const drawMeta = (): void => {
    const all = metaSpeedList(mine, metaEntries(dex, size), t, f);
    const rows = filterMeta(all, query);
    const me = all.find((r) => r.key === picked && r.mine);
    // Against the picked member: does it move first (win), tie, or move after (lose)?
    const vs = (s: number): string => {
      if (!me) return '';
      const diff = t.trickRoom ? s - me.min : me.min - s;
      return diff > 0 ? ' st-win' : diff === 0 ? ' st-even' : ' st-lose';
    };
    const cell = (s: number, cls: string): string => `<span class="st-spe ${cls}${vs(s)}">${s}</span>`;
    const row = (r: MetaRow): string => r.mine
      ? `<div class="st-row st-meta mine${picked === r.key ? ' picked' : ''}" data-key="${esc(r.key)}" role="button" tabindex="0">
        <span class="st-use"></span>${monIcon(r.name, 'sm')}<span class="st-name"><b>${esc(r.name)}</b> <span class="chip st-tag">Your team</span></span>
        <span class="st-spe st-mine-spe">${r.min}</span><span class="st-spread st-common">${esc(r.spread)}</span></div>`
      : `<div class="st-row st-meta">
        <span class="st-use hint">${r.usage!.toFixed(1)}%</span>${monIcon(r.name, 'sm')}<span class="st-name"><b>${esc(r.name)}</b>${r.scarf ? ' <span class="chip st-tag">Scarf</span>' : ''}</span>
        ${cell(r.min, 'st-min')}${cell(r.max, 'st-max')}${cell(r.maxPlus, 'st-maxp')}
        <span class="st-spread st-common">${r.common ? `${r.common.speed} · ${esc(r.common.spread)}` : ''}</span></div>`;
    const head = `<div class="st-row st-meta st-head hint"><span class="st-use">Usage</span><span></span><span class="st-name">Pokémon</span><span class="st-spe">Min</span><span class="st-spe">Max</span><span class="st-spe">Max+</span><span class="st-spread st-common">Most common</span></div>`;
    list.innerHTML = rows.length ? head + rows.map(row).join('') : '<p class="hint">No Pokémon match.</p>';
    if (me) {
      const m = metaMatchup(all, me.key, t.trickRoom);
      summary.textContent = `${me.name} (${me.min}) ${t.trickRoom ? 'moves before' : 'outspeeds'} ${m.min} at Min · ${m.max} at Max · ${m.maxPlus} at Max+ of the ${m.of} listed`;
    } else summary.textContent = t.trickRoom ? 'Trick Room: slowest moves first.' : '';
  };

  const draw = (): void => {
    if (view === 'meta') drawMeta();
    else drawTiers();
  };

  const close = (): void => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#st-close')!.addEventListener('click', close);
  overlay.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-t]').forEach((el) => el.addEventListener('change', () => {
    const key = el.dataset.t;
    if (key === 'stage') t.stage = Number(el.value) as SpeedToggles['stage'];
    else if (key === 'tailwind' || key === 'trickRoom' || key === 'scarf') t[key] = (el as HTMLInputElement).checked;
    draw();
  }));
  overlay.querySelectorAll<HTMLInputElement>('[data-f]').forEach((el) => el.addEventListener('change', () => {
    const key = el.dataset.f;
    if (key === 'icyWind' || key === 'paralyzed' || key === 'scarf') f[key] = el.checked;
    draw();
  }));
  overlay.querySelector<HTMLSelectElement>('#st-view')?.addEventListener('change', (e) => {
    view = (e.target as HTMLSelectElement).value === 'meta' ? 'meta' : 'tiers';
    metaControls.hidden = view !== 'meta';
    // The meta list has more columns; the tiers view keeps its usual width.
    overlay.querySelector('.modal')!.classList.toggle('wide', view === 'meta');
    intro.innerHTML = view === 'meta' ? metaIntro() : tiersIntro;
    draw();
  });
  overlay.querySelector<HTMLSelectElement>('#st-size')!.addEventListener('change', (e) => {
    size = Number((e.target as HTMLSelectElement).value) || META_SIZES[1];
    intro.innerHTML = metaIntro();
    draw();
  });
  overlay.querySelector<HTMLInputElement>('#st-filter')!.addEventListener('input', (e) => { query = (e.target as HTMLInputElement).value; draw(); });
  const pick = (key: string | undefined): void => { if (key) { picked = picked === key ? null : key; draw(); } };
  list.addEventListener('click', (e) => pick((e.target as HTMLElement).closest<HTMLElement>('[data-key]')?.dataset.key));
  list.addEventListener('keydown', (e) => {
    const key = (e.target as HTMLElement).dataset.key;
    if ((e.key === 'Enter' || e.key === ' ') && key) { e.preventDefault(); pick(key); }
  });
  draw();
}
