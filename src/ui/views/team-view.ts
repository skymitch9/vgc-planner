import type { Dex, DexSpecies } from '../../domain/dex.ts';
import { emptySet, setFromUsage, setProblems, spOf, spreadLine, teamProblems, toID, writeTeam } from '../../domain/dex.ts';
import { cleanSelections, clearEstimated, countPlanTurns, setEstimated, oppMons, teamMons } from '../../domain/model.ts';
import { REGULATION } from '../../domain/regulation.ts';
import { parseShowdown, teamWarnings } from '../../domain/showdown.ts';
import { STAT_KEYS, STAT_LABEL, calcStats, spreadText, statPoints } from '../../domain/stats.ts';
import type { PokemonSet, StatKey, StatTable, Team } from '../../domain/types.ts';
import { currentDex, loadDex } from '../../infra/dex-loader.ts';
import { store } from '../../state/instance.ts';
import { requestRender } from '../bus.ts';
import { moveLabel } from '../move-type.ts';
import { MOVE_HEADER, itemOptions, monLabel, moveOptions, pct, speciesOptions, typeChip } from '../builder-html.ts';
import { esc, must, qs } from '../dom.ts';
import { extLinksHTML } from '../ext-links.ts';
import { itemIcon, monIcon } from '../icons.ts';
import { openMenu, toast } from '../overlays.ts';
import { PASTE_LINK_HINT } from '../paste-links.ts';
import { attachPicker } from '../picker.ts';
import { createPlanFrom } from '../actions.ts';
import { openTopBuilds } from '../top-builds.ts';
import { boxEstimates, estimatedToast, openTopTeams, topTeamsButton } from '../top-teams.ts';
import { renderNav } from './sidebar.ts';

type Mode = 'builder' | 'paste';
/** View state that doesn't need saving: which slot is open and which tab of the Team section. */
const view = { teamId: '', slot: 0, mode: 'builder' as Mode, estimated: new Set<string>() };

const EST_CHIP = '<span class="est-chip" title="Filled in from Smogon usage: the team was published without this spread. Edit its Stat Points to make it your own.">Estimated spread</span>';

function save(team: Team, sets: PokemonSet[]): void {
  team.paste = writeTeam(sets);
  clearEstimated(team, []);
  cleanSelections(team.plans, 'me', sets);
  store.persist();
  requestRender();
}

// ---- Read-only card (paste mode, or before the data has loaded) ------------------------------------------------

function monCard(m: PokemonSet): string {
  const sp = statPoints(m);
  return `<div class="mon-card">${monIcon(m.species)}<div class="meta">
    <div class="sp">${esc(m.nickname ? `${m.nickname} (${m.species})` : m.species)}</div>
    ${view.estimated.has(m.species) ? `<div class="sub">${EST_CHIP}</div>` : ''}
    <div class="sub">${m.item ? itemIcon(m.item, 'xs') + esc(m.item) : '<span class="muted">No item</span>'}</div>
    ${m.ability ? `<div class="sub">${esc(m.ability)}</div>` : ''}
    ${sp ? `<div class="sub" title="Champions Stat Points (max 32 per stat, 66 total)">SP ${esc(spreadText(sp.sp))}${sp.converted ? ' (from EVs)' : ''}</div>` : ''}
    ${m.moves.length ? `<div class="moves">${m.moves.map((x) => moveLabel(x)).join(' · ')}</div>` : ''}</div></div>`;
}

// ---- Builder ----------------------------------------------------------------------------------------------------

function slotsHTML(sets: PokemonSet[], dex: Dex): string {
  const cells = Array.from({ length: REGULATION.teamSize }, (_, i) => {
    const s = sets[i];
    if (!s) return i === sets.length
      ? `<button class="slot empty${view.slot === i ? ' on' : ''}" data-slot="${i}">+ Add Pokémon</button>`
      : `<div class="slot ghost"></div>`;
    const bad = setProblems(s, dex).length > 0;
    return `<button class="slot${view.slot === i ? ' on' : ''}${bad ? ' bad' : ''}" data-slot="${i}" title="${esc(s.species)}${bad ? ': has rule problems' : ''}">${monLabel(s.species, s.item)}${view.estimated.has(s.species) ? EST_CHIP : ''}</button>`;
  });
  return `<div class="slots">${cells.join('')}</div>`;
}

function natureOptions(dex: Dex, current: string): string {
  const label = (n: { name: string; plus?: StatKey; minus?: StatKey }): string =>
    n.plus && n.minus && n.plus !== n.minus ? `${n.name} (+${STAT_LABEL[n.plus]}, −${STAT_LABEL[n.minus]})` : `${n.name}`;
  return [...dex.data.natures].sort((a, b) => a.name.localeCompare(b.name))
    .map((n) => `<option value="${esc(n.name)}"${toID(n.name) === toID(current) ? ' selected' : ''}>${esc(label(n))}</option>`).join('');
}

function statTable(set: PokemonSet, species: DexSpecies, dex: Dex): string {
  // Pastes with real EVs are shown as the Stat Points they convert to.
  const sp = statPoints(set)?.sp ?? spOf(set);
  const nature = dex.nature(set.nature)?.name ?? '';
  const stats = calcStats(species.baseStats, sp, nature);
  const mega = dex.megaFor(species, set.item);
  const megaStats = mega ? calcStats(mega.baseStats, sp, nature) : null;
  const total = STAT_KEYS.reduce((a, k) => a + sp[k], 0);
  const { maxSpPerStat, maxSpTotal } = dex.data.rules;
  const n = dex.nature(nature);
  const mark = (k: StatKey): string => (n?.plus === k && n.minus !== k ? ' up' : n?.minus === k && n.plus !== k ? ' down' : '');
  const maxBase = 200;
  return `<table class="stat-table"><thead><tr><th></th><th>Base</th><th></th><th>SP</th><th>${mega ? 'Base form' : 'Stat'}</th>${megaStats ? `<th>Mega</th>` : ''}</tr></thead><tbody>
    ${STAT_KEYS.map((k) => `<tr><th class="${mark(k)}">${STAT_LABEL[k]}</th><td class="num">${species.baseStats[k]}</td>
      <td class="bar-cell"><span class="bar" data-w="${Math.min(100, Math.round((species.baseStats[k] / maxBase) * 100))}"></span></td>
      <td><input class="sp-in" type="number" min="0" max="${maxSpPerStat}" step="1" inputmode="numeric" data-stat="${k}" value="${sp[k]}" aria-label="${STAT_LABEL[k]} Stat Points"></td>
      <td class="num strong${mark(k)}">${stats[k]}</td>${megaStats ? `<td class="num${mark(k)}">${megaStats[k]}</td>` : ''}</tr>`).join('')}
    </tbody><tfoot><tr><td colspan="${megaStats ? 6 : 5}" class="${total > maxSpTotal ? 'err-text' : 'muted'}">${total} / ${maxSpTotal} Stat Points used${total < maxSpTotal ? ` · ${maxSpTotal - total} left` : ''}</td></tr></tfoot></table>`;
}

function editorHTML(set: PokemonSet, dex: Dex): string {
  const species = dex.species(set.species);
  if (!species) {
    return `<div class="editor"><div class="ed-field"><label class="lbl" for="ed-species">Pokémon</label>
      <input id="ed-species" class="input" value="" placeholder="Search legal Pokémon…" autocomplete="off"></div>
      ${set.species ? `<p class="warn">${esc(set.species)} isn't allowed in ${esc(REGULATION.label)}. Pick a replacement.</p>` : '<p class="hint">Search by name or type. Pokémon used in Reg M-C come first, most used at the top.</p>'}</div>`;
  }
  const mega = dex.megaFor(species, set.item);
  const usage = dex.usageFor(species);
  const abilityUse = new Map<string, number>();
  for (const u of usage) for (const [a, p] of u.abilities) abilityUse.set(toID(a), Math.max(abilityUse.get(toID(a)) ?? 0, p));
  const problems = setProblems(set, dex);
  const moveSlots = [0, 1, 2, 3].map((i) => {
    const m = set.moves[i] ? dex.move(set.moves[i]!) : null;
    return `<div class="move-slot">${m ? typeChip(m.type) : '<span class="type t-none">—</span>'}
      <input class="input move-in" data-move="${i}" value="${esc(set.moves[i] ?? '')}" placeholder="Move ${i + 1}" autocomplete="off" aria-label="Move ${i + 1}"></div>`;
  }).join('');
  const mates = usage[0]?.mates ?? [];
  return `<div class="editor">
    <div class="ed-top">
      <div class="ed-portrait">${monIcon(mega?.name ?? species.name)}<div class="pk-types">${(mega?.types ?? species.types).map(typeChip).join('')}</div></div>
      <div class="ed-fields">
        <div class="ed-field"><label class="lbl" for="ed-species">Pokémon</label><input id="ed-species" class="input" value="${esc(species.name)}" autocomplete="off"></div>
        <div class="ed-field"><label class="lbl" for="ed-item">Item</label><input id="ed-item" class="input" value="${esc(set.item)}" placeholder="No item" autocomplete="off"></div>
        <div class="ed-field"><label class="lbl" for="ed-ability">Ability</label><select id="ed-ability" class="input">
          ${species.abilities.map((a) => `<option value="${esc(a)}"${toID(a) === toID(set.ability) ? ' selected' : ''} title="${esc(dex.data.abilities[a] ?? '')}">${esc(a)}${abilityUse.has(toID(a)) ? ` · ${pct(abilityUse.get(toID(a)))}` : ''}</option>`).join('')}
        </select>${mega ? `<div class="hint">As ${esc(mega.name)}: ${esc(mega.ability)}</div>` : ''}</div>
        <div class="ed-field"><label class="lbl" for="ed-nature">Nature</label><select id="ed-nature" class="input">${set.nature ? '' : '<option value="" selected>Pick a nature</option>'}${natureOptions(dex, set.nature)}</select></div>
        <div class="ed-field"><label class="lbl" for="ed-nick">Nickname</label><input id="ed-nick" class="input" value="${esc(set.nickname)}" placeholder="${esc(species.name)}" maxlength="18"></div>
      </div>
      <div class="ed-actions">
        ${usage.length ? '<button class="btn sm" id="ed-top-set">Load top set ▾</button>' : '<span class="hint">No usage data for this Pokémon</span>'}
        <button class="btn sm ghost danger" id="ed-remove">Remove</button>
      </div>
    </div>
    <div class="ed-bottom">
      <div class="ed-moves"><label class="lbl">Moves <span class="hint">· only moves ${esc(species.name)} can legally have</span></label>${moveSlots}
        ${mates.length ? `<div class="mates"><span class="lbl">Common teammates</span><div class="mate-row">${mates.slice(0, 6).map(([n, p]) => `<span class="mate" title="${esc(n)}: on ${p}% of its teams">${monIcon(n, 'xs')}${esc(n)}</span>`).join('')}</div></div>` : ''}
      </div>
      <div class="ed-stats">${statTable(set, species, dex)}${view.estimated.has(set.species) ? `<p class="hint est-note">${EST_CHIP} Filled in from Smogon usage because the team was published without it. Change any Stat Point to make it your own.</p>` : ''}</div>
    </div>
    ${problems.length ? `<div class="problems">${problems.map((p) => `<div>${esc(p)}</div>`).join('')}</div>` : ''}
  </div>`;
}

function wireEditor(main: HTMLElement, team: Team, sets: PokemonSet[], dex: Dex): void {
  const i = view.slot;
  const set: PokemonSet = sets[i] ?? emptySet();
  const commit = (): void => { sets[i] = set; save(team, sets); };
  const species = dex.species(set.species);

  const speciesIn = qs<HTMLInputElement>('#ed-species', main);
  if (speciesIn) attachPicker(speciesIn, {
    // Species Clause: one of each Pokémon per team, so the ones already on it aren't offered.
    options: () => speciesOptions(dex).filter((o) => {
      const s = dex.species(o.value);
      return s && !sets.some((other, j) => j !== i && dex.species(other.species)?.num === s.num);
    }),
    onPick: (name) => {
      const next = dex.species(name);
      if (!next || next.id === species?.id) return;
      // Keep what still fits the new Pokémon; drop what it can't have.
      set.species = next.name;
      if (!next.abilities.some((a) => toID(a) === toID(set.ability))) {
        // The ability people actually run (Intimidate, not Blaze), else the first one listed.
        const used = dex.usageFor(next).flatMap((u) => u.abilities).sort((a, b) => b[1] - a[1]).map(([a]) => a);
        set.ability = used.find((a) => next.abilities.some((b) => toID(b) === toID(a))) ?? next.abilities[0] ?? '';
      }
      if (set.item && dex.item(set.item)?.mega && !dex.megaFor(next, set.item)) set.item = '';
      set.moves = set.moves.filter((m) => dex.canLearn(next, m));
      set.level ??= 50;
      commit();
    },
  });
  if (!species) { if (!sets[i]) speciesIn?.focus(); return; }

  attachPicker(must<HTMLInputElement>('#ed-item', main), {
    allowEmpty: true,
    // Item Clause: no two Pokémon hold the same item.
    options: () => itemOptions(dex, species).filter((o) => !sets.some((other, j) => j !== i && toID(other.item) === toID(o.value))),
    onPick: (item) => { set.item = item; commit(); },
  });
  main.querySelectorAll<HTMLInputElement>('.move-in').forEach((input) => {
    const slot = Number(input.dataset.move);
    attachPicker(input, {
      allowEmpty: true,
      header: MOVE_HEADER,
      options: () => moveOptions(dex, species, set.moves.filter((_, j) => j !== slot)),
      onPick: (move) => {
        const moves = [...set.moves];
        if (move) moves[slot] = move; else moves.splice(slot, 1);
        set.moves = moves.filter(Boolean).slice(0, 4);
        commit();
      },
    });
  });
  must<HTMLSelectElement>('#ed-ability', main).addEventListener('change', (e) => { set.ability = (e.target as HTMLSelectElement).value; commit(); });
  must<HTMLSelectElement>('#ed-nature', main).addEventListener('change', (e) => { set.nature = (e.target as HTMLSelectElement).value; commit(); });
  must<HTMLInputElement>('#ed-nick', main).addEventListener('change', (e) => {
    const nick = (e.target as HTMLInputElement).value.trim().replace(/[()@]/g, '');
    set.nickname = nick === species.name ? '' : nick;
    commit();
  });
  main.querySelectorAll<HTMLInputElement>('.sp-in').forEach((input) => {
    input.addEventListener('change', () => {
      const k = input.dataset.stat as StatKey;
      const sp: StatTable = statPoints(set)?.sp ?? spOf(set);
      const others = STAT_KEYS.reduce((a, s) => a + (s === k ? 0 : sp[s]), 0);
      const { maxSpPerStat, maxSpTotal } = dex.data.rules;
      const wanted = Math.max(0, Math.floor(Number(input.value) || 0));
      sp[k] = Math.min(wanted, maxSpPerStat, Math.max(0, maxSpTotal - others));
      if (sp[k] < wanted) toast(`Capped at ${sp[k]}: ${maxSpPerStat} per stat, ${maxSpTotal} in total`);
      set.evs = spreadLine(sp);
      clearEstimated(team, [set.species]);
      commit();
    });
  });
  qs('#ed-remove', main)?.addEventListener('click', () => {
    sets.splice(i, 1);
    view.slot = Math.max(0, Math.min(i, sets.length - 1));
    save(team, sets);
  });
  const apply = (u: Parameters<typeof setFromUsage>[0], spread: number): void => {
    const built = setFromUsage(u, dex, spread);
    built.nickname = set.nickname;
    const clash = sets.findIndex((other, j) => j !== i && built.item && toID(other.item) === toID(built.item));
    if (clash >= 0) { toast(`${sets[clash]!.species} already holds ${built.item}; kept this Pokémon's item.`, true); built.item = set.item; }
    clearEstimated(team, [set.species]);
    sets[i] = built;
    save(team, sets);
  };
  const topBtn = qs('#ed-top-set', main);
  topBtn?.addEventListener('click', () => {
    openMenu(topBtn, dex.usageFor(species).flatMap((u) => [
      { html: `<b>${esc(u.name)}</b>&nbsp;<span class="muted">on ${pct(u.usage)} of teams</span>`, run: () => apply(u, 0) },
      ...u.spreads.slice(0, 3).map(([nature, sp, p], si) => ({
        html: `<span class="menu-sub">${esc(nature)} · ${esc(spreadLine(sp))} <span class="muted">${pct(p)}</span></span>`,
        run: () => apply(u, si),
      })),
    ]));
  });
}

function builderHTML(sets: PokemonSet[], dex: Dex): string {
  view.slot = Math.min(view.slot, sets.length, REGULATION.teamSize - 1);
  const set = sets[view.slot];
  return `${slotsHTML(sets, dex)}
    ${teamProblems(sets, dex).map((p) => `<div class="warn">${esc(p)}</div>`).join('')}
    ${editorHTML(set ?? emptySet(), dex)}`;
}

// ---- The page ---------------------------------------------------------------------------------------------------

export function renderTeamView(main: HTMLElement, team: Team): void {
  if (view.teamId !== team.id) Object.assign(view, { teamId: team.id, slot: 0 });
  const dex = currentDex();
  if (!dex) loadDex().then(() => requestRender()).catch(() => toast('Could not load the Pokémon data; the team builder is unavailable.', true));
  const sets = teamMons(team);
  view.estimated = new Set(team.estimatedSpreads ?? []);
  const mode: Mode = dex ? view.mode : 'paste';
  const pasteProblems = dex ? [...teamProblems(sets, dex), ...sets.flatMap((s) => setProblems(s, dex))] : teamWarnings(sets);

  main.innerHTML = `
  <div class="topbar"><input class="title-input" id="team-name" value="${esc(team.name)}" aria-label="Team name">
    <span class="chip">${esc(REGULATION.label)}</span><span class="spacer"></span>
    <button class="btn" data-act="export-team" data-team="${esc(team.id)}">Export team</button>
    <button class="btn danger" data-act="delete-team" data-team="${esc(team.id)}">Delete</button>${extLinksHTML()}</div>
  <div class="page"><div class="page-inner">
    <div class="section"><div class="section-head"><h3>Team</h3>
      <div class="btn-row">
        ${dex?.usage ? '<button class="btn sm" id="top-builds">★ Top builds</button>' : ''}
        ${dex ? '<button class="btn sm" id="top-teams">★ Top teams</button>' : ''}
        <div class="seg" role="tablist">
          <button class="seg-btn${mode === 'builder' ? ' on' : ''}" data-mode="builder" role="tab" ${dex ? '' : 'disabled title="Loading…"'}>Builder</button>
          <button class="seg-btn${mode === 'paste' ? ' on' : ''}" data-mode="paste" role="tab">Paste</button>
        </div></div></div>
      ${mode === 'builder' && dex ? builderHTML(sets, dex) : `
        <textarea class="paste" id="team-paste" data-team-paste placeholder="Paste your team in Showdown format, ${PASTE_LINK_HINT}">${esc(team.paste)}</textarea>
        ${topTeamsButton('#team-paste')}
        <div class="btn-row mt-s"><button class="btn primary sm" id="save-paste">Update team</button></div>
        ${pasteProblems.length ? `<div class="problems">${pasteProblems.map((w) => `<div>${esc(w)}</div>`).join('')}</div>` : ''}
        ${sets.length ? `<div class="mon-grid">${sets.map(monCard).join('')}</div>` : '<p class="hint mt-s">No Pokémon parsed yet.</p>'}`}
    </div>
    <div class="section"><div class="section-head"><h3>Gameplans</h3><button class="btn primary sm" data-act="new-plan" data-team="${esc(team.id)}">New gameplan</button></div>
      ${team.plans.length ? `<div class="plan-list">${team.plans.map((p) => {
        const turns = countPlanTurns(p);
        const tabs = p.tabs.length;
        return `<div class="plan-card" data-act="open-plan" data-team="${esc(team.id)}" data-plan="${esc(p.id)}" tabindex="0" role="button">
          <span class="nm">${esc(p.name)}</span>
          <span class="icon-row">${oppMons(p).map((m) => monIcon(m.species, 'sm')).join('')}</span>
          <span class="muted">${tabs > 1 ? `${tabs} tabs · ` : ''}${turns} turn${turns === 1 ? '' : 's'}</span></div>`;
      }).join('')}</div>` : '<p class="hint">No gameplans yet. Create one for each opponent team you want to prepare for.</p>'}
    </div></div></div>`;
  main.querySelectorAll<HTMLElement>('[data-w]').forEach((el) => { el.style.width = `${el.dataset.w ?? 0}%`; });

  must<HTMLInputElement>('#team-name').addEventListener('input', (e) => {
    team.name = (e.target as HTMLInputElement).value;
    store.persist();
    renderNav();
  });
  main.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    view.mode = b.dataset.mode === 'paste' ? 'paste' : 'builder';
    requestRender();
  }));
  main.querySelectorAll<HTMLElement>('[data-slot]').forEach((b) => b.addEventListener('click', () => {
    view.slot = Number(b.dataset.slot);
    requestRender();
  }));
  qs('#top-builds', main)?.addEventListener('click', () => {
    if (!dex) return;
    openTopBuilds(dex, sets, view.slot, (built, replace) => {
      const at = replace ?? sets.length;
      sets[at] = built;
      view.slot = at;
      view.mode = 'builder';
      save(team, sets);
      toast(replace !== null ? `${built.species} replaced slot ${replace + 1}` : `${built.species} added`);
    });
  });
  qs('#top-teams', main)?.addEventListener('click', () => {
    if (!dex) return;
    openTopTeams(dex, [
      {
        label: 'Use as my team', cls: 'primary',
        run: (built, label, estimated) => {
          sets.splice(0, sets.length, ...built);
          setEstimated(team, estimated);
          Object.assign(view, { slot: 0, mode: 'builder' });
          save(team, sets);
          toast(`Team replaced with ${label}.${estimated.length ? ` ${estimatedToast(estimated)}` : ''}`);
        },
      },
      { label: 'Plan against this team', run: (built, label) => createPlanFrom(team, label, writeTeam(built)) },
    ]);
  });
  qs('#save-paste', main)?.addEventListener('click', () => {
    const box = must<HTMLTextAreaElement>('#team-paste');
    const paste = box.value;
    if (paste !== team.paste) { team.paste = paste; setEstimated(team, boxEstimates(box)); }
    const parsed = parseShowdown(team.paste);
    cleanSelections(team.plans, 'me', parsed);
    store.persist();
    requestRender();
    const issues = dex ? [...teamProblems(parsed, dex), ...parsed.flatMap((s) => setProblems(s, dex))] : teamWarnings(parsed);
    toast(issues.length ? `Team updated, with ${issues.length} rule problem${issues.length === 1 ? '' : 's'}` : 'Team updated', issues.length > 0);
  });
  if (mode === 'builder' && dex) wireEditor(main, team, sets, dex);
}
