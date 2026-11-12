import * as fs from 'fs';
import * as path from 'path';

// Claude Code keeps one small file per running session:
//   ~/.claude/sessions/<pid>.json  ->  { pid, sessionId, cwd, startedAt, name, ... }
// It appears when a chat opens and disappears when it closes, so it tells us
// which chats are open right now, and their tab titles.
//
// This file is NOT a documented Claude Code feature and may change in any
// update. We only read it, check every field, and return null if it's not
// usable; the store then falls back to our hook files alone.

export interface LiveSession {
  pid: number;
  sessionId: string;
  cwd?: string;
  startedAt?: number;
  name?: string; // a title you or Claude gave the chat (not auto-made ones)
  busy?: boolean; // Claude's own "busy"/"idle" flag; undefined if unknown
  statusAt?: number; // when that flag last changed
  updatedAt?: number;
}

export function readLiveSessions(claudeDir: string): LiveSession[] | null {
  const dir = path.join(claudeDir, 'sessions');
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch {
    return null; // folder not there: this Claude version doesn't have it
  }

  const live: LiveSession[] = [];
  for (const name of names) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      if (typeof d.pid !== 'number' || typeof d.sessionId !== 'string') continue;
      if (!isRunning(d.pid)) continue; // left behind by a crash: treat as closed
      live.push({
        pid: d.pid,
        sessionId: d.sessionId,
        cwd: typeof d.cwd === 'string' ? d.cwd : undefined,
        startedAt: typeof d.startedAt === 'number' ? d.startedAt : undefined,
        // "derived" names are made from the folder + id (e.g. "monis01-8a"): skip those.
        name: typeof d.name === 'string' && d.name.trim() && d.nameSource !== 'derived' ? d.name : undefined,
        busy: d.status === 'busy' ? true : d.status === 'idle' ? false : undefined,
        statusAt: typeof d.statusUpdatedAt === 'number' ? d.statusUpdatedAt : undefined,
        updatedAt: typeof d.updatedAt === 'number' ? d.updatedAt : undefined,
      });
    } catch {
      // half-written or unexpected file: skip
    }
  }
  return live;
}

// Signal 0 doesn't touch the process; it only asks "does it exist?".
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e?.code === 'EPERM'; // exists, but owned by someone else
  }
}
