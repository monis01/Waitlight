import * as vscode from 'vscode';
import { Session, SessionState } from '../model/types';

// All the "look" decisions in one place, so the design is easy to change.
// Icons are VS Code codicons: https://code.visualstudio.com/api/references/icons-in-labels

// Blue = needs you (matches Claude Code's own tab dot), gold = working,
// green = done, grey = idle.
export const STATE_COLOR: Record<SessionState, string> = {
  needsYou: 'charts.blue',
  working: 'charts.yellow',
  done: 'charts.green',
  idle: 'disabledForeground',
};

// Hover cards can't use theme colors, so they use these fixed colors,
// chosen to match the default themes' chart colors.
export const STATE_HEX: Record<SessionState, string> = {
  needsYou: '#3794ff',
  working: '#e2b93d',
  done: '#89d185',
  idle: '#848484',
};

// A different SHAPE per state, not just a color, so it works for colorblind
// users too. "~spin" makes a codicon rotate: the native way to show "busy".
export const STATE_ICON: Record<SessionState, string> = {
  needsYou: 'bell',
  working: 'loading~spin',
  done: 'check',
  idle: 'circle-outline',
};

export function stateIcon(state: SessionState): vscode.ThemeIcon {
  return new vscode.ThemeIcon(STATE_ICON[state], new vscode.ThemeColor(STATE_COLOR[state]));
}

// A colored dot for hover cards.
export function hexDot(state: SessionState): string {
  return `<span style="color:${STATE_HEX[state]};">●</span>`;
}

// The name shown for a session: its title, else the last thing you asked,
// else "New chat" (an open chat with nothing sent yet).
export function sessionName(s: Session): string {
  return s.title || s.lastPrompt || 'New chat';
}
