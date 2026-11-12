import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { claudeDir } from '../model/sessionStore';
import { addWaitlightHooks, hasWaitlightHooks, HOOK_MARKER, removeWaitlightHooks } from './hookConfig';

// "Waitlight: Set up session tracking" and "Waitlight: Remove session tracking".
//
// The only code that changes a file outside Waitlight's own folder. Rules:
//  - ask first, change nothing if you say no;
//  - back up settings.json before writing;
//  - keep every existing setting and hook, only add or remove our own entries;
//  - if settings.json can't be read safely, stop and change nothing.

const settingsFile = () => path.join(claudeDir(), 'settings.json');
const ourFolder = () => path.join(claudeDir(), 'waitlight');
const installedScript = () => path.join(ourFolder(), HOOK_MARKER);

export async function setUpTracking(context: vscode.ExtensionContext): Promise<void> {
  const ok = await vscode.window.showInformationMessage(
    'Set up Claude Code session tracking?',
    {
      modal: true,
      detail:
        `Waitlight will add a few hook entries to ${settingsFile()} so Claude Code tells Waitlight when a session is running, needs you, or is done.\n\n` +
        '• A backup of settings.json is saved first.\n' +
        '• Your existing settings and hooks are kept.\n' +
        '• Everything stays on this computer.\n' +
        '• "Waitlight: Remove session tracking" undoes it.',
    },
    'Set Up',
  );
  if (ok !== 'Set Up') return;

  const node = await findNode();
  if (!node) {
    vscode.window.showErrorMessage(
      'Waitlight needs Node.js to run its hook, but couldn\'t find it. Install Node.js from nodejs.org, then run "Waitlight: Set up session tracking" again.',
    );
    return;
  }

  const settings = readSettings();
  if (settings === undefined) return;

  // Copy the hook script to a fixed place: the extension's own folder
  // changes with every update, which would break the hooks.
  fs.mkdirSync(ourFolder(), { recursive: true });
  fs.copyFileSync(context.asAbsolutePath(path.join('hooks', HOOK_MARKER)), installedScript());

  const command = `"${node}" "${installedScript()}"`;
  const backup = writeSettings(addWaitlightHooks(settings, command));
  vscode.window.showInformationMessage(
    `Session tracking is on. Send a message in a Claude Code chat to see it in Waitlight.${backup ? ` Backup: ${backup}` : ''}`,
  );
}

export async function removeTracking(): Promise<void> {
  const settings = readSettings();
  if (settings === undefined) return;
  if (!hasWaitlightHooks(settings)) {
    vscode.window.showInformationMessage('Waitlight session tracking is not set up, so there is nothing to remove.');
    return;
  }
  const ok = await vscode.window.showWarningMessage(
    'Remove Waitlight session tracking?',
    {
      modal: true,
      detail: `Only Waitlight's own hook entries are removed from ${settingsFile()}. A backup is saved first. Your other settings and hooks are not touched.`,
    },
    'Remove',
  );
  if (ok !== 'Remove') return;

  const backup = writeSettings(removeWaitlightHooks(settings));
  fs.rmSync(installedScript(), { force: true });
  fs.rmSync(path.join(ourFolder(), 'sessions'), { recursive: true, force: true });
  vscode.window.showInformationMessage(`Waitlight session tracking removed.${backup ? ` Backup: ${backup}` : ''}`);
}

// Keeps the installed copy of the hook script in step with the extension
// after an update. Only touches our own file.
export function refreshInstalledScript(context: vscode.ExtensionContext): void {
  try {
    const bundled = fs.readFileSync(context.asAbsolutePath(path.join('hooks', HOOK_MARKER)), 'utf8');
    const installed = fs.existsSync(installedScript()) ? fs.readFileSync(installedScript(), 'utf8') : '';
    if (bundled !== installed) fs.writeFileSync(installedScript(), bundled);
  } catch {
    // not critical
  }
}

export function isTrackingSetUp(): boolean {
  const s = readSettingsQuietly();
  return !!s && hasWaitlightHooks(s);
}

// ---------- settings.json ----------

// Returns the parsed settings, {} if the file doesn't exist, or undefined
// (after telling you why) if it exists but can't be read safely.
function readSettings(): Record<string, any> | undefined {
  const file = settingsFile();
  if (!fs.existsSync(file)) return {};
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data && typeof data === 'object' && !Array.isArray(data)) return data;
    throw new Error('not a JSON object');
  } catch (e: any) {
    vscode.window.showErrorMessage(
      `Waitlight couldn't read ${file} (${e.message}), so it changed nothing. Fix the file or set up the hooks by hand.`,
    );
    return undefined;
  }
}

function readSettingsQuietly(): Record<string, any> | undefined {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  } catch {
    return undefined;
  }
}

// Backs up the current file (if any), then writes the new one atomically.
// Returns the backup's path.
function writeSettings(data: Record<string, any>): string | undefined {
  const file = settingsFile();
  let backup: string | undefined;
  if (fs.existsSync(file)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    backup = `${file}.waitlight-backup-${stamp}`;
    fs.copyFileSync(file, backup);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.waitlight.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
  return backup;
}

// ---------- finding Node.js ----------

// Claude runs our hook with a plain shell, which may not see the same PATH as
// your terminal (e.g. Node installed with nvm). So we look up Node's full
// path once, here, and write that into the hook command.
async function findNode(): Promise<string | undefined> {
  const candidates: string[] = [];
  if (process.platform === 'win32') {
    candidates.push(...(await run('where', ['node'])));
  } else {
    // A login + interactive shell loads your profile, like your terminal does.
    const shell = process.env.SHELL || '/bin/sh';
    candidates.push(...(await run(shell, ['-ilc', 'command -v node'])));
    candidates.push('/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node');
  }
  return candidates.map((c) => c.trim()).find((c) => path.isAbsolute(c) && fs.existsSync(c));
}

function run(cmd: string, args: string[]): Promise<string[]> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 5000 }, (_err, stdout) => resolve(String(stdout ?? '').split(/\r?\n/)));
  });
}
