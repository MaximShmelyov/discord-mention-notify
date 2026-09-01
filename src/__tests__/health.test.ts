import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { startHeartbeat, checkHealth } from '../health.js';
import type { Logger } from '../types.js';

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'health-test-'));
}

function createSilentLogger(): Logger {
  return { log: () => {}, debug: () => {} };
}

describe('checkHealth', () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(() => {
    tmpDir = createTempDir();
    filePath = path.join(tmpDir, 'health.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should return unhealthy when file does not exist', () => {
    const result = checkHealth(filePath);
    assert.equal(result.healthy, false);
    assert.match(result.reason, /not found/);
  });

  it('should return unhealthy when file is not valid JSON', () => {
    fs.writeFileSync(filePath, 'not-json');
    const result = checkHealth(filePath);
    assert.equal(result.healthy, false);
    assert.match(result.reason, /not valid JSON/);
  });

  it('should return unhealthy when heartbeat is stale', () => {
    const data = {
      timestamp: Date.now() - 120_000, // 2 minutes ago
      discord: 'Ready',
      telegram: true,
      uptime: 300,
    };
    fs.writeFileSync(filePath, JSON.stringify(data));
    const result = checkHealth(filePath);
    assert.equal(result.healthy, false);
    assert.match(result.reason, /stale/);
  });

  it('should return unhealthy when discord is not Ready', () => {
    const data = {
      timestamp: Date.now(),
      discord: 'Reconnecting',
      telegram: true,
      uptime: 300,
    };
    fs.writeFileSync(filePath, JSON.stringify(data));
    const result = checkHealth(filePath);
    assert.equal(result.healthy, false);
    assert.match(result.reason, /Reconnecting/);
  });

  it('should return healthy when all conditions are met', () => {
    const data = {
      timestamp: Date.now(),
      discord: 'Ready',
      telegram: true,
      uptime: 300,
    };
    fs.writeFileSync(filePath, JSON.stringify(data));
    const result = checkHealth(filePath);
    assert.equal(result.healthy, true);
    assert.match(result.reason, /ok/);
  });
});

describe('startHeartbeat', () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(() => {
    tmpDir = createTempDir();
    filePath = path.join(tmpDir, 'health.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should write heartbeat file immediately on start', () => {
    const hb = startHeartbeat(
      filePath,
      () => ({ discord: 'Ready', telegram: true }),
      createSilentLogger(),
    );
    assert.ok(fs.existsSync(filePath), 'heartbeat file should exist');

    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    assert.equal(data.discord, 'Ready');
    assert.equal(data.telegram, true);
    assert.equal(typeof data.timestamp, 'number');
    assert.equal(typeof data.uptime, 'number');
    hb.stop();
  });

  it('should remove heartbeat file on stop', () => {
    const hb = startHeartbeat(
      filePath,
      () => ({ discord: 'Ready', telegram: true }),
      createSilentLogger(),
    );
    assert.ok(fs.existsSync(filePath));
    hb.stop();
    assert.ok(!fs.existsSync(filePath), 'heartbeat file should be removed after stop');
  });

  it('should produce a healthy check result right after start', () => {
    const hb = startHeartbeat(
      filePath,
      () => ({ discord: 'Ready', telegram: true }),
      createSilentLogger(),
    );
    const result = checkHealth(filePath);
    assert.equal(result.healthy, true);
    hb.stop();
  });

  it('should reflect unhealthy discord status', () => {
    const hb = startHeartbeat(
      filePath,
      () => ({ discord: 'Disconnected', telegram: true }),
      createSilentLogger(),
    );
    const result = checkHealth(filePath);
    assert.equal(result.healthy, false);
    assert.match(result.reason, /Disconnected/);
    hb.stop();
  });
});
