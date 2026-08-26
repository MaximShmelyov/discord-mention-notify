import fs from 'node:fs';
import path from 'node:path';
import type { Logger } from './types.js';

const MAX_LOG_AGE_DAYS = 30;

let logStream: fs.WriteStream | null = null;
let currentDate: string | null = null;
let logsDirectory: string | null = null;

function getDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Close the current log stream and open a new one for today's date. */
function ensureStream(): void {
  if (!logsDirectory) return;

  const today = getDateString();
  if (today === currentDate && logStream) return;

  if (logStream) {
    logStream.end();
  }

  currentDate = today;
  logStream = fs.createWriteStream(path.join(logsDirectory, `output-${today}.log`), {
    flags: 'a',
  });
}

/** Remove log files older than MAX_LOG_AGE_DAYS (best-effort). */
function cleanOldLogs(logsDir: string): void {
  try {
    const cutoff = Date.now() - MAX_LOG_AGE_DAYS * 24 * 60 * 60 * 1000;
    for (const file of fs.readdirSync(logsDir)) {
      if (!file.startsWith('output-') || !file.endsWith('.log')) continue;
      const filePath = path.join(logsDir, file);
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(filePath);
      }
    }
  } catch {
    // Best-effort cleanup — don't crash the bot over stale logs
  }
}

export function initLogger(logsDir: string): void {
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  logsDirectory = logsDir;
  ensureStream();
  cleanOldLogs(logsDir);
}

export function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    ensureStream();
    logStream?.write(line + '\n');
  } catch (error) {
    console.error('Logging error:', error);
  }
}

export function debug(msg: string): void {
  const line = `[${new Date().toISOString()}] [DEBUG] ${msg}`;
  try {
    ensureStream();
    logStream?.write(line + '\n');
  } catch (error) {
    console.error('Logging error:', error);
  }
}

export function createLogger(prefix: string): Logger {
  return {
    log(msg: string): void {
      log(`[${prefix}] ${msg}`);
    },
    debug(msg: string): void {
      debug(`[${prefix}] ${msg}`);
    },
  };
}
