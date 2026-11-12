// Tests for adding/removing Waitlight's entries in Claude's settings.json.
// A mistake here would damage someone's Claude settings, so it's covered well.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addWaitlightHooks, hasWaitlightHooks, HOOK_EVENTS, removeWaitlightHooks } from '../src/claude/hookConfig';

const CMD = '"/usr/local/bin/node" "/home/me/.claude/waitlight/waitlight-hook.js"';

const userSettings = () => ({
  effortLevel: 'high',
  permissions: { allow: ['Bash(npm test)'] },
  hooks: {
    Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }],
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo checking' }] }],
  },
});

test('adds one entry per event and keeps existing hooks', () => {
  const result = addWaitlightHooks(userSettings(), CMD);
  for (const [event] of HOOK_EVENTS) {
    const ours = result.hooks[event].filter((g: any) => g.hooks.some((h: any) => h.command === CMD));
    assert.equal(ours.length, 1, event);
  }
  assert.equal(result.hooks.Stop[0].hooks[0].command, 'say done');
  assert.equal(result.hooks.PreToolUse[0].matcher, 'Bash');
  assert.equal(result.effortLevel, 'high');
  assert.ok(hasWaitlightHooks(result));
});

test('AskUserQuestion matcher is set only on PreToolUse', () => {
  const result = addWaitlightHooks({}, CMD);
  assert.equal(result.hooks.PreToolUse[0].matcher, 'AskUserQuestion');
  assert.equal(result.hooks.Stop[0].matcher, undefined);
});

test('running setup twice does not add duplicates', () => {
  const once = addWaitlightHooks(userSettings(), CMD);
  const twice = addWaitlightHooks(once, CMD);
  assert.deepEqual(twice, once);
});

test('add then remove gives back exactly the original settings', () => {
  const original = userSettings();
  assert.deepEqual(removeWaitlightHooks(addWaitlightHooks(original, CMD)), original);
});

test('removing from settings with only our hooks drops the hooks key', () => {
  assert.deepEqual(removeWaitlightHooks(addWaitlightHooks({ a: 1 }, CMD)), { a: 1 });
});

test('removing keeps other hooks that share a group with ours', () => {
  const settings = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }, { type: 'command', command: CMD }] }] } };
  assert.deepEqual(removeWaitlightHooks(settings), { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] } });
});

test('unexpected shapes are left alone', () => {
  const settings = { hooks: { Weird: 'not an array', Stop: [{ notHooks: true }] } };
  assert.deepEqual(removeWaitlightHooks(settings), settings);
  assert.equal(hasWaitlightHooks(settings), false);
});

test('does not modify the object passed in', () => {
  const original = userSettings();
  const copy = JSON.parse(JSON.stringify(original));
  addWaitlightHooks(original, CMD);
  removeWaitlightHooks(original);
  assert.deepEqual(original, copy);
});
