import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../store.js';
import type { Logger } from '../types.js';

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'store-test-'));
}

function createSilentLogger(): Logger {
  return { log: () => {} };
}

describe('Store', () => {
  let tmpDir: string;
  let dbPath: string;
  let store: Store;

  beforeEach(() => {
    tmpDir = createTempDir();
    dbPath = path.join(tmpDir, 'user-db.json');
    store = new Store(dbPath, createSilentLogger());
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('load', () => {
    it('should return empty DB when file does not exist', () => {
      store.load();
      assert.deepStrictEqual(store.getAll(), {});
    });

    it('should parse valid JSON file with per-account channels', () => {
      const data = {
        '12345': {
          discordTags: ['user#1234'],
          discordIds: ['999'],
          channels: { '999': ['ch1'] },
        },
      };
      fs.writeFileSync(dbPath, JSON.stringify(data));
      store.load();
      assert.deepStrictEqual(store.getAll(), data);
    });

    it('should return empty DB for invalid JSON', () => {
      fs.writeFileSync(dbPath, 'not json');
      store.load();
      assert.deepStrictEqual(store.getAll(), {});
    });

    it('should migrate legacy flat channels array to per-account format', () => {
      const legacyData = {
        '12345': {
          discordTags: ['user#1234', 'alt#5678'],
          discordIds: ['d1', 'd2'],
          channels: ['ch1', 'ch2'],
        },
      };
      fs.writeFileSync(dbPath, JSON.stringify(legacyData));
      store.load();
      const user = store.getUser('12345');
      assert.ok(user);
      // Each account should inherit the old channel list
      assert.deepStrictEqual(user.channels, {
        d1: ['ch1', 'ch2'],
        d2: ['ch1', 'ch2'],
      });
    });

    it('should persist migrated data to disk', () => {
      const legacyData = {
        '12345': {
          discordTags: ['user#1234'],
          discordIds: ['d1'],
          channels: ['ch1'],
        },
      };
      fs.writeFileSync(dbPath, JSON.stringify(legacyData));
      store.load();
      // Re-read from disk to verify migration was saved
      const raw = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
      assert.deepStrictEqual(raw['12345'].channels, { d1: ['ch1'] });
    });
  });

  describe('createUser', () => {
    it('should create a new user record with empty channels object', () => {
      store.load();
      const user = store.createUser('12345');
      assert.deepStrictEqual(user, { discordTags: [], discordIds: [], channels: {} });
      assert.ok(store.hasUser('12345'));
    });

    it('should persist to disk', () => {
      store.load();
      store.createUser('12345');
      const raw = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
      assert.ok('12345' in raw);
    });

    it('should emit change event', () => {
      store.load();
      let emitted = false;
      store.on('change', () => {
        emitted = true;
      });
      store.createUser('12345');
      assert.ok(emitted);
    });
  });

  describe('addDiscordLink', () => {
    it('should add tag and id to existing user', () => {
      store.load();
      store.createUser('12345');
      store.addDiscordLink('12345', 'user#1234', '999');
      const user = store.getUser('12345');
      assert.ok(user);
      assert.deepStrictEqual(user.discordTags, ['user#1234']);
      assert.deepStrictEqual(user.discordIds, ['999']);
    });

    it('should initialize per-account channels entry', () => {
      store.load();
      store.addDiscordLink('12345', 'user#1234', '999');
      const user = store.getUser('12345');
      assert.ok(user);
      assert.deepStrictEqual(user.channels, { '999': [] });
    });

    it('should create user if not exists', () => {
      store.load();
      store.addDiscordLink('12345', 'user#1234', '999');
      assert.ok(store.hasUser('12345'));
      const user = store.getUser('12345');
      assert.ok(user);
      assert.deepStrictEqual(user.discordTags, ['user#1234']);
    });

    it('should return true on first link and false on duplicate', () => {
      store.load();
      assert.strictEqual(store.addDiscordLink('12345', 'user#1234', '999'), true);
      assert.strictEqual(store.addDiscordLink('12345', 'user#1234', '999'), false);
    });

    it('should not duplicate discord account for the same telegram user', () => {
      store.load();
      store.addDiscordLink('12345', 'user#1234', '999');
      store.addDiscordLink('12345', 'user#1234', '999');
      store.addDiscordLink('12345', 'user#1234', '999');
      const user = store.getUser('12345');
      assert.ok(user);
      assert.strictEqual(user.discordTags.length, 1);
      assert.strictEqual(user.discordIds.length, 1);
    });

    it('should allow same discord account linked to different telegram users', () => {
      store.load();
      store.addDiscordLink('11111', 'user#1234', '999');
      store.addDiscordLink('22222', 'user#1234', '999');
      assert.deepStrictEqual(store.getUser('11111')!.discordIds, ['999']);
      assert.deepStrictEqual(store.getUser('22222')!.discordIds, ['999']);
    });

    it('should emit userLinked event with telegramId and discordId', () => {
      store.load();
      let linkedTg: string | undefined;
      let linkedDiscord: string | undefined;
      store.on('userLinked', (telegramId: string, discordId: string) => {
        linkedTg = telegramId;
        linkedDiscord = discordId;
      });
      store.addDiscordLink('12345', 'user#1234', '999');
      assert.strictEqual(linkedTg, '12345');
      assert.strictEqual(linkedDiscord, '999');
    });

    it('should not emit userLinked on duplicate link', () => {
      store.load();
      let emitCount = 0;
      store.on('userLinked', () => {
        emitCount++;
      });
      store.addDiscordLink('12345', 'user#1234', '999');
      store.addDiscordLink('12345', 'user#1234', '999');
      assert.strictEqual(emitCount, 1, 'userLinked must not fire for duplicate');
    });

    it('should emit userLinked after user is already in the store', () => {
      store.load();
      let userExisted = false;
      store.on('userLinked', (telegramId: string) => {
        userExisted = store.hasUser(telegramId);
      });
      store.addDiscordLink('12345', 'user#1234', '999');
      assert.ok(userExisted, 'user must exist in store when userLinked fires');
    });
  });

  describe('toggleChannel (per-account)', () => {
    it('should add channel for specific discord account', () => {
      store.load();
      store.addDiscordLink('12345', 'user#1234', 'd1');
      const added = store.toggleChannel('12345', 'd1', 'ch1');
      assert.strictEqual(added, true);
      assert.deepStrictEqual(store.getAccountChannels('12345', 'd1'), ['ch1']);
    });

    it('should remove channel when toggled again', () => {
      store.load();
      store.addDiscordLink('12345', 'user#1234', 'd1');
      store.toggleChannel('12345', 'd1', 'ch1');
      const removed = store.toggleChannel('12345', 'd1', 'ch1');
      assert.strictEqual(removed, false);
      assert.deepStrictEqual(store.getAccountChannels('12345', 'd1'), []);
    });

    it('should not affect other accounts of the same user', () => {
      store.load();
      store.addDiscordLink('12345', 'user#1234', 'd1');
      store.addDiscordLink('12345', 'alt#5678', 'd2');
      store.toggleChannel('12345', 'd1', 'ch1');
      assert.deepStrictEqual(store.getAccountChannels('12345', 'd1'), ['ch1']);
      assert.deepStrictEqual(store.getAccountChannels('12345', 'd2'), []);
    });

    it('should return false for non-existent user', () => {
      store.load();
      const result = store.toggleChannel('nonexistent', 'd1', 'ch1');
      assert.strictEqual(result, false);
    });

    it('should persist changes to disk', () => {
      store.load();
      store.addDiscordLink('12345', 'user#1234', 'd1');
      store.toggleChannel('12345', 'd1', 'ch1');
      const raw = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
      assert.deepStrictEqual(raw['12345'].channels['d1'], ['ch1']);
    });
  });

  describe('enableChannels (per-account)', () => {
    it('should enable channels for a specific discord account', () => {
      store.load();
      store.addDiscordLink('12345', 'user#1234', 'd1');
      store.enableChannels('12345', 'd1', ['ch1', 'ch2']);
      assert.deepStrictEqual(store.getAccountChannels('12345', 'd1'), ['ch1', 'ch2']);
    });

    it('should not duplicate already-enabled channels', () => {
      store.load();
      store.addDiscordLink('12345', 'user#1234', 'd1');
      store.enableChannels('12345', 'd1', ['ch1', 'ch2']);
      store.enableChannels('12345', 'd1', ['ch2', 'ch3']);
      assert.deepStrictEqual(store.getAccountChannels('12345', 'd1'), ['ch1', 'ch2', 'ch3']);
    });

    it('should not affect other accounts', () => {
      store.load();
      store.addDiscordLink('12345', 'user#1234', 'd1');
      store.addDiscordLink('12345', 'alt#5678', 'd2');
      store.enableChannels('12345', 'd1', ['ch1', 'ch2']);
      assert.deepStrictEqual(store.getAccountChannels('12345', 'd2'), []);
    });
  });

  describe('getAccountChannels', () => {
    it('should return empty array for unknown user', () => {
      store.load();
      assert.deepStrictEqual(store.getAccountChannels('unknown', 'd1'), []);
    });

    it('should return empty array for unknown discord account', () => {
      store.load();
      store.addDiscordLink('12345', 'user#1234', 'd1');
      assert.deepStrictEqual(store.getAccountChannels('12345', 'unknown'), []);
    });

    it('should return enabled channels for known account', () => {
      store.load();
      store.addDiscordLink('12345', 'user#1234', 'd1');
      store.enableChannels('12345', 'd1', ['ch1', 'ch2']);
      assert.deepStrictEqual(store.getAccountChannels('12345', 'd1'), ['ch1', 'ch2']);
    });
  });

  describe('getAll', () => {
    it('should return a shallow copy', () => {
      store.load();
      store.createUser('12345');
      const all = store.getAll();
      // Modifying returned object should not affect store
      delete all['12345'];
      assert.ok(store.hasUser('12345'));
    });
  });

  describe('getUserLocale', () => {
    it('should return default locale for non-existent user', () => {
      store.load();
      assert.strictEqual(store.getUserLocale('nonexistent'), 'en');
    });

    it('should return default locale for user without locale set', () => {
      store.load();
      store.createUser('12345');
      assert.strictEqual(store.getUserLocale('12345'), 'en');
    });

    it('should return stored locale after setUserLocale', () => {
      store.load();
      store.createUser('12345');
      store.setUserLocale('12345', 'ru');
      assert.strictEqual(store.getUserLocale('12345'), 'ru');
    });
  });

  describe('setUserLocale', () => {
    it('should create user if not exists', () => {
      store.load();
      store.setUserLocale('12345', 'ru');
      assert.ok(store.hasUser('12345'));
      assert.strictEqual(store.getUserLocale('12345'), 'ru');
    });

    it('should persist to disk', () => {
      store.load();
      store.setUserLocale('12345', 'ru');
      const raw = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
      assert.strictEqual(raw['12345'].locale, 'ru');
    });

    it('should emit change event', () => {
      store.load();
      let emitted = false;
      store.on('change', () => {
        emitted = true;
      });
      store.setUserLocale('12345', 'ru');
      assert.ok(emitted);
    });
  });

  describe('findTelegramIdByDiscordId', () => {
    it('should return telegramId for known discord id', () => {
      store.load();
      store.addDiscordLink('12345', 'user#1234', 'discord999');
      assert.strictEqual(store.findTelegramIdByDiscordId('discord999'), '12345');
    });

    it('should return undefined for unknown discord id', () => {
      store.load();
      assert.strictEqual(store.findTelegramIdByDiscordId('unknown'), undefined);
    });

    it('should find the correct user among multiple', () => {
      store.load();
      store.addDiscordLink('111', 'a#0001', 'dA');
      store.addDiscordLink('222', 'b#0002', 'dB');
      assert.strictEqual(store.findTelegramIdByDiscordId('dB'), '222');
    });
  });

  describe('userLinked channel push scenario (per-account)', () => {
    it('should allow pushing channels to a specific discord account after linking', () => {
      store.load();
      const channelCache: Record<string, { id: string; name: string }[]> = {
        guild1: [
          { id: 'ch1', name: 'general' },
          { id: 'ch2', name: 'dev' },
        ],
      };

      // No users at startup
      const pushedChannels: { telegramId: string; discordId: string }[] = [];
      assert.strictEqual(Object.keys(store.getAll()).length, 0);

      // Listen for userLinked — now receives discordId
      store.on('userLinked', (telegramId: string, discordId: string) => {
        const allChannelIds: string[] = [];
        for (const entries of Object.values(channelCache)) {
          for (const entry of entries) {
            allChannelIds.push(entry.id);
          }
        }
        store.enableChannels(telegramId, discordId, allChannelIds);
        pushedChannels.push({ telegramId, discordId });
      });

      // User registers their first discord account
      store.addDiscordLink('240077413', 'lakmoes', 'discord123');

      assert.strictEqual(pushedChannels.length, 1);
      assert.strictEqual(pushedChannels[0]!.discordId, 'discord123');
      assert.deepStrictEqual(store.getAccountChannels('240077413', 'discord123'), ['ch1', 'ch2']);

      // Second account should get its own channels
      store.addDiscordLink('240077413', 'alt_account', 'discord456');
      assert.strictEqual(pushedChannels.length, 2);
      assert.deepStrictEqual(store.getAccountChannels('240077413', 'discord456'), ['ch1', 'ch2']);

      // Channels are independent
      store.toggleChannel('240077413', 'discord123', 'ch1');
      assert.deepStrictEqual(store.getAccountChannels('240077413', 'discord123'), ['ch2']);
      assert.deepStrictEqual(store.getAccountChannels('240077413', 'discord456'), ['ch1', 'ch2']);
    });
  });

  describe('save error handling', () => {
    it('should not throw on write error', () => {
      const badStore = new Store('/nonexistent/path/db.json', createSilentLogger());
      badStore.load();
      // This should log an error but not throw
      assert.doesNotThrow(() => {
        badStore.createUser('12345');
      });
    });
  });
});
