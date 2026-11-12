import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { LiveSession, readLiveSessions } from '../claude/liveSessions';
import { forgetTranscriptsExcept, readTranscript, transcriptPath } from '../claude/transcripts';
import { Session, SessionState, STATE_ORDER } from './types';

// Claude Code's folder (normally ~/.claude; CLAUDE_CONFIG_DIR can move it).
export function claudeDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

// When launch.json sets WAITLIGHT_SESSIONS_DIR we're in "fake sessions" mode:
// read that folder only and ignore real Claude sessions.
const FAKE_DIR = process.env.WAITLIGHT_SESSIONS_DIR;

// Where our hook script writes status files.
export function sessionsDir(): string {
  return FAKE_DIR || path.join(claudeDir(), 'waitlight', 'sessions');
}

const POLL_MS = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Once a second, combines two sources and tells the UI when anything changed:
//  1. Claude's own list of open chats (~/.claude/sessions): which sessions
//     exist right now, their tab titles and start times.
//  2. Our hook files (~/.claude/waitlight/sessions): state, prompts, times.
// Polling is boring but works the same on every OS.
export class SessionStore implements vscode.Disposable {
  private sessions: Session[] = [];
  private lastSnapshot = '';
  private timer: NodeJS.Timeout;
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;

  private readonly listeners: vscode.Disposable[];

  constructor(private readonly dir = sessionsDir()) {
    this.refresh();
    this.timer = setInterval(() => this.refresh(), POLL_MS);
    // Re-filter straight away when settings or the open folders change.
    this.listeners = [
      vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration('waitlight') && this.refresh(true)),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.refresh(true)),
    ];
  }

  getSessions(): Session[] {
    return this.sessions;
  }

  // force = tell the UI to redraw even if the files didn't change.
  refresh(force = false): void {
    const config = vscode.workspace.getConfiguration('waitlight');
    const idleMs = config.get<number>('idleAfterMinutes', 30) * 60_000;
    const onlyThisFolder = config.get<string>('show', 'all') === 'thisFolder';
    const now = Date.now();
    if (force) this.lastSnapshot = '';

    const hooked = readStatusFiles(this.dir);
    const live = FAKE_DIR ? null : readLiveSessions(claudeDir());
    const sessions = (live ? this.combine(hooked, live) : hooked)
      .filter((s) => !onlyThisFolder || isInOpenFolder(s.cwd))
      // "Done" turns grey after a quiet spell. Running and Needs you never do.
      .map((s) => (s.state === 'done' && now - (s.stateSince ?? s.updatedAt) > idleMs ? { ...s, state: 'idle' as const } : s));
    // Stable order: newest session first, idle ones at the bottom.
    // We deliberately do NOT sort by state: a state change would make rows
    // swap places, VS Code would redraw the whole list, and any open hover
    // card would close. Color, badge and status bar show "needs you" instead.
    const started = (s: Session) => s.startedAt ?? s.prompts?.[0]?.at ?? 0;
    const isIdle = (s: Session) => (s.state === 'idle' ? 1 : 0);
    sessions.sort(
      (a, b) => isIdle(a) - isIdle(b) || started(b) - started(a) || a.sessionId.localeCompare(b.sessionId),
    );

    // Only redraw the UI when something actually changed.
    const snapshot = JSON.stringify(sessions);
    if (snapshot !== this.lastSnapshot) {
      this.lastSnapshot = snapshot;
      this.sessions = sessions;
      this.changed.fire();
    }
  }

  // When each session's state last changed, as we saw it. Used so the time
  // on a row ("running · 4m") only restarts on a real change.
  private seen = new Map<string, { state: SessionState; since: number }>();

  // Combines Claude's list of open chats with our hook files and the chat logs:
  //  - which chats exist, start time  -> Claude's list (closed chats vanish)
  //  - title and prompts              -> the chat log (your typed prompts only)
  //  - running / done                 -> Claude's busy/idle flag
  //  - needs you                      -> our hooks (only they can tell)
  private combine(hooked: Session[], live: LiveSession[]): Session[] {
    const now = Date.now();
    const byId = new Map(hooked.map((s) => [s.sessionId, s]));
    const openIds = new Set(live.map((l) => l.sessionId));

    // Closed chats: hidden now, our file deleted a day later (Claude's list
    // can be a moment behind, e.g. right after /clear).
    for (const s of hooked) {
      if (!openIds.has(s.sessionId) && now - s.updatedAt > DAY_MS) deleteStatusFile(s.sessionId);
    }

    const logs = new Set<string>();
    const seen = new Map<string, { state: SessionState; since: number }>();

    const result = live.map((l): Session => {
      const h = byId.get(l.sessionId);
      const log = h?.transcriptPath ?? transcriptPath(claudeDir(), l.sessionId, l.cwd ?? h?.cwd);
      const t = log ? readTranscript(log) : undefined;
      if (log) logs.add(log);
      const prompts = t?.prompts.length ? t.prompts : (h?.prompts ?? []);

      const { state, changedAt } = decideState(l, h, prompts.length > 0);
      const before = this.seen.get(l.sessionId);
      const since = before && before.state === state ? before.since : (changedAt ?? now);
      seen.set(l.sessionId, { state, since });

      const start = l.startedAt ?? h?.startedAt ?? now;
      return {
        agent: 'claude',
        sessionId: l.sessionId,
        state,
        cwd: l.cwd ?? h?.cwd ?? '',
        title: l.name ?? t?.title ?? h?.title,
        prompts,
        lastPrompt: prompts.at(-1)?.text,
        startedAt: start,
        stateSince: since,
        updatedAt: Math.max(h?.updatedAt ?? 0, l.updatedAt ?? 0, prompts.at(-1)?.at ?? 0, start),
        transcriptPath: log,
        waitingFor: state === 'needsYou' ? h?.waitingFor : undefined,
      };
    });

    this.seen = seen;
    forgetTranscriptsExcept(logs);
    return result;
  }

  dispose(): void {
    clearInterval(this.timer);
    this.listeners.forEach((l) => l.dispose());
    this.changed.dispose();
  }
}

// Which state to show, and (if known) when it began.
function decideState(l: LiveSession, h: Session | undefined, hasPrompts: boolean): { state: SessionState; changedAt?: number } {
  // "Needs you" comes only from hooks. It ends when Claude reports idle
  // again after it (e.g. you denied a permission and Claude stopped).
  if (h?.state === 'needsYou' && !(l.busy === false && (l.statusAt ?? 0) > (h.stateSince ?? 0))) {
    return { state: 'needsYou', changedAt: h.stateSince };
  }
  if (l.busy === true) return { state: 'working', changedAt: l.statusAt };
  if (l.busy === false) return { state: hasPrompts ? 'done' : 'idle', changedAt: l.statusAt };
  // Claude's flag missing (older/newer Claude version): use hooks alone.
  return { state: h?.state ?? 'idle', changedAt: h?.stateSince };
}

function deleteStatusFile(sessionId: string): void {
  if (!/^[\w-]+$/.test(sessionId)) return;
  try {
    fs.rmSync(path.join(sessionsDir(), `${sessionId}.json`), { force: true });
  } catch {
    // not ours to worry about
  }
}

// Is this session's folder one of the folders open in this window (or inside one)?
// With no folder open, everything counts.
function isInOpenFolder(cwd: string): boolean {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length || !cwd) return true;
  const caseless = process.platform !== 'linux'; // macOS and Windows ignore case in paths
  const norm = (p: string) => {
    const r = path.resolve(p);
    return caseless ? r.toLowerCase() : r;
  };
  const target = norm(cwd);
  return folders.some((f) => {
    const root = norm(f.uri.fsPath);
    return target === root || target.startsWith(root + path.sep);
  });
}

function readStatusFiles(dir: string): Session[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch {
    return []; // folder doesn't exist yet: no sessions
  }
  const result: Session[] = [];
  for (const name of names) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      if (typeof data.sessionId === 'string' && STATE_ORDER.includes(data.state)) {
        result.push(data as Session);
      }
    } catch {
      // Half-written or broken file: skip it, we'll see it next second.
    }
  }
  return result;
}
