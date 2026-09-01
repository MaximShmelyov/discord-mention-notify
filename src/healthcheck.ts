// Standalone health check script for Docker HEALTHCHECK.
// Usage: node dist/healthcheck.js
// Exits 0 (healthy) or 1 (unhealthy).

import path from 'node:path';
import { checkHealth } from './health.js';

const dataDir = process.env['DATA_DIR'] ?? path.resolve(import.meta.dirname, '..');
const healthFilePath = path.resolve(dataDir, 'health.json');

const result = checkHealth(healthFilePath);

if (result.healthy) {
  process.exit(0);
} else {
  console.error(`unhealthy: ${result.reason}`);
  process.exit(1);
}
