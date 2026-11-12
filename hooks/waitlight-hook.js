#!/usr/bin/env node
// Waitlight hook script.
//
// Claude Code runs this on session events (set up by "Waitlight: Set up
// session tracking"). Claude sends the event as JSON on stdin; we turn it
// into a small status file:
//
//   ~/.claude/waitlight/sessions/<session_id>.json
//
// which the Waitlight extension reads. Rules:
//   - Plain Node, no dependencies, so it runs on macOS, Linux and Windows.
//   - Never print anything: for some events Claude reads stdout as an answer.
//   - Never fail: any error is swallowed so Claude is never disturbed.
//   - Everything stays on this computer.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_PROMPTS = 100;
// Notification types that mean Claude is blocked waiting for you.
// ("idle_prompt" just means "waiting for your next prompt", i.e. Done.)
const NEEDS_YOU_NOTIFICATIONS = new Set(['permission_prompt', 'elicitation_dialog']);

const startedAt = Date.now();
const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const ourDir = path.join(claudeDir, 'waitlight');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  try {
    handle(JSON.parse(input));
  } catch {
    // Ignore everything: a status light must never break Claude.
  }
  process.exitCode = 0;
});

function handle(ev) {
  const id = ev.session_id;
  if (typeof id !== 'string' || !/^[\w-]+$/.test(id)) return; // also blocks odd file names
  debugLog(ev);

  const file = path.join(ourDir, 'sessions', `${id}.json`);
  if (ev.hook_event_name === 'SessionEnd') {
    fs.rmSync(file, { force: true });
    return;
  }

  const now = startedAt;
  const s = readJson(file) || {
    agent: 'claude',
    sessionId: id,
    state: 'idle',
    startedAt: now,
    stateSince: now,
    prompts: [],
  };

  const setState = (state, reason) => {
    if (s.state !== state) {
      s.state = state;
      s.stateSince = now; // the time shown in Waitlight counts from here
    }
    // Why Claude is waiting on you, e.g. "Permission to run: npm test".
    if (state === 'needsYou') {
      if (reason) s.waitingFor = reason;
    } else {
      delete s.waitingFor;
    }
  };

  switch (ev.hook_event_name) {
    case 'UserPromptSubmit':
      setState('working');
      if (typeof ev.prompt === 'string' && ev.prompt.trim()) {
        s.prompts.push({ text: cleanPrompt(ev.prompt), at: now });
        if (s.prompts.length > MAX_PROMPTS) s.prompts = s.prompts.slice(-MAX_PROMPTS);
      }
      break;
    case 'PermissionRequest':
      setState('needsYou', permissionReason(ev.tool_name, ev.tool_input));
      break;
    case 'PreToolUse':
      // Only installed for AskUserQuestion: Claude is asking you something.
      if (ev.tool_name === 'AskUserQuestion') setState('needsYou', questionReason(ev.tool_input));
      break;
    case 'PostToolUse':
      setState('working'); // e.g. you approved and the tool ran
      break;
    case 'Notification':
      if (NEEDS_YOU_NOTIFICATIONS.has(ev.notification_type)) {
        // Keep a more specific reason if we already have one.
        setState('needsYou', s.state === 'needsYou' && s.waitingFor ? undefined : short(ev.message));
      }
      break;
    case 'Stop':
      setState('done');
      break;
    // SessionStart and anything else: just record that the session exists.
  }

  if (typeof ev.cwd === 'string') s.cwd = ev.cwd;
  if (typeof ev.session_title === 'string' && ev.session_title) s.title = ev.session_title;
  if (typeof ev.transcript_path === 'string') s.transcriptPath = ev.transcript_path;
  s.updatedAt = now;

  writeJsonAtomic(file, s);
}

// "Permission to run: npm test", "Permission to edit: auth.ts", …
function permissionReason(tool, input) {
  input = input || {};
  const file = input.file_path || input.notebook_path || input.path;
  switch (tool) {
    case 'Bash':
      return `Permission to run: ${short(input.command) || 'a command'}`;
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit':
      return `Permission to edit: ${file ? path.basename(String(file)) : 'a file'}`;
    case 'WebFetch':
      return `Permission to fetch: ${short(input.url) || 'a web page'}`;
    case 'WebSearch':
      return `Permission to search the web${input.query ? `: ${short(input.query)}` : ''}`;
    default:
      return tool ? `Permission to use ${tool}` : 'Permission needed';
  }
}

function questionReason(input) {
  const q = input && Array.isArray(input.questions) && input.questions[0] && input.questions[0].question;
  return q ? `Claude asked: ${short(q)}` : 'Claude asked you a question';
}

// One line, at most 80 characters.
function short(text) {
  if (typeof text !== 'string') return '';
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 80 ? flat.slice(0, 79) + '…' : flat;
}

// Pasted blocks can be huge; show them as "[pasted text]" in the list.
function cleanPrompt(text) {
  return text.replace(/<pasted_content\b[^>]*>[\s\S]*?<\/pasted_content\b[^>]*>/g, '[pasted text]').trim();
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// Write to a temp file, then rename: the extension never sees half a file.
function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

// Only when ~/.claude/waitlight/debug exists: one line per event, to help us
// check which events Claude sends. Never logs prompt text.
function debugLog(ev) {
  if (!fs.existsSync(path.join(ourDir, 'debug'))) return;
  const line = [
    new Date(startedAt).toISOString(),
    ev.hook_event_name,
    String(ev.session_id).slice(0, 8),
    ev.tool_name ? `tool=${ev.tool_name}` : '',
    ev.notification_type ? `notification=${ev.notification_type}` : '',
    ev.source ? `source=${ev.source}` : '',
    ev.reason ? `reason=${ev.reason}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  fs.appendFileSync(path.join(ourDir, 'events.log'), line + '\n');
}
