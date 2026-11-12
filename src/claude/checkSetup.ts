import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { claudeDir, sessionsDir } from '../model/sessionStore';
import { HOOK_EVENTS, HOOK_MARKER } from './hookConfig';
import { readLiveSessions } from './liveSessions';

// "Waitlight: Check Setup": a plain report of everything Waitlight depends
// on, so problems can be spotted (and reported) without guessing.

let output: vscode.OutputChannel | undefined;

export function checkSetup(context: vscode.ExtensionContext): void {
  output ??= vscode.window.createOutputChannel('Waitlight');
  const lines: string[] = [];
  const ok = (good: boolean, text: string) => lines.push(`${good ? '✓' : '✗'} ${text}`);
  const info = (text: string) => lines.push(`  ${text}`);

  const dir = claudeDir();
  lines.push(`Waitlight setup check · ${new Date().toLocaleString()}`, '');

  // 1. Claude's folder
  ok(fs.existsSync(dir), `Claude Code folder: ${dir}`);

  // 2. Our hooks in settings.json
  const settingsFile = path.join(dir, 'settings.json');
  let settings: any;
  try {
    settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  } catch (e: any) {
    ok(false, `Can't read ${settingsFile}: ${e.message}`);
  }
  const ourCommands: string[] = [];
  const missing: string[] = [];
  for (const [event] of HOOK_EVENTS) {
    const cmds = (settings?.hooks?.[event] ?? [])
      .flatMap((g: any) => (Array.isArray(g?.hooks) ? g.hooks : []))
      .map((h: any) => h?.command)
      .filter((c: any) => typeof c === 'string' && c.includes(HOOK_MARKER));
    if (cmds.length) ourCommands.push(cmds[0]);
    else missing.push(event);
  }
  if (settings) {
    ok(missing.length === 0, `Session tracking hooks: ${HOOK_EVENTS.length - missing.length} of ${HOOK_EVENTS.length} installed`);
    if (missing.length) info(`Missing: ${missing.join(', ')}. Run "Waitlight: Set Up Session Tracking".`);
  }

  // 3. The hook command: Node and the script must both exist
  const match = ourCommands[0]?.match(/^"([^"]+)"\s+"([^"]+)"$/);
  if (match) {
    const [, node, script] = match;
    ok(fs.existsSync(node), `Node.js: ${node}`);
    if (!fs.existsSync(node)) info('Node moved or was uninstalled. Run "Set Up Session Tracking" again.');
    ok(fs.existsSync(script), `Hook script: ${script}`);
    try {
      const bundled = fs.readFileSync(context.asAbsolutePath(path.join('hooks', HOOK_MARKER)), 'utf8');
      ok(fs.readFileSync(script, 'utf8') === bundled, 'Hook script matches this Waitlight version');
    } catch {
      // already reported above
    }
  } else if (ourCommands.length) {
    ok(false, `Unexpected hook command: ${ourCommands[0]}`);
  }

  // 4. Claude's list of open chats (undocumented; optional)
  const live = readLiveSessions(dir);
  ok(
    live !== null,
    live
      ? `Claude's open-chat list: ${live.length} open chat${live.length === 1 ? '' : 's'}`
      : "Claude's open-chat list not found (Waitlight will rely on hooks only)",
  );

  // 5. Last event received from the hooks
  let newest = 0;
  try {
    for (const name of fs.readdirSync(sessionsDir())) {
      if (name.endsWith('.json')) newest = Math.max(newest, fs.statSync(path.join(sessionsDir(), name)).mtimeMs);
    }
  } catch {
    // folder not created yet
  }
  ok(
    newest > 0,
    newest
      ? `Last hook event: ${new Date(newest).toLocaleString()}`
      : 'No hook events received yet. Send a message in a new Claude chat (older chats may need a restart to pick up hooks).',
  );

  // 6. Debug log
  const debugOn = fs.existsSync(path.join(dir, 'waitlight', 'debug'));
  info(`Event log: ${debugOn ? `on (${path.join(dir, 'waitlight', 'events.log')})` : 'off'}`);

  output.clear();
  output.appendLine(lines.join('\n'));
  output.show(true);
}
