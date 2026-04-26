/**
 * Tests for credsSnapshot module
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { credsSnapshot } from '../src/credsSnapshot.js';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('credsSnapshot', () => {
  let testDir: string;
  let credsPath: string;

  beforeEach(async () => {
    // Create temp directory for tests
    testDir = path.join(os.tmpdir(), `baileys-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(testDir, { recursive: true });
    credsPath = path.join(testDir, 'creds.json');
  });

  afterEach(async () => {
    // Cleanup
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should take a snapshot of existing creds file', async () => {
    // Create test creds file
    const testCreds = { test: 'data', timestamp: Date.now() };
    await fs.writeFile(credsPath, JSON.stringify(testCreds));

    const snapshot = credsSnapshot({ credsPath });
    const snapshotPath = await snapshot.take();

    expect(snapshotPath).toBeTruthy();
    expect(typeof snapshotPath).toBe('string');

    // Verify snapshot exists and contains same data
    if (snapshotPath) {
      const snapshotData = await fs.readFile(snapshotPath, 'utf-8');
      expect(JSON.parse(snapshotData)).toEqual(testCreds);
    }
  });

  it('should rotate old snapshots when exceeding keep limit', async () => {
    await fs.writeFile(credsPath, JSON.stringify({ test: 'data' }));

    const snapshot = credsSnapshot({ credsPath, keep: 2 });

    // Take 4 snapshots
    await snapshot.take();
    await new Promise((r) => setTimeout(r, 10)); // Small delay to ensure different filenames
    await snapshot.take();
    await new Promise((r) => setTimeout(r, 10));
    await snapshot.take();
    await new Promise((r) => setTimeout(r, 10));
    await snapshot.take();

    const list = await snapshot.list();
    expect(list.length).toBe(2); // Should only keep 2 newest
  });

  it('should restore from latest snapshot', async () => {
    const originalData = { original: true, value: 123 };
    await fs.writeFile(credsPath, JSON.stringify(originalData));

    const snapshot = credsSnapshot({ credsPath });
    await snapshot.take();

    // Modify creds file
    const modifiedData = { original: false, value: 456 };
    await fs.writeFile(credsPath, JSON.stringify(modifiedData));

    // Restore
    const restored = await snapshot.restoreLatest();
    expect(restored).toBe(true);

    // Verify original data is restored
    const restoredData = JSON.parse(await fs.readFile(credsPath, 'utf-8'));
    expect(restoredData).toEqual(originalData);
  });

  it('should return null when taking snapshot of missing creds file', async () => {
    const snapshot = credsSnapshot({ credsPath });
    const result = await snapshot.take();

    expect(result).toBeNull();
  });

  it('should return false when restoring with no snapshots available', async () => {
    const snapshot = credsSnapshot({ credsPath });
    const result = await snapshot.restoreLatest();

    expect(result).toBe(false);
  });

  it('should list snapshots in newest-first order', async () => {
    await fs.writeFile(credsPath, JSON.stringify({ test: 'data' }));

    const snapshot = credsSnapshot({ credsPath });

    await snapshot.take();
    await new Promise((r) => setTimeout(r, 10));
    await snapshot.take();
    await new Promise((r) => setTimeout(r, 10));
    await snapshot.take();

    const list = await snapshot.list();

    expect(list.length).toBe(3);
    // Verify newest first
    for (let i = 0; i < list.length - 1; i++) {
      expect(list[i].takenAt.getTime()).toBeGreaterThanOrEqual(list[i + 1].takenAt.getTime());
    }
  });
});
