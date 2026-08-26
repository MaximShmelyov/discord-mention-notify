import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  buildChannelKeyboard,
  buildAccountKeyboard,
  buildUnregisterKeyboard,
  mergeChannelEntries,
} from '../telegram.js';
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
    const kb = buildChannelKeyboard(entries, ['ch1', 'ch3'], 'd1', false);
    const buttons = kb.inline_keyboard.flat();
    assert.ok(buttons[0]?.text.startsWith('✅'));
    assert.ok(buttons[1]?.text.startsWith('❌'));
    assert.ok(buttons[2]?.text.startsWith('✅'));
  });

  it('should include guild and channel name', () => {
    const kb = buildChannelKeyboard(entries, [], 'd1', false);
    const buttons = kb.inline_keyboard.flat();
    assert.ok(buttons[0]?.text.includes('Server1 / #general'));
  });

  it('should set callback_data with ch_{discordId}_{channelId} format', () => {
    const kb = buildChannelKeyboard(entries, [], 'd1', false);
    const buttons = kb.inline_keyboard.flat();
    assert.strictEqual(buttons[0]?.callback_data, 'ch_d1_ch1');
    assert.strictEqual(buttons[1]?.callback_data, 'ch_d1_ch2');
    assert.strictEqual(buttons[2]?.callback_data, 'ch_d1_ch3');
  });

  it('should include back button when showBack is true', () => {
    const kb = buildChannelKeyboard(entries, [], 'd1', true);
    const allButtons = kb.inline_keyboard.flat();
    const backButton = allButtons.find((b) => b.callback_data === 'back_accts');
    assert.ok(backButton, 'back button must be present');
    assert.ok(backButton!.text.includes('Back'));
  });

  it('should not include back button when showBack is false', () => {
    const kb = buildChannelKeyboard(entries, [], 'd1', false);
    const allButtons = kb.inline_keyboard.flat();
    const backButton = allButtons.find((b) => b.callback_data === 'back_accts');
    assert.strictEqual(backButton, undefined, 'back button must not be present');
  });

  it('should return empty keyboard for empty entries (no back)', () => {
    const kb = buildChannelKeyboard([], [], 'd1', false);
    assert.strictEqual(kb.inline_keyboard.flat().length, 0);
  });

  it('should return only back button for empty entries with showBack', () => {
    const kb = buildChannelKeyboard([], [], 'd1', true);
    const buttons = kb.inline_keyboard.flat();
    assert.strictEqual(buttons.length, 1);
    assert.strictEqual(buttons[0]?.callback_data, 'back_accts');
  });
});

describe('buildAccountKeyboard', () => {
  it('should create a button per discord account', () => {
    const kb = buildAccountKeyboard(['user#1234', 'alt#5678'], ['d1', 'd2']);
    const buttons = kb.inline_keyboard.flat();
    assert.strictEqual(buttons.length, 2);
    assert.ok(buttons[0]?.text.includes('user#1234'));
    assert.ok(buttons[1]?.text.includes('alt#5678'));
  });

  it('should set callback_data with acct_ prefix', () => {
    const kb = buildAccountKeyboard(['user#1234'], ['d1']);
    const buttons = kb.inline_keyboard.flat();
    assert.strictEqual(buttons[0]?.callback_data, 'acct_d1');
  });

  it('should return empty keyboard for no accounts', () => {
    const kb = buildAccountKeyboard([], []);
    assert.strictEqual(kb.inline_keyboard.flat().length, 0);
  });
});

describe('buildUnregisterKeyboard', () => {
  it('should create a button per discord account with ❌ prefix', () => {
    const kb = buildUnregisterKeyboard(['user#1234', 'alt#5678'], ['d1', 'd2']);
    const buttons = kb.inline_keyboard.flat();
    assert.strictEqual(buttons.length, 2);
    assert.ok(buttons[0]?.text.includes('❌'));
    assert.ok(buttons[0]?.text.includes('user#1234'));
    assert.ok(buttons[1]?.text.includes('alt#5678'));
  });

  it('should set callback_data with unreg_ prefix', () => {
    const kb = buildUnregisterKeyboard(['user#1234'], ['d1']);
    const buttons = kb.inline_keyboard.flat();
    assert.strictEqual(buttons[0]?.callback_data, 'unreg_d1');
  });

  it('should return empty keyboard for no accounts', () => {
    const kb = buildUnregisterKeyboard([], []);
    assert.strictEqual(kb.inline_keyboard.flat().length, 0);
  });
});

describe('mergeChannelEntries', () => {
  const guild1Channels: ChannelEntry[] = [
    { guildName: 'Server1', channelName: 'general', id: 'ch1' },
    { guildName: 'Server1', channelName: 'dev', id: 'ch2' },
  ];
  const guild2Channels: ChannelEntry[] = [
    { guildName: 'Server2', channelName: 'random', id: 'ch3' },
  ];

  it('should not produce duplicates when same channels are added twice', () => {
    const first = mergeChannelEntries([], guild1Channels);
    const second = mergeChannelEntries(first, guild1Channels);
    assert.strictEqual(second.length, 2);
    assert.deepStrictEqual(
      second.map((e) => e.id),
      ['ch1', 'ch2'],
    );
  });

  it('should not duplicate channels for user with multiple discord accounts on same guild', () => {
    let entries: ChannelEntry[] = [];
    entries = mergeChannelEntries(entries, guild1Channels);
    entries = mergeChannelEntries(entries, guild1Channels);
    entries = mergeChannelEntries(entries, guild2Channels);
    assert.strictEqual(entries.length, 3);
    assert.deepStrictEqual(
      entries.map((e) => e.id),
      ['ch1', 'ch2', 'ch3'],
    );
  });

  it('should add non-overlapping entries from different guilds', () => {
    const merged = mergeChannelEntries(guild1Channels, guild2Channels);
    assert.strictEqual(merged.length, 3);
    assert.deepStrictEqual(
      merged.map((e) => e.id),
      ['ch1', 'ch2', 'ch3'],
    );
  });

  it('should keep only unique entries on partial overlap', () => {
    const overlap: ChannelEntry[] = [
      { guildName: 'Server1', channelName: 'general', id: 'ch1' },
      { guildName: 'Server3', channelName: 'music', id: 'ch4' },
    ];
    const merged = mergeChannelEntries(guild1Channels, overlap);
    assert.strictEqual(merged.length, 3);
    assert.deepStrictEqual(
      merged.map((e) => e.id),
      ['ch1', 'ch2', 'ch4'],
    );
  });

  it('should return empty array when both inputs are empty', () => {
    const merged = mergeChannelEntries([], []);
    assert.strictEqual(merged.length, 0);
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

  it('should not duplicate the same discord account for the same telegram user', () => {
    store.addDiscordLink('telegram123', 'user#1234', 'discord999');
    store.addDiscordLink('telegram123', 'user#1234', 'discord999');
    const user = store.getUser('telegram123');
    assert.ok(user);
    assert.strictEqual(user.discordTags.length, 1, 'tag must not be duplicated');
    assert.strictEqual(user.discordIds.length, 1, 'id must not be duplicated');
  });

  it('should return false when discord account is already linked', () => {
    const first = store.addDiscordLink('telegram123', 'user#1234', 'discord999');
    const second = store.addDiscordLink('telegram123', 'user#1234', 'discord999');
    assert.strictEqual(first, true);
    assert.strictEqual(second, false);
  });

  it('should allow the same discord account to link to different telegram users', () => {
    store.addDiscordLink('telegram111', 'user#1234', 'discord999');
    store.addDiscordLink('telegram222', 'user#1234', 'discord999');
    const user1 = store.getUser('telegram111');
    const user2 = store.getUser('telegram222');
    assert.ok(user1);
    assert.ok(user2);
    assert.deepStrictEqual(user1.discordIds, ['discord999']);
    assert.deepStrictEqual(user2.discordIds, ['discord999']);
  });

  it('should not emit userLinked when discord account is already linked', () => {
    let linkCount = 0;
    store.on('userLinked', () => {
      linkCount++;
    });
    store.addDiscordLink('telegram123', 'user#1234', 'discord999');
    store.addDiscordLink('telegram123', 'user#1234', 'discord999');
    assert.strictEqual(linkCount, 1, 'userLinked must fire only once for same account');
  });

  it('should initialize per-account channels for each linked account', () => {
    store.addDiscordLink('telegram123', 'user#1234', 'discord999');
    store.addDiscordLink('telegram123', 'alt#5678', 'discord888');
    const user = store.getUser('telegram123');
    assert.ok(user);
    assert.deepStrictEqual(user.channels, { discord999: [], discord888: [] });
  });
});
