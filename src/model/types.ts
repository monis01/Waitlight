// The shared "language" of Waitlight. Every agent adapter (Claude now,
// Codex/Gemini later) writes status files in this shape, and the UI only
// ever reads this shape.

export type SessionState = 'needsYou' | 'working' | 'done' | 'idle';

// All times are milliseconds since 1970 (Date.now()), so they're the same
// everywhere; we only turn them into local, readable text when displaying.
export interface Prompt {
  text: string;
  at?: number;            // when you sent it
  images?: number;        // how many images you attached
  // Where this prompt's line sits in Claude's chat log, so its images can be
  // loaded only when you hover (they're too big to keep in memory).
  source?: { file: string; offset: number; length: number };
}

export interface Session {
  agent: string;          // e.g. "claude"
  sessionId: string;
  state: SessionState;
  cwd: string;            // folder the session runs in
  title?: string;         // tab title, when known
  lastPrompt?: string;
  prompts?: Prompt[];     // what you asked, oldest first (from transcripts later)
  startedAt?: number;     // when the session began (keeps the list order stable)
  stateSince?: number;    // when the current state began ("needs you · 4m")
  updatedAt: number;      // last activity of any kind
  transcriptPath?: string; // Claude's full chat log for this session
  waitingFor?: string;    // why it needs you, e.g. "Permission to run: npm test"
}

// Display order: things that need you float to the top.
export const STATE_ORDER: SessionState[] = ['needsYou', 'working', 'done', 'idle'];

export const STATE_LABEL: Record<SessionState, string> = {
  needsYou: 'Needs you',
  working: 'Running',
  done: 'Done',
  idle: 'Idle',
};
