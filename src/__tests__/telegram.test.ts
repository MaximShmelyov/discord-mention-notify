import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { buildChannelKeyboard } from '../telegram.js';
import { Store } from '../store.js';
import type { Logger, ChannelEntry } from '../types.js';

function createSilentLogger(): Logger {
  return { log: () => {} };
}

describe('buildChannelKeyboard', () => {
  const entries: ChannelEntry[] = [
    { guildName: 'Server1', channelName: 'general', id: 'ch1' },
    { guildName: 'Server1', channelName: 'dev', id: 'ch2' },
    { guildName: 'Server2', channelName: 'random', id: 'ch3' },
  ];

  it('should mark active channels with ✅', () => {
    const kb = buildChannelKeyboard(entries, ['ch1', 'ch3']);
    const buttons = kb.inline_keyboard.flat();
    assert.ok(buttons[0]?.text.startsWith('✅'));
    assert.ok(buttons[1]?.text.startsWith('❌'));
    assert.ok(buttons[2]?.text.startsWith('✅'));
  });

  it('should include guild and channel name', () => {
    const kb = buildChannelKeyboard(entries, []);
    const buttons = kb.inline_keyboard.flat();
    assert.ok(buttons[0]?.text.includes('Server1 / #general'));
  });

  it('should set callback_data with toggle_ prefix', () => {
    const kb = buildChannelKeyboard(entries, []);
    const buttons = kb.inline_keyboard.flat();
    assert.strictEqual(buttons[0]?.callback_data, 'toggle_ch1');
    assert.strictEqual(buttons[1]?.callback_data, 'toggle_ch2');
  });

  it('should return empty keyboard for empty entries', () => {
    const kb = buildChannelKeyboard([], []);
    // All rows should be empty or the keyboard itself
    assert.strictEqual(kb.inline_keyboard.flat().length, 0);
  });
});

describe('confirmDiscordCode integration', () => {
  let tmpDir: string;
  let dbPath: string;
  let store: Store;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-test-'));
    dbPath = path.join(tmpDir, 'user-db.json');
    store = new Store(dbPath, createSilentLogger());
    store.load();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should link discord account via store.addDiscordLink', () => {
    // Simulate what confirmDiscordCode does internally via store
    store.addDiscordLink('telegram123', 'user#1234', 'discord999');
    const user = store.getUser('telegram123');
    assert.ok(user);
    assert.deepStrictEqual(user.discordTags, ['user#1234']);
    assert.deepStrictEqual(user.discordIds, ['discord999']);
  });

  it('should support multiple discord accounts for one telegram user', () => {
    store.addDiscordLink('telegram123', 'user#1234', 'discord999');
    store.addDiscordLink('telegram123', 'alt#5678', 'discord888');
    const user = store.getUser('telegram123');
    assert.ok(user);
    assert.strictEqual(user.discordTags.length, 2);
    assert.strictEqual(user.discordIds.length, 2);
  });
});
