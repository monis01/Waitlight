// Tests for reading Claude's chat logs: which lines count as your prompts,
// what gets cleaned out, titles, images, and reading a growing file.
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { parseLine, readPromptImages, readTranscript } from '../src/claude/transcripts';

const human = (content: unknown, extra: object = {}) =>
  JSON.stringify({ type: 'user', origin: { kind: 'human' }, timestamp: '2026-11-09T18:42:24.922Z', message: { role: 'user', content }, ...extra });

const parse = (...lines: string[]) => {
  const p: any = { prompts: [] };
  for (const l of lines) parseLine(p, l);
  return p;
};

test('a typed prompt is kept, with its time', () => {
  const p = parse(human('can you count to 10'));
  assert.equal(p.prompts.length, 1);
  assert.equal(p.prompts[0].text, 'can you count to 10');
  assert.equal(p.prompts[0].at, Date.parse('2026-11-09T18:42:24.922Z'));
});

test("Claude's own notices are skipped", () => {
  const notice = JSON.stringify({ type: 'user', origin: { kind: 'task-notification' }, message: { content: '<task-notification>…</task-notification>' } });
  const toolResult = human([{ type: 'tool_result', content: 'ok' }]);
  const interrupted = JSON.stringify({ type: 'user', message: { content: '[Request interrupted by user]' } });
  const sidechain = human('sub-agent prompt', { isSidechain: true });
  assert.equal(parse(notice, toolResult, interrupted, sidechain).prompts.length, 0);
});

test('editor-added blocks are stripped, your text kept', () => {
  const p = parse(human([{ type: 'text', text: '<browser_instruction>long instructions</browser_instruction>' }, { type: 'text', text: 'Hello,' }]));
  assert.equal(p.prompts[0].text, 'Hello,');
});

test('pasted blocks become [pasted text]', () => {
  const p = parse(human('fix this <pasted_content id="1">huge log</pasted_content id="1">'));
  assert.equal(p.prompts[0].text, 'fix this [pasted text]');
});

test('image notes are removed and images counted', () => {
  const img = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } };
  const p = parse(human([{ type: 'text', text: 'look at this\n[Image: source: /tmp/x/1.png]' }, img, img]));
  assert.equal(p.prompts[0].text, 'look at this');
  assert.equal(p.prompts[0].images, 2);
});

test('an image note typed mid-sentence is kept', () => {
  const p = parse(human('Claude writes [Image: source: /tmp/1.png], why?'));
  assert.equal(p.prompts[0].text, 'Claude writes [Image: source: /tmp/1.png], why?');
});

test('an image-only prompt is kept', () => {
  const img = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } };
  const p = parse(human([img]));
  assert.equal(p.prompts.length, 1);
  assert.equal(p.prompts[0].text, '');
  assert.equal(p.prompts[0].images, 1);
});

test('titles: a custom title wins over the AI title', () => {
  const p = parse(JSON.stringify({ type: 'ai-title', aiTitle: 'AI name' }), JSON.stringify({ type: 'custom-title', customTitle: 'My name' }));
  assert.equal(p.aiTitle, 'AI name');
  assert.equal(p.customTitle, 'My name');
});

test('broken lines are ignored', () => {
  assert.equal(parse('not json', '', '{"type":"user"}').prompts.length, 0);
});

test('reads a growing file, including a line split across two writes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'waitlight-test-'));
  const file = path.join(dir, 'session.jsonl');
  const second = human('second prompt — with “unicode” ✓');
  fs.writeFileSync(file, human('first prompt') + '\n' + second.slice(0, 30));
  assert.deepEqual(readTranscript(file)!.prompts.map((p) => p.text), ['first prompt']);

  fs.appendFileSync(file, second.slice(30) + '\n' + JSON.stringify({ type: 'ai-title', aiTitle: 'Counting' }) + '\n');
  const info = readTranscript(file)!;
  assert.deepEqual(info.prompts.map((p) => p.text), ['first prompt', 'second prompt — with “unicode” ✓']);
  assert.equal(info.title, 'Counting');
  fs.rmSync(dir, { recursive: true, force: true });
});

test("loads a prompt's images on demand", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'waitlight-test-'));
  const file = path.join(dir, 'session.jsonl');
  const img = (data: string) => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data } });
  fs.writeFileSync(file, human('hi') + '\n' + human([{ type: 'text', text: 'pics' }, img('AAA'), img('BBB')]) + '\n');
  const prompt = readTranscript(file)!.prompts[1];
  assert.equal(prompt.images, 2);
  assert.deepEqual(readPromptImages(prompt), ['data:image/png;base64,AAA', 'data:image/png;base64,BBB']);
  assert.deepEqual(readPromptImages(prompt, 1), ['data:image/png;base64,AAA']);
  fs.rmSync(dir, { recursive: true, force: true });
});
