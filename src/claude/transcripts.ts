import * as fs from 'fs';
import * as path from 'path';
import { Prompt } from '../model/types';

// Reads Claude Code's chat logs ("transcripts") to list what you asked and
// get the chat's title. Claude keeps one file per session:
//   ~/.claude/projects/<folder-with-dashes>/<sessionId>.jsonl
// Each line is one JSON record. The format is not documented, so every
// field is checked and anything unexpected is skipped.
//
// Logs can be large and grow while Claude works, so we only read the bytes
// added since last time (and remember where we stopped). Images you attach
// are stored inside the log; we only count them here and load them on hover
// (see readPromptImages).

export interface TranscriptInfo {
  prompts: Prompt[];
  title?: string;
}

interface Parsed {
  prompts: Prompt[];
  aiTitle?: string;
  customTitle?: string;
}

interface CacheEntry {
  offset: number; // bytes already read
  rest: Buffer;   // an unfinished last line, kept until the rest arrives
  parsed: Parsed;
}

const cache = new Map<string, CacheEntry>();

// Where Claude puts a session's log: the folder path with every character
// that isn't a letter or digit replaced by "-".
export function transcriptPath(claudeDir: string, sessionId: string, cwd: string | undefined): string | undefined {
  if (!cwd || !/^[\w-]+$/.test(sessionId)) return undefined;
  const file = path.join(claudeDir, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${sessionId}.jsonl`);
  return fs.existsSync(file) ? file : undefined;
}

export function readTranscript(file: string): TranscriptInfo | undefined {
  let size: number;
  try {
    size = fs.statSync(file).size;
  } catch {
    return undefined;
  }

  let entry = cache.get(file);
  if (!entry || size < entry.offset) {
    entry = { offset: 0, rest: Buffer.alloc(0), parsed: { prompts: [] } };
    cache.set(file, entry);
  }

  if (size > entry.offset) {
    const added = Buffer.alloc(size - entry.offset);
    const fd = fs.openSync(file, 'r');
    try {
      fs.readSync(fd, added, 0, added.length, entry.offset);
    } finally {
      fs.closeSync(fd);
    }
    const data = Buffer.concat([entry.rest, added]);
    const dataStart = entry.offset - entry.rest.length; // file position of data[0]
    entry.offset = size;

    // Split on bytes, not text, so a character cut in half is never garbled,
    // and so we know each line's exact position in the file.
    let pos = 0;
    let nl: number;
    while ((nl = data.indexOf(10, pos)) >= 0) {
      parseLine(entry.parsed, data.subarray(pos, nl).toString('utf8'), { file, offset: dataStart + pos, length: nl - pos });
      pos = nl + 1;
    }
    entry.rest = data.subarray(pos);
  }

  const p = entry.parsed;
  return { prompts: p.prompts, title: p.customTitle ?? p.aiTitle };
}

// Forget logs we no longer need (closed chats).
export function forgetTranscriptsExcept(keep: Set<string>): void {
  for (const file of cache.keys()) if (!keep.has(file)) cache.delete(file);
}

// Loads a prompt's images from the log, as data: URIs ready for a hover card.
// Called only when you hover over that prompt.
export function readPromptImages(prompt: Prompt, max = 3, maxBytes = 8 * 1024 * 1024): string[] {
  const src = prompt.source;
  if (!src || !prompt.images) return [];
  try {
    const buf = Buffer.alloc(src.length);
    const fd = fs.openSync(src.file, 'r');
    try {
      fs.readSync(fd, buf, 0, src.length, src.offset);
    } finally {
      fs.closeSync(fd);
    }
    const content = JSON.parse(buf.toString('utf8'))?.message?.content;
    if (!Array.isArray(content)) return [];
    return content
      .filter((b) => b?.type === 'image' && b.source?.type === 'base64' && typeof b.source.data === 'string')
      .filter((b) => /^image\/(png|jpeg|gif|webp)$/.test(b.source.media_type) && b.source.data.length <= maxBytes)
      .slice(0, max)
      .map((b) => `data:${b.source.media_type};base64,${b.source.data}`);
  } catch {
    return []; // log changed or unreadable: just show no preview
  }
}

// ---------- one line of the log ----------

export function parseLine(p: Parsed, line: string, source?: Prompt['source']): void {
  if (!line.trim()) return;
  let d: any;
  try {
    d = JSON.parse(line);
  } catch {
    return;
  }

  if (d.type === 'ai-title' && typeof d.aiTitle === 'string') p.aiTitle = d.aiTitle;
  if (d.type === 'custom-title' && typeof d.customTitle === 'string') p.customTitle = d.customTitle;

  if (d.type !== 'user' || d.isSidechain || d.isMeta) return;
  // Only messages you typed. Claude also logs its own notices (e.g. a
  // background task reporting progress) as "user" lines.
  if (d.origin && d.origin.kind !== 'human') return;

  const content = d.message?.content;
  const images = Array.isArray(content) ? content.filter((b) => b?.type === 'image').length : 0;
  const text = promptText(content);
  if (!text && !images) return;

  const prompt: Prompt = { text };
  const at = Date.parse(d.timestamp);
  if (!Number.isNaN(at)) prompt.at = at;
  if (images) {
    prompt.images = images;
    prompt.source = source;
  }
  p.prompts.push(prompt);
}

// A block that is entirely one tag, e.g. "<browser_instruction>…</browser_instruction>":
// context added by the editor or tools, not something you typed.
const WHOLE_TAG_BLOCK = /^\s*<([\w-]+)[^>]*>[\s\S]*<\/\1>\s*$/;
// "[Image: source: /tmp/…/1.png]" or "[Image #1]": Claude's note to the AI
// model that an image is attached. Not meant for people; we show 🖼 instead.
const IMAGE_NOTE = /^\s*\[Image\b[^\]]*\]\s*$/gm;

function promptText(content: unknown): string {
  let text = '';
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    if (content.some((b) => b?.type === 'tool_result')) return ''; // a tool's output, not a prompt
    text = content
      .filter((b) => b?.type === 'text' && typeof b.text === 'string' && !WHOLE_TAG_BLOCK.test(b.text))
      .map((b) => b.text)
      .join('\n');
  }
  text = text
    .replace(/<pasted_content\b[^>]*>[\s\S]*?<\/pasted_content\b[^>]*>/g, '[pasted text]')
    .replace(IMAGE_NOTE, '')
    .trim();
  // Leftover system lines: interrupt markers, slash-command records, etc.
  if (!text || text.startsWith('[Request interrupted') || WHOLE_TAG_BLOCK.test(text)) return '';
  return text;
}
