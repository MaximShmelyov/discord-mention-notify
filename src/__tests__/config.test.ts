import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

describe('config', { concurrency: 1 }, () => {
  const originalEnv = { ...process.env };
  let importCounter = 0;

  /** Import config with a unique cache-busting query to force re-evaluation. */
  function freshImport() {
    return import(`../config.js?v=${++importCounter}`);
  }

  beforeEach(() => {
    // Reset module registry for fresh imports
    process.env['DISCORD_TOKEN'] = 'test-discord-token';
    process.env['TELEGRAM_TOKEN'] = 'test-telegram-token';
    process.env['WHITELISTED_GUILDS'] = '111,222,333';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should throw when DISCORD_TOKEN is missing', async () => {
    delete process.env['DISCORD_TOKEN'];
    // Dynamic import to re-evaluate the module
    await assert.rejects(() => freshImport(), {
      message: /DISCORD_TOKEN/,
    });
  });

  it('should throw when TELEGRAM_TOKEN is missing', async () => {
    delete process.env['TELEGRAM_TOKEN'];
    await assert.rejects(() => freshImport(), {
      message: /TELEGRAM_TOKEN/,
    });
  });

  it('should parse WHITELISTED_GUILDS as comma-separated array', async () => {
    const mod = (await freshImport()) as {
      config: { WHITELISTED_GUILDS: string[] };
    };
    assert.deepStrictEqual(mod.config.WHITELISTED_GUILDS, ['111', '222', '333']);
  });

  it('should default WHITELISTED_GUILDS to empty array when not set', async () => {
    delete process.env['WHITELISTED_GUILDS'];
    const mod = (await freshImport()) as {
      config: { WHITELISTED_GUILDS: string[] };
    };
    assert.deepStrictEqual(mod.config.WHITELISTED_GUILDS, []);
  });

  it('should resolve file paths relative to src directory', async () => {
    const mod = (await freshImport()) as {
      config: { USER_DB_PATH: string; CHANNELS_CACHE_PATH: string };
    };
    assert.ok(mod.config.USER_DB_PATH.endsWith('user-db.json'));
    assert.ok(mod.config.CHANNELS_CACHE_PATH.endsWith('available-channels.json'));
    // Paths should be absolute
    assert.ok(
      mod.config.USER_DB_PATH.includes(':') || mod.config.USER_DB_PATH.startsWith('/'),
      'USER_DB_PATH should be absolute',
    );
  });
});
