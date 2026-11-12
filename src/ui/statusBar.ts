import * as vscode from 'vscode';
import { SessionStore } from '../model/sessionStore';
import { Session, SessionState, STATE_ORDER } from '../model/types';
import { sessionName, STATE_COLOR, STATE_HEX as HEX } from './theme';

// One quiet status bar item ("4 sessions") that invites a hover. It turns
// blue with a bell only when something needs you. The hover card holds the
// detail: a small donut, the non-zero counts, and who needs you.
//
// Why not a donut in the bar itself? A status bar item can only show text and
// built-in icons, in a single color. The hover card allows a small image and
// colored text, so the richer picture lives there.

const OPEN_VIEW = 'waitlight.sessions.focus'; // VS Code creates "<viewId>.focus" for every view

const SHORT: Record<SessionState, string> = {
  needsYou: 'need you',
  working: 'running',
  done: 'done',
  idle: 'idle',
};

const DONUT_PX = 44;
const MAX_NAMES = 3;

export class StatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor(private readonly store: SessionStore) {
    this.item = vscode.window.createStatusBarItem('waitlight.status', vscode.StatusBarAlignment.Right, 100);
    this.item.name = 'Waitlight';
    this.item.command = OPEN_VIEW;
    store.onDidChange(() => this.render());
    this.render();
    this.item.show();
  }

  private lastText = '';
  private lastCard = '';

  private render(): void {
    const sessions = this.store.getSessions();
    const counts = countByState(sessions);

    const n = sessions.length;
    const label = n === 0 ? 'Waitlight' : `${n} session${n > 1 ? 's' : ''}`;
    const needsYou = counts.needsYou > 0;
    const text = needsYou ? `$(bell-dot) ${label}` : `$(circle-large-outline) ${label}`;
    const card = hoverCard(sessions, counts);

    // Only touch the item when something visible changed: updating it while
    // you're hovering would close the hover card.
    if (text !== this.lastText) {
      this.lastText = text;
      this.item.text = text;
      this.item.color = needsYou ? new vscode.ThemeColor(STATE_COLOR.needsYou) : undefined;
    }
    if (card.value !== this.lastCard) {
      this.lastCard = card.value;
      this.item.tooltip = card;
    }
  }

  dispose(): void {
    this.item.dispose();
  }
}

// Sessions that need you, the one that has waited longest first.
export function needsYouLongestFirst(sessions: Session[]): Session[] {
  return sessions
    .filter((s) => s.state === 'needsYou')
    .sort((a, b) => (a.stateSince ?? a.updatedAt) - (b.stateSince ?? b.updatedAt));
}

function countByState(sessions: Session[]): Record<SessionState, number> {
  const counts = { needsYou: 0, working: 0, done: 0, idle: 0 };
  for (const s of sessions) counts[s.state]++;
  return counts;
}

function hoverCard(sessions: Session[], counts: Record<SessionState, number>): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.supportHtml = true; // allows <img> and <span style="color:..."> (VS Code sanitizes the rest)

  if (sessions.length === 0) {
    md.appendMarkdown('**Waitlight**\n\nNo Claude Code sessions yet.');
    return md;
  }

  // Donut on the left, non-zero counts on the right.
  const lines = STATE_ORDER.filter((s) => counts[s] > 0)
    .map((s) => `<span style="color:${HEX[s]};">●</span> ${counts[s]} ${SHORT[s]}`)
    .join('<br>');
  md.appendMarkdown(
    `<table><tr><td><img src="${donutSvg(counts)}" width="${DONUT_PX}" height="${DONUT_PX}"/></td>` +
      `<td>&nbsp;&nbsp;</td><td>${lines}</td></tr></table>\n\n`,
  );

  // Only the sessions that need you get named, longest waiting first.
  const waiting = needsYouLongestFirst(sessions);
  if (waiting.length) {
    md.appendMarkdown('---\n\n');
    for (const s of waiting.slice(0, MAX_NAMES)) {
      const why = s.waitingFor ? ` <span style="color:${HEX.idle};">· ${escape(s.waitingFor)}</span>` : '';
      md.appendMarkdown(`<span style="color:${HEX.needsYou};">●</span> ${escape(sessionName(s))}${why}  \n`);
    }
    if (waiting.length > MAX_NAMES) md.appendMarkdown(`…and ${waiting.length - MAX_NAMES} more  \n`);
  }
  return md;
}

// A donut drawn as SVG: one ring segment per state, sized by its share.
// Embedded as a data: URI so nothing is loaded from anywhere.
function donutSvg(counts: Record<SessionState, number>): string {
  const total = STATE_ORDER.reduce((sum, s) => sum + counts[s], 0);
  const r = 15.9155; // circumference = 100, so segment lengths are percentages
  let offset = 25; // start at 12 o'clock
  const segments = STATE_ORDER.filter((s) => counts[s] > 0).map((state) => {
    const pct = (counts[state] / total) * 100;
    const gap = pct < 100 ? 1.5 : 0;
    const seg = `<circle cx="21" cy="21" r="${r}" fill="none" stroke="${HEX[state]}" stroke-width="5"
      stroke-dasharray="${Math.max(pct - gap, 0.5)} ${100 - pct + gap}" stroke-dashoffset="${offset}"/>`;
    offset -= pct;
    return seg;
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 42 42">
    <circle cx="21" cy="21" r="${r}" fill="none" stroke="#8884" stroke-width="5"/>
    ${segments.join('')}
    <text x="21" y="25" text-anchor="middle" font-family="sans-serif" font-size="11" font-weight="600" fill="#999">${total}</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

// Session titles come from your prompts; make sure they can't inject HTML.
function escape(text: string): string {
  return text.replace(/[&<>"'*_`[\]\\]/g, (c) => `&#${c.charCodeAt(0)};`);
}
