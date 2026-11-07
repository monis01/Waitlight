import * as vscode from 'vscode';
import { openClaudeSession } from './claude/openSession';
import { SessionStore } from './model/sessionStore';
import { Node, OPEN_COMMAND, SessionTreeProvider } from './ui/sessionTree';
import { StatusBar } from './ui/statusBar';

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
    view.description = show === 'thisFolder' ? 'This folder' : 'All folders';
  };
  updateDescription();

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
      if (id) openClaudeSession(id);
    }),
    // Title bar buttons (see "menus" > "view/title" in package.json).
    vscode.commands.registerCommand('waitlight.refresh', () => store.refresh(true)),
    vscode.commands.registerCommand('waitlight.showThisFolder', () => setShow('thisFolder')),
    vscode.commands.registerCommand('waitlight.showAllFolders', () => setShow('all')),
    vscode.commands.registerCommand('waitlight.openSettings', () =>
      vscode.commands.executeCommand('workbench.action.openSettings', `@ext:${context.extension.id}`),
    ),
    vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration('waitlight.show') && updateDescription()),
  );
}

// Everything in context.subscriptions is cleaned up automatically.
export function deactivate() {}
