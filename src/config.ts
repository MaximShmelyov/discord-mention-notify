import path from 'node:path';
import type { Config } from './types.js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const projectRoot = path.resolve(import.meta.dirname, '..');
const dataDir = process.env['DATA_DIR'] ?? projectRoot;

export const config: Config = Object.freeze({
  DISCORD_TOKEN: requireEnv('DISCORD_TOKEN'),
  TELEGRAM_TOKEN: requireEnv('TELEGRAM_TOKEN'),
  WHITELISTED_GUILDS: (process.env['WHITELISTED_GUILDS'] ?? '').split(',').filter(Boolean),
  USER_DB_PATH: path.resolve(dataDir, 'user-db.json'),
  CHANNELS_CACHE_PATH: path.resolve(dataDir, 'available-channels.json'),
  LOGS_DIR: path.resolve(dataDir, 'logs'),
  HEALTH_FILE_PATH: path.resolve(dataDir, 'health.json'),
});
