import * as vscode from 'vscode';
import { Session } from '../model/types';

// All the ways we turn times into words. Times are stored as Date.now()
// numbers and only formatted here, in the editor's language and the
// computer's time zone.

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const locale = () => vscode.env.language;

// A length of time: "<1m", "4m", "1h 5m"
export function duration(ms: number): string {
  if (ms < MIN) return '<1m';
  const m = Math.floor(ms / MIN);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}

// A moment in the past: "just now", "5m ago", "2h ago", "yesterday", "Nov 3"
export function ago(t: number): string {
  const now = Date.now();
  const diff = now - t;
  if (diff < MIN) return 'just now';
  if (diff < HOUR) return `${Math.floor(diff / MIN)}m ago`;
  if (sameDay(t, now)) return `${Math.floor(diff / HOUR)}h ago`;
  if (sameDay(t, now - 24 * HOUR)) return 'yesterday';
  return shortDate(t);
}

export function clock(t: number): string {
  return new Date(t).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' });
}

// "5:20 PM" today, otherwise "Nov 6, 2:55 PM"
export function stamp(t: number): string {
  return sameDay(t, Date.now()) ? clock(t) : `${shortDate(t)}, ${clock(t)}`;
}

// "Saturday, November 7, 2026 at 5:20 PM"
export function fullDate(t: number): string {
  return new Date(t).toLocaleString(locale(), { dateStyle: 'full', timeStyle: 'short' });
}

// Short time for the row, like Timeline: "<1m", "4m", "22h", "yesterday", "Nov 3".
// Counts from when the current state began (idle: from last activity).
export function rowTime(s: Session): string {
  const t = s.state === 'idle' ? s.updatedAt : (s.stateSince ?? s.updatedAt);
  const now = Date.now();
  const diff = now - t;
  if (diff < MIN) return '<1m';
  if (diff < HOUR) return `${Math.floor(diff / MIN)}m`;
  if (diff < 24 * HOUR) return `${Math.floor(diff / HOUR)}h`;
  if (sameDay(t, now - 24 * HOUR)) return 'yesterday';
  return shortDate(t);
}

// The longer "state · time" text for hover cards, e.g. "needs you · 4m".
// Change the words here.
export function stateTime(s: Session): { text: string; since: number; hint: string } {
  const since = s.stateSince ?? s.updatedAt;
  const now = Date.now();
  switch (s.state) {
    case 'needsYou':
      return { text: `needs you · ${duration(now - since)}`, since, hint: 'Waiting for you since' };
    case 'working':
      return { text: `running · ${duration(now - since)}`, since, hint: 'Running since' };
    case 'done':
      return { text: `done · ${ago(since)}`, since, hint: 'Finished' };
    default:
      return { text: `idle · ${ago(s.updatedAt)}`, since: s.updatedAt, hint: 'Last active' };
  }
}

function sameDay(a: number, b: number): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

function shortDate(t: number): string {
  const d = new Date(t);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(locale(), sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}
