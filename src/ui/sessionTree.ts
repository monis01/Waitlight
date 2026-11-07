import * as path from 'path';
import * as vscode from 'vscode';
import { SessionStore } from '../model/sessionStore';
import { Prompt, Session, STATE_LABEL } from '../model/types';
import { fullDate, rowTime, stamp, stateTime } from './format';
import { hexDot, sessionName, stateIcon, STATE_ICON } from './theme';

// The "Claude Sessions" section in the Explorer, built like VS Code's own
// Timeline: one tidy line per row, details in a hover card.
//
// A row is either a session or one prompt inside a session.
type SessionNode = { kind: 'session'; session: Session };
type PromptNode = { kind: 'prompt'; session: Session; prompt: Prompt; index: number };
export type Node = SessionNode | PromptNode;

export const OPEN_COMMAND = 'waitlight.openSession';
const TICK_MS = 15_000; // how often we check whether "waiting 4m" needs to say "5m"

// Redrawing a row closes any hover card that's open on it. So we redraw as
// little as possible:
//  - the same session always uses the same Node object (VS Code tracks rows by
//    object), so we can tell VS Code "only this row changed";
//  - a row is only redrawn when what you can SEE on it changed.
export class SessionTreeProvider implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<Node | Node[] | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly timer = setInterval(() => this.update(), TICK_MS);

  private nodes = new Map<string, SessionNode>(); // sessionId -> its row object
  private looks = new Map<string, string>();      // sessionId -> what its row shows
  private order = '';                             // row order, to detect add/remove/reorder

  constructor(private readonly store: SessionStore) {
    store.onDidChange(() => this.update());
    this.update();
  }

  getChildren(node?: Node): Node[] {
    if (!node) {
      return this.store.getSessions().map((s) => this.nodes.get(s.sessionId)!).filter(Boolean);
    }
    if (node.kind === 'session') {
      // Newest prompt first. `index` keeps the original position ("prompt 3 of 3").
      return (node.session.prompts ?? [])
        .map((prompt, index): PromptNode => ({ kind: 'prompt', session: node.session, prompt, index }))
        .reverse();
    }
    return [];
  }

  getTreeItem(node: Node): vscode.TreeItem {
    return node.kind === 'session' ? sessionItem(node.session) : promptItem(node);
  }

  private update(): void {
    const sessions = this.store.getSessions();
    const changedRows: SessionNode[] = [];
    const nextNodes = new Map<string, SessionNode>();
    const nextLooks = new Map<string, string>();

    for (const s of sessions) {
      const node = this.nodes.get(s.sessionId) ?? { kind: 'session', session: s };
      node.session = s; // same object, fresh data
      const look = rowLook(s);
      if (this.looks.has(s.sessionId) && this.looks.get(s.sessionId) !== look) changedRows.push(node);
      nextNodes.set(s.sessionId, node);
      nextLooks.set(s.sessionId, look);
    }
    this.nodes = nextNodes;
    this.looks = nextLooks;

    const order = sessions.map((s) => s.sessionId).join('|');
    if (order !== this.order) {
      this.order = order;
      this.changed.fire(undefined); // sessions added, removed or reordered: redraw the list
    } else if (changedRows.length) {
      this.changed.fire(changedRows); // only these rows
    }
  }

  dispose(): void {
    clearInterval(this.timer);
    this.changed.dispose();
  }
}

// Everything visible on a session row (and its prompt rows), as one string.
// If this is unchanged, the row doesn't need redrawing.
function rowLook(s: Session): string {
  return JSON.stringify([
    sessionName(s),
    vscode.workspace.getConfiguration('waitlight').get('maxTitleLength'),
    rowTime(s),
    STATE_ICON[s.state],
    s.state,
    s.cwd,
    (s.prompts ?? []).map((p) => [p.text, p.at]),
  ]);
}

// ---------- rows ----------

function sessionItem(s: Session): vscode.TreeItem {
  const hasPrompts = (s.prompts?.length ?? 0) > 0;
  // Titles are capped so the short time and the hover button still fit:
  // extensions can't reserve a right-hand column like Timeline does.
  const maxTitle = vscode.workspace.getConfiguration('waitlight').get<number>('maxTitleLength', 24);
  const item = new vscode.TreeItem(
    oneLine(sessionName(s), maxTitle),
    hasPrompts ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
  );
  item.id = s.sessionId; // stable id keeps rows expanded while states change
  item.description = rowTime(s);
  item.iconPath = stateIcon(s.state);
  item.contextValue = 'session'; // lets package.json show the "Open chat" button on these rows
  item.tooltip = sessionCard(s);
  return item;
}

function promptItem(node: PromptNode): vscode.TreeItem {
  const item = new vscode.TreeItem(oneLine(node.prompt.text));
  item.id = `${node.session.sessionId}:${node.index}`;
  item.iconPath = new vscode.ThemeIcon('comment');
  item.contextValue = 'prompt';
  item.tooltip = promptCard(node);
  return item;
}

// ---------- hover cards ----------

function card(): vscode.MarkdownString {
  const md = new vscode.MarkdownString('', true); // true = allow $(icon) syntax
  md.supportHtml = true; // only for colored dots; VS Code strips anything unsafe
  md.isTrusted = { enabledCommands: [OPEN_COMMAND] }; // the only link the card may run
  return md;
}

function sessionCard(s: Session): vscode.MarkdownString {
  const md = card();
  const t = stateTime(s);
  const count = s.prompts?.length ?? 0;
  const last = s.prompts?.at(-1);

  md.appendMarkdown(`${hexDot(s.state)} **${STATE_LABEL[s.state]}** · ${t.text}\n\n`);
  md.appendMarkdown('**');
  md.appendText(sessionName(s));
  md.appendMarkdown('**\n\n---\n\n');

  md.appendMarkdown('$(folder) ');
  md.appendText(`${path.basename(s.cwd)}  ·  ${s.cwd}`);
  md.appendMarkdown('  \n');
  if (count) {
    md.appendMarkdown(`$(comment) ${count} prompt${count > 1 ? 's' : ''}`);
    if (last?.at) md.appendMarkdown(` · last at ${stamp(last.at)}`);
    md.appendMarkdown('  \n');
  }
  md.appendMarkdown(`$(history) ${t.hint} ${fullDate(t.since)}\n\n---\n\n`);

  const args = encodeURIComponent(JSON.stringify([s.sessionId]));
  md.appendMarkdown(`[$(link-external) Open chat](command:${OPEN_COMMAND}?${args})`);
  return md;
}

function promptCard(node: PromptNode): vscode.MarkdownString {
  const md = card();
  const { session: s, prompt: p, index } = node;
  const total = s.prompts?.length ?? 0;

  md.appendMarkdown('$(comment) **You asked**');
  if (p.at) md.appendMarkdown(` · ${fullDate(p.at)}`);
  md.appendMarkdown('\n\n---\n\n');
  md.appendText(p.text);
  md.appendMarkdown('\n\n---\n\n');
  md.appendMarkdown(`${hexDot(s.state)} `);
  md.appendText(sessionName(s));
  md.appendMarkdown(` · prompt ${index + 1} of ${total}`);
  return md;
}

function oneLine(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat;
}
