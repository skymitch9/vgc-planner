/**
 * "Speed tiers": the team being edited in turn order, at each member's real Level 50 Speed (and its Mega's), mixed
 * with the format's most used Pokémon from the usage data (most common spread, plus the max-Speed benchmark), with
 * toggles for Tailwind, Trick Room, Choice Scarf and one Speed stage. Click a member to see how it fares.
 */
import type { Dex } from '../domain/dex.ts';
import { REGULATION } from '../domain/regulation.ts';
import type { SpeedEntry, SpeedToggles } from '../domain/speed-tiers.ts';
import { NO_TOGGLES, matchup, speedTiers, teamEntries, threatEntries } from '../domain/speed-tiers.ts';
import type { PokemonSet } from '../domain/types.ts';
import { esc } from './dom.ts';
import { monIcon } from './icons.ts';

/** How many of the most used Pokémon to list. */
const THREATS = 40;

export function openSpeedTiers(dex: Dex, team: readonly PokemonSet[]): void {
  const entries: SpeedEntry[] = [...teamEntries(team, dex), ...threatEntries(dex, THREATS)];
  const usage = dex.usage;
  const t: SpeedToggles = { ...NO_TOGGLES };
  let picked: string | null = null;

  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="Speed tiers">
    <div class="modal-head"><h2>Speed tiers · ${esc(REGULATION.label)}</h2>
      <p>Level 50 Speed from each paste's nature and Stat Points, fastest first${usage ? `, against the ${THREATS} most used Pokémon (Smogon usage for ${esc(usage.month)}): their most common spread and the max-Speed benchmark` : ''}. Click one of your Pokémon to compare it.</p>
      <div class="st-toggles mt-s">
        <label><input type="checkbox" data-t="tailwind"> Tailwind <span class="hint">(my team ×2)</span></label>
        <label><input type="checkbox" data-t="trickRoom"> Trick Room</label>
        <label><input type="checkbox" data-t="scarf"> Choice Scarf <span class="hint">(Scarf threats ×1.5)</span></label>
        <label>My Speed <select class="input sm" data-t="stage"><option value="-1">−1</option><option value="0" selected>±0</option><option value="1">+1</option></select></label>
      </div></div>
    <div class="modal-body st-list" id="st-list"></div>
    <div class="modal-foot"><span class="hint tb-foot" id="st-summary"></span><button class="btn" id="st-close">Close</button></div></div>`;
  document.body.appendChild(overlay);
  const list = overlay.querySelector<HTMLElement>('#st-list')!;
  const summary = overlay.querySelector<HTMLElement>('#st-summary')!;

  const draw = (): void => {
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
  const pick = (key: string | undefined): void => { if (key) { picked = picked === key ? null : key; draw(); } };
  list.addEventListener('click', (e) => pick((e.target as HTMLElement).closest<HTMLElement>('[data-key]')?.dataset.key));
  list.addEventListener('keydown', (e) => {
    const key = (e.target as HTMLElement).dataset.key;
    if ((e.key === 'Enter' || e.key === ' ') && key) { e.preventDefault(); pick(key); }
  });
  draw();
}
