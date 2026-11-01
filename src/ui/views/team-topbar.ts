/**
 * The team page's top bar. Pure (no DOM, no store) so a test can prove its markup: the phone menu button and the
 * link buttons are passed in.
 */
import { REGULATION } from '../../domain/regulation.ts';
import type { Team } from '../../domain/types.ts';
import { esc } from '../dom.ts';

/** The "Official team list" button; the only addition to the bar since the feature was built. */
export const teamListButton = (team: Team): string =>
  `<button class="btn" data-act="team-list" data-team="${esc(team.id)}" title="Print the official two-page team list for tournaments, filled in from this team">Official team list</button>`;

export function teamTopbarHTML(team: Team, navButton: string, extLinks: string): string {
  return `<div class="topbar">${navButton}<input class="title-input" id="team-name" value="${esc(team.name)}" aria-label="Team name">
    <span class="chip">${esc(REGULATION.label)}</span><span class="spacer"></span>
    <button class="btn" data-act="duplicate-team" data-team="${esc(team.id)}">Duplicate</button>
    <button class="btn" data-act="export-team" data-team="${esc(team.id)}">Export team</button>
    ${teamListButton(team)}
    <button class="btn" data-act="copy-showdown" data-team="${esc(team.id)}" title="Copy this team as Showdown paste text, ready for Showdown's teambuilder">Copy Showdown paste</button>
    <button class="btn" data-act="download-showdown" data-team="${esc(team.id)}" title="Save this team as a Showdown paste (.txt)">Download .txt</button>
    <button class="btn danger" data-act="delete-team" data-team="${esc(team.id)}">Delete</button><div class="d-only">${extLinks}</div></div>`;
}
