// Runs when Waitlight is uninstalled ("vscode:uninstall" in package.json).
// VS Code runs it with plain Node after the editor restarts, so there is no
// VS Code API here, just files.
//
// It removes Waitlight's hook entries from Claude's settings.json (after a
// backup) and deletes ~/.claude/waitlight. Leftover hooks after uninstall
// are a common complaint about similar tools; we don't leave any.
//
// Exception: if Waitlight is still installed in another editor (e.g. you
// removed it from VS Code but kept it in Cursor), the hooks are still in use,
// so we leave everything in place.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { hasWaitlightHooks, removeWaitlightHooks } from './claude/hookConfig';

const EXTENSION_ID = 'monis01.waitlight'; // publisher.name — keep in sync with package.json

const home = os.homedir();
const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
const ownFolder = path.resolve(__dirname, '..');

// Extension folders of VS Code and common VS Code-based editors.
const EXTENSION_DIRS = ['.vscode', '.vscode-insiders', '.cursor', '.windsurf', '.vscode-oss', '.vscode-server', '.cursor-server'].map(
  (d) => path.join(home, d, 'extensions'),
);

function stillInstalledElsewhere(): boolean {
  for (const dir of EXTENSION_DIRS) {
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    // Folders VS Code has marked for deletion are listed in ".obsolete".
    let obsolete: Record<string, boolean> = {};
    try {
      obsolete = JSON.parse(fs.readFileSync(path.join(dir, '.obsolete'), 'utf8'));
    } catch {
      // no such file
    }
    for (const name of names) {
      if (!name.toLowerCase().startsWith(`${EXTENSION_ID}-`)) continue;
      if (obsolete[name]) continue;
      if (path.resolve(dir, name) === ownFolder) continue;
      return true;
    }
  }
  return false;
}

function main(): void {
  if (stillInstalledElsewhere()) return;

  const settingsFile = path.join(claudeDir, 'settings.json');
  try {
    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    if (hasWaitlightHooks(settings)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      fs.copyFileSync(settingsFile, `${settingsFile}.waitlight-backup-${stamp}`);
      const tmp = `${settingsFile}.waitlight.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(removeWaitlightHooks(settings), null, 2) + '\n');
      fs.renameSync(tmp, settingsFile);
    }
  } catch {
    // No settings file, or it can't be read safely: change nothing.
  }

  fs.rmSync(path.join(claudeDir, 'waitlight'), { recursive: true, force: true });
}

try {
  main();
} catch {
  // Never let a cleanup problem get in the way of uninstalling.
}
