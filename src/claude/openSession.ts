import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { Session } from '../model/types';

// Opens (or focuses, if already open) a session's Claude Code chat tab.
//
// Claude Code documents a link for this:
//   vscode://anthropic.claude-code/open?session=<session-id>
// but a link goes through the operating system, which may deliver it to a
// different editor window, where Claude can't find the chat and starts a
// new, empty one instead. Behind that link, Claude runs its own command
// "claude-vscode.primaryEditor.open" with the session id. We call that
// command directly so it runs in THIS window, and use the link only if the
// command isn't there (e.g. a future Claude Code version renamed it).
const CLAUDE_OPEN_COMMAND = 'claude-vscode.primaryEditor.open';

export async function openClaudeSession(session: Session): Promise<void> {
  if (session.sessionId.endsWith('-fake')) {
    vscode.window.showInformationMessage(
      'Waitlight: this is a fake session. Clicking a real session will open its Claude Code tab.',
    );
    return;
  }

  // Claude can only reopen chats that belong to a folder open in this window.
  // Otherwise it would quietly start a new chat, so we explain instead.
  if (!belongsToThisWindow(session.cwd)) {
    vscode.window.showInformationMessage(
      `This chat belongs to "${path.basename(session.cwd)}" (${session.cwd}). Open it from a window with that folder open.`,
    );
    return;
  }

  const commands = await vscode.commands.getCommands(true);
  if (commands.includes(CLAUDE_OPEN_COMMAND)) {
    await vscode.commands.executeCommand(CLAUDE_OPEN_COMMAND, session.sessionId);
    return;
  }

  // Fallback: the documented link. env.uriScheme makes it work in Cursor
  // ("cursor://"), Windsurf, VSCodium, etc.
  const uri = vscode.Uri.from({
    scheme: vscode.env.uriScheme,
    authority: 'anthropic.claude-code',
    path: '/open',
    query: `session=${encodeURIComponent(session.sessionId)}`,
  });
  await vscode.env.openExternal(uri);
}

// With no folder open, Claude uses your home folder, so treat that as "this window".
function belongsToThisWindow(cwd: string): boolean {
  if (!cwd) return true;
  const caseless = process.platform !== 'linux';
  const norm = (p: string) => (caseless ? path.resolve(p).toLowerCase() : path.resolve(p));
  const target = norm(cwd);
  const folders = vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath);
  if (!folders?.length) return target === norm(os.homedir()); // exactly home, not anything under it
  return folders.some((f) => {
    const root = norm(f);
    return target === root || target.startsWith(root + path.sep);
  });
}
