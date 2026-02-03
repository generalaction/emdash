import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerminalSnapshotPayload } from '../../types/terminalSnapshot';

describe('TerminalSnapshotService', () => {
  let tempDir: string;
  let service: typeof import('../../main/services/TerminalSnapshotService').terminalSnapshotService;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-snapshot-test-'));
    process.env.EMDASH_TERMINAL_SNAPSHOT_DIR = tempDir;
    vi.resetModules();
    ({ terminalSnapshotService: service } = await import(
      '../../main/services/TerminalSnapshotService'
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

  it('handles data with lone surrogates without JSON parse errors', async () => {
    // Lone surrogates (U+D800-U+DFFF not in valid pairs) cause "Bad Unicode escape"
    // errors when JSON.parse encounters them. This tests that the service sanitizes them.
    const loneHighSurrogate = '\uD800'; // High surrogate without low surrogate
    const loneLowSurrogate = '\uDC00'; // Low surrogate without high surrogate
    const validPair = '\uD83D\uDE00'; // Valid surrogate pair (emoji)

    const payload: TerminalSnapshotPayload = {
      version: 1,
      createdAt: new Date().toISOString(),
      cols: 80,
      rows: 24,
      data: `before${loneHighSurrogate}middle${loneLowSurrogate}after${validPair}end`,
    };

    // Save should succeed despite lone surrogates
    const saveResult = await service.saveSnapshot('surrogate-test', payload);
    expect(saveResult.ok).toBe(true);

    // Load should succeed and return sanitized data
    const loaded = await service.getSnapshot('surrogate-test');
    expect(loaded).not.toBeNull();
    // Lone surrogates should be replaced with U+FFFD (replacement character)
    expect(loaded?.data).toBe('before\uFFFDmiddle\uFFFDafter\uD83D\uDE00end');
    // Valid surrogate pair should be preserved
    expect(loaded?.data).toContain('\uD83D\uDE00');
  });
});
