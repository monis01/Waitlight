import * as vscode from 'vscode';

// Opens (or focuses, if already open) a Claude Code chat tab for a session.
// Claude Code's extension documents this link:
//   vscode://anthropic.claude-code/open?session=<session-id>
// We use env.uriScheme instead of "vscode" so it also works in Cursor
// ("cursor://"), Windsurf, VSCodium, etc.
export async function openClaudeSession(sessionId: string): Promise<void> {
  if (sessionId.endsWith('-fake')) {
    vscode.window.showInformationMessage(
      'Waitlight: this is a fake session. Clicking a real session will open its Claude Code tab.',
    );
    return;
  }
  const uri = vscode.Uri.from({
    scheme: vscode.env.uriScheme,
    authority: 'anthropic.claude-code',
    path: '/open',
    query: `session=${encodeURIComponent(sessionId)}`,
  });
  await vscode.env.openExternal(uri);
}
