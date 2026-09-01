import fs from 'node:fs';
import type { HealthStatus, Logger } from './types.js';

interface HeartbeatData {
  timestamp: number;
  discord: string;
  telegram: boolean;
  uptime: number;
}

const HEARTBEAT_INTERVAL_MS = 30_000; // 30 seconds
const HEARTBEAT_MAX_AGE_MS = 90_000; // 90 seconds — 3x the interval

// --- Writer (used by the main process) ---

export function startHeartbeat(
  filePath: string,
  getStatus: () => HealthStatus,
  logger: Logger,
): { stop: () => void } {
  const startedAt = Date.now();

  function write(): void {
    const status = getStatus();
    const data: HeartbeatData = {
      timestamp: Date.now(),
      discord: status.discord,
      telegram: status.telegram,
      uptime: Math.floor((Date.now() - startedAt) / 1000),
    };
    try {
      fs.writeFileSync(filePath, JSON.stringify(data));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.log(`Failed to write heartbeat: ${msg}`);
    }
  }

  // Write immediately on startup, then on interval
  write();
  const timer = setInterval(write, HEARTBEAT_INTERVAL_MS);
  timer.unref();

  logger.log(`Heartbeat started (interval=${HEARTBEAT_INTERVAL_MS / 1000}s, file=${filePath})`);

  return {
    stop: () => {
      clearInterval(timer);
      try {
        fs.unlinkSync(filePath);
      } catch {
        // File may already be gone
      }
    },
  };
}

// --- Checker (used by the Docker HEALTHCHECK script) ---

export function checkHealth(filePath: string): { healthy: boolean; reason: string } {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return { healthy: false, reason: 'heartbeat file not found' };
  }

  let data: HeartbeatData;
  try {
    data = JSON.parse(raw) as HeartbeatData;
  } catch {
    return { healthy: false, reason: 'heartbeat file is not valid JSON' };
  }

  const age = Date.now() - data.timestamp;
  if (age > HEARTBEAT_MAX_AGE_MS) {
    return { healthy: false, reason: `heartbeat is stale (${Math.floor(age / 1000)}s old)` };
  }

  if (data.discord !== 'Ready') {
    return { healthy: false, reason: `discord status: ${data.discord}` };
  }

  return { healthy: true, reason: `ok (uptime=${data.uptime}s, discord=${data.discord})` };
}
