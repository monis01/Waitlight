// Pure functions that add or remove Waitlight's entries in Claude Code's
// settings object (the parsed ~/.claude/settings.json). No file access here,
// so this is easy to test.
//
// Claude's format:
//   { "hooks": { "<Event>": [ { "matcher": "...", "hooks": [ { "type": "command", "command": "..." } ] } ] } }
//
// There's no "id" field for hooks, so we recognise ours by the script name
// in the command. Removing only touches entries whose command contains it.

export const HOOK_MARKER = 'waitlight-hook.js';

// [event, matcher]. No matcher = every occurrence of that event.
export const HOOK_EVENTS: Array<[string, string | undefined]> = [
  ['SessionStart', undefined],
  ['UserPromptSubmit', undefined],
  ['PermissionRequest', undefined],
  ['PreToolUse', 'AskUserQuestion'],
  ['PostToolUse', undefined],
  ['Notification', undefined],
  ['Stop', undefined],
  ['SessionEnd', undefined],
];

type Json = Record<string, any>;

const isOurs = (h: any) => typeof h?.command === 'string' && h.command.includes(HOOK_MARKER);

export function removeWaitlightHooks(settings: Json): Json {
  const result: Json = { ...settings };
  if (!result.hooks || typeof result.hooks !== 'object') return result;

  const hooks: Json = {};
  for (const [event, groups] of Object.entries<any>(result.hooks)) {
    if (!Array.isArray(groups)) {
      hooks[event] = groups; // not something we understand: leave it alone
      continue;
    }
    const kept = groups
      .map((g) => (Array.isArray(g?.hooks) ? { ...g, hooks: g.hooks.filter((h: any) => !isOurs(h)) } : g))
      .filter((g) => !Array.isArray(g?.hooks) || g.hooks.length > 0);
    if (kept.length) hooks[event] = kept;
  }
  if (Object.keys(hooks).length) result.hooks = hooks;
  else delete result.hooks;
  return result;
}

export function addWaitlightHooks(settings: Json, command: string): Json {
  const result = removeWaitlightHooks(settings); // never add twice
  const hooks: Json = { ...(result.hooks ?? {}) };
  for (const [event, matcher] of HOOK_EVENTS) {
    const group: Json = { hooks: [{ type: 'command', command, timeout: 10 }] };
    if (matcher) group.matcher = matcher;
    hooks[event] = [...(Array.isArray(hooks[event]) ? hooks[event] : []), group];
  }
  result.hooks = hooks;
  return result;
}

export function hasWaitlightHooks(settings: Json): boolean {
  return Object.values<any>(settings?.hooks ?? {}).some(
    (groups) => Array.isArray(groups) && groups.some((g) => Array.isArray(g?.hooks) && g.hooks.some(isOurs)),
  );
}
