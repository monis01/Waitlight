import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { Session, STATE_ORDER } from './types';

// Where status files live. During development launch.json points this at
// ./.dev-sessions so we never touch the real ~/.claude folder.
export function sessionsDir(): string {
  if (process.env.WAITLIGHT_SESSIONS_DIR) {
    return process.env.WAITLIGHT_SESSIONS_DIR;
  }
  const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(claudeDir, 'waitlight', 'sessions');
}

const POLL_MS = 1000;

// Reads one small JSON file per session, once a second, and tells the UI
// when anything changed. Polling is boring but works the same on every OS.
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

    const sessions = readStatusFiles(this.dir)
      .filter((s) => !onlyThisFolder || isInOpenFolder(s.cwd))
      .map((s) => (now - s.updatedAt > idleMs ? { ...s, state: 'idle' as const } : s));
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

  dispose(): void {
    clearInterval(this.timer);
    this.listeners.forEach((l) => l.dispose());
    this.changed.dispose();
  }
}

// Is this session's folder one of the folders open in this window (or inside one)?
// With no folder open, everything counts.
function isInOpenFolder(cwd: string): boolean {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) return true;
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
