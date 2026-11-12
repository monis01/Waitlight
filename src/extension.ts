import * as vscode from 'vscode';
import { checkSetup } from './claude/checkSetup';
import { isTrackingSetUp, refreshInstalledScript, removeTracking, setUpTracking } from './claude/installer';
import { openClaudeSession } from './claude/openSession';
import { SessionStore } from './model/sessionStore';
import { Node, OPEN_COMMAND, SessionTreeProvider } from './ui/sessionTree';
import { needsYouLongestFirst, StatusBar } from './ui/statusBar';

// VS Code calls activate() once, shortly after the editor starts
// (see "activationEvents" in package.json). We wire the pieces together here.
export function activate(context: vscode.ExtensionContext) {
  const store = new SessionStore();
  const statusBar = new StatusBar(store);
  const tree = new SessionTreeProvider(store);
  const view = vscode.window.createTreeView('waitlight.sessions', { treeDataProvider: tree, showCollapseAll: true });

  // Number badge on the section header when sessions need you.
  const updateBadge = () => {
    const n = store.getSessions().filter((s) => s.state === 'needsYou').length;
    view.badge = n ? { value: n, tooltip: `${n} need${n === 1 ? 's' : ''} you` } : undefined;
  };
  store.onDidChange(updateBadge);
  updateBadge();

  // Small label next to the section title, like Timeline's "Workspace".
  const updateDescription = () => {
    const show = vscode.workspace.getConfiguration('waitlight').get<string>('show', 'all');
    const scope = show === 'thisFolder' ? 'This folder' : 'All folders';
    // Make fake mode obvious, so it's never mistaken for real sessions.
    view.description = process.env.WAITLIGHT_SESSIONS_DIR ? `Fake sessions · ${scope}` : scope;
  };
  updateDescription();

  // Remembered as a "context key" so package.json can show "Set up" or
  // "Remove" in the ⋯ menu, whichever applies.
  const updateTrackingKey = () =>
    vscode.commands.executeCommand('setContext', 'waitlight.trackingOn', isTrackingSetUp());
  updateTrackingKey();
  // If tracking is on, make sure the installed hook script is this version's.
  if (isTrackingSetUp()) refreshInstalledScript(context);

  // "Next session that needs me": each press jumps to the next waiting chat,
  // starting with the one that has waited longest.
  let lastJumped: string | undefined;
  const nextNeedsYou = async () => {
    const waiting = needsYouLongestFirst(store.getSessions());
    if (!waiting.length) {
      vscode.window.setStatusBarMessage('$(check) No Claude sessions need you', 3000);
      return;
    }
    const i = waiting.findIndex((s) => s.sessionId === lastJumped);
    const next = waiting[(i + 1) % waiting.length];
    lastJumped = next.sessionId;
    await openClaudeSession(next);
  };

  const setShow = (value: 'all' | 'thisFolder') =>
    vscode.workspace.getConfiguration('waitlight').update('show', value, vscode.ConfigurationTarget.Global);

  context.subscriptions.push(
    store,
    statusBar,
    tree,
    view,
    // Called from the row's "Open chat" button (gets the row) or from the
    // hover card link (gets the session id).
    vscode.commands.registerCommand(OPEN_COMMAND, (arg: Node | string) => {
      const id = typeof arg === 'string' ? arg : arg?.session.sessionId;
      const session = store.getSessions().find((s) => s.sessionId === id);
      if (session) openClaudeSession(session);
    }),
    // Title bar buttons (see "menus" > "view/title" in package.json).
    vscode.commands.registerCommand('waitlight.refresh', () => store.refresh(true)),
    vscode.commands.registerCommand('waitlight.showThisFolder', () => setShow('thisFolder')),
    vscode.commands.registerCommand('waitlight.showAllFolders', () => setShow('all')),
    vscode.commands.registerCommand('waitlight.openSettings', () =>
      vscode.commands.executeCommand('workbench.action.openSettings', `@ext:${context.extension.id}`),
    ),
    vscode.commands.registerCommand('waitlight.nextNeedsYou', nextNeedsYou),
    vscode.commands.registerCommand('waitlight.copyPrompt', async (node: Node) => {
      if (node?.kind !== 'prompt') return;
      await vscode.env.clipboard.writeText(node.prompt.text);
      vscode.window.setStatusBarMessage('$(copy) Prompt copied', 2000);
    }),
    vscode.commands.registerCommand('waitlight.checkSetup', () => checkSetup(context)),
    vscode.commands.registerCommand('waitlight.setUpTracking', async () => {
      await setUpTracking(context);
      updateTrackingKey();
    }),
    vscode.commands.registerCommand('waitlight.removeTracking', async () => {
      await removeTracking();
      updateTrackingKey();
    }),
    vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration('waitlight.show') && updateDescription()),
  );
}

// Everything in context.subscriptions is cleaned up automatically.
export function deactivate() {}
