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

    it('should parse valid JSON file', () => {
      const data = {
        '12345': { discordTags: ['user#1234'], discordIds: ['999'], channels: ['ch1'] },
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
  });

  describe('createUser', () => {
    it('should create a new user record', () => {
      store.load();
      const user = store.createUser('12345');
      assert.deepStrictEqual(user, { discordTags: [], discordIds: [], channels: [] });
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

    it('should create user if not exists', () => {
      store.load();
      store.addDiscordLink('12345', 'user#1234', '999');
      assert.ok(store.hasUser('12345'));
      const user = store.getUser('12345');
      assert.ok(user);
      assert.deepStrictEqual(user.discordTags, ['user#1234']);
    });

    it('should emit userLinked event with telegramId', () => {
      store.load();
      let linkedId: string | undefined;
      store.on('userLinked', (telegramId: string) => {
        linkedId = telegramId;
      });
      store.addDiscordLink('12345', 'user#1234', '999');
      assert.strictEqual(linkedId, '12345');
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

  describe('toggleChannel', () => {
    it('should add channel when not present', () => {
      store.load();
      store.createUser('12345');
      const added = store.toggleChannel('12345', 'ch1');
      assert.strictEqual(added, true);
      const user = store.getUser('12345');
      assert.ok(user);
      assert.ok(user.channels.includes('ch1'));
    });

    it('should remove channel when present', () => {
      store.load();
      store.createUser('12345');
      store.toggleChannel('12345', 'ch1');
      const removed = store.toggleChannel('12345', 'ch1');
      assert.strictEqual(removed, false);
      const user = store.getUser('12345');
      assert.ok(user);
      assert.ok(!user.channels.includes('ch1'));
    });

    it('should return false for non-existent user', () => {
      store.load();
      const result = store.toggleChannel('nonexistent', 'ch1');
      assert.strictEqual(result, false);
    });

    it('should persist changes to disk', () => {
      store.load();
      store.createUser('12345');
      store.toggleChannel('12345', 'ch1');
      const raw = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
      assert.ok(raw['12345'].channels.includes('ch1'));
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

  describe('userLinked channel push scenario', () => {
    it('should allow pushing channels to a user registered after startup', () => {
      store.load();
      // No users at startup — simulate what discord.ts does:
      // 1. Channels loaded into channelCache
      const channelCache: Record<string, { id: string; name: string }[]> = {
        guild1: [
          { id: 'ch1', name: 'general' },
          { id: 'ch2', name: 'dev' },
        ],
      };

      // 2. Push to existing users — empty loop (no users)
      const pushedChannels: { telegramId: string; entries: { id: string; name: string }[] }[] = [];
      for (const telegramUserId of Object.keys(store.getAll())) {
        for (const entries of Object.values(channelCache)) {
          pushedChannels.push({ telegramId: telegramUserId, entries });
        }
      }
      assert.strictEqual(pushedChannels.length, 0, 'no users at startup — nothing pushed');

      // 3. Listen for userLinked (the fix)
      store.on('userLinked', (telegramId: string) => {
        for (const entries of Object.values(channelCache)) {
          pushedChannels.push({ telegramId, entries });
        }
      });

      // 4. User registers
      store.addDiscordLink('240077413', 'lakmoes', 'discord123');

      // 5. Channels were pushed to the new user
      assert.strictEqual(pushedChannels.length, 1);
      assert.strictEqual(pushedChannels[0]!.telegramId, '240077413');
      assert.strictEqual(pushedChannels[0]!.entries.length, 2);
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
