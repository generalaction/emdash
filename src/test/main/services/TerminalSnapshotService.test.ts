import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerminalSnapshotPayload } from '../../../types/terminalSnapshot';

describe('TerminalSnapshotService', () => {
  let tempDir: string;
  let service: typeof import('../../../main/services/TerminalSnapshotService').terminalSnapshotService;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-snapshot-test-'));
    process.env.EMDASH_TERMINAL_SNAPSHOT_DIR = tempDir;
    vi.resetModules();
    ({ terminalSnapshotService: service } = await import(
      '../../../main/services/TerminalSnapshotService'
    ));
  });

  afterEach(() => {
    delete process.env.EMDASH_TERMINAL_SNAPSHOT_DIR;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('saves and retrieves snapshots', async () => {
    const payload: TerminalSnapshotPayload = {
      version: 1,
      createdAt: new Date().toISOString(),
      cols: 120,
      rows: 40,
      data: 'snapshot-data',
      stats: { totalBytes: 42 },
    };

    const saveResult = await service.saveSnapshot('demo', payload);
    expect(saveResult.ok).toBe(true);

    const loaded = await service.getSnapshot('demo');
    expect(loaded).not.toBeNull();
    expect(loaded?.data).toBe(payload.data);
    expect(loaded?.cols).toBe(payload.cols);
  });

  it('rejects oversized snapshots', async () => {
    const largePayload: TerminalSnapshotPayload = {
      version: 1,
      createdAt: new Date().toISOString(),
      cols: 80,
      rows: 24,
      data: 'x'.repeat(8 * 1024 * 1024 + 1),
    };

    const result = await service.saveSnapshot('huge', largePayload);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Snapshot size');
    const loaded = await service.getSnapshot('huge');
    expect(loaded).toBeNull();
  });

  it('deletes snapshots', async () => {
    const payload: TerminalSnapshotPayload = {
      version: 1,
      createdAt: new Date().toISOString(),
      cols: 80,
      rows: 24,
      data: 'data',
    };

    await service.saveSnapshot('temp', payload);
    await service.deleteSnapshot('temp');
    const loaded = await service.getSnapshot('temp');
    expect(loaded).toBeNull();
  });
});
