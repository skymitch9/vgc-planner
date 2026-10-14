/**
 * "Optimize SPs": a dialog on one Pokémon of the team that finds the fewest Stat Points to KO a chosen target, or to
 * survive its attack, and can write the result into the team's paste. It is an additive tool: nothing changes until
 * the Apply button is pressed, and Apply can be undone from the toast that follows.
 */
import type { Dex } from '../domain/dex.ts';
import { toID } from '../domain/dex.ts';
import { clearEstimated, oppMons } from '../domain/model.ts';
import { parseShowdown } from '../domain/showdown.ts';
import type { OptimizeResult, OptimizerField, Preset } from '../domain/sp-optimizer.ts';
import { PRESET_LABEL, evsLine, minSpToKO, minSpToSurvive, presetSet, rewriteSpread } from '../domain/sp-optimizer.ts';
import { STAT_KEYS, STAT_LABEL } from '../domain/stats.ts';
import type { PokemonSet, Team } from '../domain/types.ts';
import { simService, store } from '../state/instance.ts';
import { requestRender } from './bus.ts';
import { MOVE_HEADER, moveOptions, speciesOptions } from './builder-html.ts';
import { esc, must, qs } from './dom.ts';
import { toast, toastAction } from './overlays.ts';
import { attachPicker } from './picker.ts';

type Mode = 'ko' | 'survive';

interface PlanTarget { label: string; set: PokemonSet }

const WEATHERS = ['Sun', 'Rain', 'Sand', 'Snow'] as const;
const TERRAINS = ['Electric', 'Grassy', 'Psychic', 'Misty'] as const;
const FIELD_CHECKS: readonly [keyof OptimizerField, string, string][] = [
  ['spreadBothTargets', 'Spread moves hit both foes', 'A move that hits several Pokémon does 0.75× when it hits two'],
  ['helpingHand', 'Helping Hand', 'The attacker is boosted by Helping Hand'],
  ['reflect', 'Reflect', 'On the defender’s side'],
  ['lightScreen', 'Light Screen', 'On the defender’s side'],
  ['auroraVeil', 'Aurora Veil', 'On the defender’s side'],
  ['friendGuard', 'Friend Guard', 'The defender’s partner has Friend Guard'],
];

const damaging = (dex: Dex, moves: readonly string[]): string[] => moves.filter((m) => {
  const info = dex.move(m);
  return info ? info.category !== 'Status' : false;
});

const signed = (n: number): string => (n > 0 ? `+${n}` : `−${-n}`);

/** The Pokémon in the team's gameplans' opponent pastes, one entry per distinct set. */
function planTargets(team: Team): PlanTarget[] {
  const seen = new Set<string>();
  const out: PlanTarget[] = [];
  for (const plan of team.plans) {
    for (const set of oppMons(plan)) {
      const key = JSON.stringify([set.species, set.item, set.ability, set.nature, set.evs, set.moves]);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ label: `${set.species}${set.item ? ` @ ${set.item}` : ''} · ${plan.name || 'gameplan'}`, set });
    }
  }
  return out;
}

export function openSpOptimizer(dex: Dex, team: Team, slot: number): void {
  const mine = parseShowdown(team.paste)[slot];
  if (!mine) return;
  const targets = planTargets(team);
  const state = {
    mode: 'ko' as Mode,
    source: targets.length ? 'plan:0' : 'species',
    species: '',
    preset: 'bulk' as Preset,
    pasted: '',
    move: damaging(dex, mine.moves)[0] ?? '',
    hits: 1 as 1 | 2,
    roll: 'guaranteed' as 'guaranteed' | 'average',
    keepCurrent: true,
    allowNature: false,
    asMega: true,
    field: { spreadBothTargets: true } as OptimizerField,
  };
  let result: OptimizeResult | null = null;

  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `<div class="modal wide spo" role="dialog" aria-modal="true" aria-label="Optimize Stat Points">
    <div class="modal-head"><h2>Optimize Stat Points · ${esc(mine.species)}</h2>
      <p>Finds the fewest Stat Points for ${esc(mine.species)} to KO a target, or to survive its attack. Nothing changes until you press Apply.</p></div>
    <div class="modal-body">
      <div class="spo-row">
        <div class="seg" role="tablist">
          <button class="seg-btn on" data-spo-mode="ko" role="tab">KO a target</button>
          <button class="seg-btn" data-spo-mode="survive" role="tab">Survive a hit</button>
        </div>
      </div>
      <div class="spo-grid">
        <div><label class="lbl" for="spo-src">Target</label>
          <select id="spo-src" class="input">
            ${targets.length ? `<optgroup label="From this team’s gameplans">${targets.map((t, i) => `<option value="plan:${i}">${esc(t.label)}</option>`).join('')}</optgroup>` : ''}
            <option value="species"${targets.length ? '' : ' selected'}>Type a species…</option>
            <option value="paste">Paste a set…</option>
          </select></div>
        <div data-spo-show="species"><label class="lbl" for="spo-species">Species</label><input id="spo-species" class="input" placeholder="Search Pokémon…" autocomplete="off"></div>
        <div data-spo-show="species"><label class="lbl" for="spo-preset">Its spread</label>
          <select id="spo-preset" class="input">${(Object.keys(PRESET_LABEL) as Preset[]).map((p) => `<option value="${p}"${p === state.preset ? ' selected' : ''}>${esc(PRESET_LABEL[p])}</option>`).join('')}</select></div>
        <div><label class="lbl" for="spo-move" id="spo-move-lbl">Move</label><input id="spo-move" class="input" value="${esc(state.move)}" placeholder="Pick a move…" autocomplete="off"></div>
        <div><label class="lbl" for="spo-hits">Hits</label><select id="spo-hits" class="input"><option value="1">1 hit</option><option value="2">2 hits</option></select></div>
        <div><label class="lbl" for="spo-roll">Damage roll</label><select id="spo-roll" class="input">
          <option value="guaranteed" id="spo-roll-g">Guaranteed (every roll)</option><option value="average">Average roll</option></select></div>
        <div><label class="lbl" for="spo-weather">Weather</label><select id="spo-weather" class="input"><option value="">None</option>${WEATHERS.map((w) => `<option>${w}</option>`).join('')}</select></div>
        <div><label class="lbl" for="spo-terrain">Terrain</label><select id="spo-terrain" class="input"><option value="">None</option>${TERRAINS.map((t) => `<option>${t}</option>`).join('')}</select></div>
      </div>
      <div data-spo-show="paste"><label class="lbl" for="spo-paste">Target set (Showdown format)</label>
        <textarea id="spo-paste" class="paste spo-paste" placeholder="Paste one Pokémon, e.g.&#10;Incineroar @ Sitrus Berry&#10;Ability: Intimidate&#10;EVs: 32 HP / 2 Def / 32 SpD&#10;Careful Nature&#10;- Flare Blitz"></textarea></div>
      <div class="spo-checks">
        <label class="oc-check" title="Start from the current Stat Points and only add; off: search the stat(s) from 0"><input type="checkbox" id="spo-keep" checked> Keep current SPs</label>
        <label class="oc-check" title="Also try the nature that raises the searched stat; it is used only when it saves Stat Points"><input type="checkbox" id="spo-nature"> Allow a nature change</label>
        <label class="oc-check" title="A Pokémon holding its Mega Stone is calculated as its Mega"><input type="checkbox" id="spo-mega" checked> Megas as Megas</label>
        ${FIELD_CHECKS.map(([key, label, title]) => `<label class="oc-check" title="${esc(title)}"><input type="checkbox" data-spo-field="${key}"${state.field[key] ? ' checked' : ''}> ${esc(label)}</label>`).join('')}
      </div>
      <div class="btn-row"><button class="btn primary" id="spo-run">Optimize</button><span class="hint" id="spo-time"></span></div>
      <div id="spo-result" class="spo-result" aria-live="polite"></div>
    </div>
    <div class="modal-foot"><button class="btn" id="spo-close">Close</button><button class="btn primary" id="spo-apply" disabled>Apply to ${esc(mine.species)}</button></div></div>`;
  document.body.appendChild(overlay);

  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') close(); };
  const close = (): void => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  must('#spo-close', overlay).addEventListener('click', close);

  const resultBox = must('#spo-result', overlay);
  const applyBtn = must<HTMLButtonElement>('#spo-apply', overlay);
  const clearResult = (): void => { result = null; resultBox.innerHTML = ''; must('#spo-time', overlay).textContent = ''; applyBtn.disabled = true; };

  /** The opponent-side set picked as the target, or a message saying what is missing. */
  const targetSet = (): PokemonSet | string => {
    if (state.source.startsWith('plan:')) return targets[Number(state.source.slice(5))]?.set ?? 'Pick a target.';
    if (state.source === 'paste') return parseShowdown(state.pasted)[0] ?? 'Paste the target’s set first.';
    const species = dex.species(state.species);
    if (!species) return 'Type the target’s species first.';
    const category = dex.move(state.move)?.category === 'Special' ? 'Special' : 'Physical';
    return presetSet(species.name, state.preset, category);
  };
  /** The Pokémon whose moves are offered: this one when it attacks, the target when it does. */
  const attackerSet = (): PokemonSet | null => {
    if (state.mode === 'ko') return mine;
    const t = targetSet();
    return typeof t === 'string' ? null : t;
  };
  const defaultMove = (): void => {
    const a = attackerSet();
    state.move = a ? damaging(dex, a.moves)[0] ?? '' : '';
    must<HTMLInputElement>('#spo-move', overlay).value = state.move;
  };

  const sync = (): void => {
    overlay.querySelectorAll<HTMLElement>('[data-spo-show]').forEach((el) => { el.hidden = el.dataset.spoShow !== state.source; });
    overlay.querySelectorAll<HTMLButtonElement>('[data-spo-mode]').forEach((b) => b.classList.toggle('on', b.dataset.spoMode === state.mode));
    must('#spo-move-lbl', overlay).textContent = state.mode === 'ko' ? `${mine.species}’s move` : 'The target’s move';
    must('#spo-roll-g', overlay).textContent = state.mode === 'ko' ? 'Guaranteed KO (lowest roll)' : 'Guaranteed survival (highest roll)';
  };

  overlay.querySelectorAll<HTMLButtonElement>('[data-spo-mode]').forEach((b) => b.addEventListener('click', () => {
    state.mode = b.dataset.spoMode === 'survive' ? 'survive' : 'ko';
    // A typed target defends with max bulk, or attacks with max offence.
    state.preset = state.mode === 'ko' ? 'bulk' : 'offence';
    must<HTMLSelectElement>('#spo-preset', overlay).value = state.preset;
    defaultMove();
    clearResult();
    sync();
  }));
  must<HTMLSelectElement>('#spo-src', overlay).addEventListener('change', (e) => {
    state.source = (e.target as HTMLSelectElement).value;
    if (state.mode === 'survive') defaultMove();
    clearResult();
    sync();
  });
  attachPicker(must<HTMLInputElement>('#spo-species', overlay), {
    options: () => speciesOptions(dex),
    onPick: (name) => { state.species = name; if (state.mode === 'survive') defaultMove(); clearResult(); },
  });
  must<HTMLSelectElement>('#spo-preset', overlay).addEventListener('change', (e) => { state.preset = (e.target as HTMLSelectElement).value as Preset; clearResult(); });
  must<HTMLTextAreaElement>('#spo-paste', overlay).addEventListener('input', (e) => {
    state.pasted = (e.target as HTMLTextAreaElement).value;
    if (state.mode === 'survive' && !state.move) defaultMove();
    clearResult();
  });
  attachPicker(must<HTMLInputElement>('#spo-move', overlay), {
    header: MOVE_HEADER,
    options: () => {
      const a = attackerSet();
      const species = a ? dex.species(a.species) : null;
      if (!species) return [];
      const own = new Set(a!.moves.map(toID));
      const all = moveOptions(dex, species, []).filter((o) => dex.move(o.value)?.category !== 'Status');
      // Its own moves first.
      return [...all.filter((o) => own.has(toID(o.value))).map((o) => ({ ...o, group: 'On this set' })), ...all.filter((o) => !own.has(toID(o.value)))];
    },
    onPick: (move) => { state.move = move; clearResult(); },
  });
  must<HTMLSelectElement>('#spo-hits', overlay).addEventListener('change', (e) => { state.hits = (e.target as HTMLSelectElement).value === '2' ? 2 : 1; clearResult(); });
  must<HTMLSelectElement>('#spo-roll', overlay).addEventListener('change', (e) => { state.roll = (e.target as HTMLSelectElement).value === 'average' ? 'average' : 'guaranteed'; clearResult(); });
  must<HTMLSelectElement>('#spo-weather', overlay).addEventListener('change', (e) => {
    const v = (e.target as HTMLSelectElement).value;
    state.field.weather = (WEATHERS as readonly string[]).includes(v) ? (v as OptimizerField['weather']) : undefined;
    clearResult();
  });
  must<HTMLSelectElement>('#spo-terrain', overlay).addEventListener('change', (e) => {
    const v = (e.target as HTMLSelectElement).value;
    state.field.terrain = (TERRAINS as readonly string[]).includes(v) ? (v as OptimizerField['terrain']) : undefined;
    clearResult();
  });
  must<HTMLInputElement>('#spo-keep', overlay).addEventListener('change', (e) => { state.keepCurrent = (e.target as HTMLInputElement).checked; clearResult(); });
  must<HTMLInputElement>('#spo-nature', overlay).addEventListener('change', (e) => { state.allowNature = (e.target as HTMLInputElement).checked; clearResult(); });
  must<HTMLInputElement>('#spo-mega', overlay).addEventListener('change', (e) => { state.asMega = (e.target as HTMLInputElement).checked; clearResult(); });
  overlay.querySelectorAll<HTMLInputElement>('[data-spo-field]').forEach((box) => box.addEventListener('change', () => {
    const key = box.dataset.spoField as keyof OptimizerField;
    (state.field as Record<string, unknown>)[key] = box.checked;
    clearResult();
  }));

  const runBtn = must<HTMLButtonElement>('#spo-run', overlay);
  runBtn.addEventListener('click', () => {
    const target = targetSet();
    if (typeof target === 'string') { toast(target, true); return; }
    if (!state.move) { toast('Pick a move first.', true); return; }
    runBtn.disabled = true;
    runBtn.textContent = 'Working…';
    void simService.ready().then((engine) => {
      const query = {
        attacker: state.mode === 'ko' ? mine : target,
        defender: state.mode === 'ko' ? target : mine,
        move: state.move, field: { ...state.field }, hits: state.hits,
        rolls: state.roll === 'average' ? 'avg' as const : state.mode === 'ko' ? 'min' as const : 'max' as const,
        keepCurrent: state.keepCurrent, allowNature: state.allowNature, asMega: state.asMega,
      };
      const t0 = performance.now();
      result = state.mode === 'ko' ? minSpToKO(engine, query) : minSpToSurvive(engine, query);
      must('#spo-time', overlay).textContent = `Worked out in ${Math.round(performance.now() - t0)} ms`;
      resultBox.innerHTML = resultHTML(result, mine, target, state.mode);
      applyBtn.disabled = !result.ok || (!result.natureChange && STAT_KEYS.every((k) => result!.added[k] === 0));
    }, (e: unknown) => {
      resultBox.innerHTML = `<div class="warn">${esc(e instanceof Error ? e.message : String(e))}</div>`;
    }).finally(() => { runBtn.disabled = false; runBtn.textContent = 'Optimize'; });
  });

  applyBtn.addEventListener('click', () => {
    if (!result?.ok) return;
    const before = { paste: team.paste, estimated: team.estimatedSpreads ? [...team.estimatedSpreads] : undefined };
    try {
      team.paste = rewriteSpread(team.paste, slot, result.spread, result.natureChange ? result.nature : undefined);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), true);
      return;
    }
    clearEstimated(team, [mine.species]);
    store.persist();
    requestRender();
    close();
    toastAction(`New spread applied to ${mine.species}`, 'Undo', () => {
      team.paste = before.paste;
      if (before.estimated) team.estimatedSpreads = before.estimated;
      store.persist();
      requestRender();
    });
  });

  sync();
  (qs<HTMLElement>(state.source === 'species' ? '#spo-species' : '#spo-run', overlay))?.focus();
}

function resultHTML(r: OptimizeResult, mine: PokemonSet, target: PokemonSet, mode: Mode): string {
  const changes = STAT_KEYS.filter((k) => r.added[k] !== 0).map((k) => `<span class="spo-chg${r.added[k] > 0 ? ' up' : ' down'}">${signed(r.added[k])} ${STAT_LABEL[k]}</span>`);
  if (r.natureChange) changes.push(`<span class="spo-chg">${esc(r.natureChange.from || 'no nature')} → ${esc(r.natureChange.to)}</span>`);
  const pct = (p: [number, number]): string => `${p[0]}–${p[1]}%`;
  const chance = (c: number): string => `${Math.round(c * 1000) / 10}%`;
  const who = mode === 'ko' ? `${mine.species} → ${target.species}` : `${target.species} → ${mine.species}`;
  const line = evsLine(r.spread) || 'EVs: none';
  return `<div class="${r.ok ? 'spo-ok' : 'warn'}">${esc(r.note)}</div>
    ${r.ok ? `<div class="spo-out"><div><span class="lbl">New spread</span><code class="k spo-line">${esc(line)}</code>${r.natureChange ? ` <code class="k spo-line">${esc(r.nature)} Nature</code>` : ''}</div>
      <div><span class="lbl">Change</span>${changes.length ? changes.join(' ') : '<span class="hint">none: the current spread already does it</span>'}</div>` : '<div class="spo-out">'}
      <div><span class="lbl">Damage per hit (${esc(who)})</span>${esc(pct(r.beforePct))} now${r.ok ? ` → <b>${esc(pct(r.rollPct))}</b>` : ` → at best ${esc(pct(r.rollPct))}`}
        <span class="hint"> · KO chance ${esc(chance(r.beforeKoChance))} → ${esc(chance(r.koChance))}</span></div></div>`;
}
