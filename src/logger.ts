import fs from 'node:fs';
import path from 'node:path';
import type { Logger } from './types.js';

let logStream: fs.WriteStream | null = null;

export function initLogger(logsDir: string): void {
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  logStream = fs.createWriteStream(path.join(logsDir, 'output.log'), { flags: 'a' });
}

export function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
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
  };
}
