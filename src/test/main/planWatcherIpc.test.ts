import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let mockHomeDir: string;

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return {
    ...actual,
    default: {
      ...actual,
      homedir: () => mockHomeDir,
    },
    homedir: () => mockHomeDir,
  };
});

vi.mock('electron', () => {
  const handlers = new Map<string, (...args: any[]) => any>();
  return {
    ipcMain: {
      handle: vi.fn((channel: string, handler: any) => {
        handlers.set(channel, handler);
      }),
    },
    BrowserWindow: {
      getAllWindows: vi.fn(() => []),
    },
    app: {
      on: vi.fn(),
    },
    __handlers: handlers,
  };
});

describe('planWatcherIpc', () => {
  let plansDir: string;
  let handlers: Map<string, (...args: any[]) => any>;

  beforeEach(async () => {
    mockHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-watcher-test-'));
    plansDir = path.join(mockHomeDir, '.claude', 'plans');

    vi.resetModules();

    const { registerPlanWatcherIpc } = await import('../../main/services/planWatcherIpc');
    registerPlanWatcherIpc();
    const electron = await import('electron');
    handlers = (electron as any).__handlers;
  });

  afterEach(() => {
    fs.rmSync(mockHomeDir, { recursive: true, force: true });
  });

  it('registers all expected IPC handlers', () => {
    expect(handlers.has('plan:watch-start')).toBe(true);
    expect(handlers.has('plan:watch-stop')).toBe(true);
    expect(handlers.has('plan:read-file')).toBe(true);
    expect(handlers.has('plan:list-files')).toBe(true);
  });

  it('plan:list-files returns empty when plans dir does not exist', async () => {
    const handler = handlers.get('plan:list-files')!;
    const result = await handler({});
    expect(result.success).toBe(true);
    expect(result.files).toEqual([]);
  });

  it('plan:list-files returns .md files sorted by mtime desc', async () => {
    fs.mkdirSync(plansDir, { recursive: true });

    const file1 = path.join(plansDir, 'old-plan.md');
    const file2 = path.join(plansDir, 'new-plan.md');
    const file3 = path.join(plansDir, 'not-markdown.txt');

    fs.writeFileSync(file1, '# Old Plan');
    const past = new Date(Date.now() - 10000);
    fs.utimesSync(file1, past, past);

    fs.writeFileSync(file2, '# New Plan');
    fs.writeFileSync(file3, 'not markdown');

    const handler = handlers.get('plan:list-files')!;
    const result = await handler({});

    expect(result.success).toBe(true);
    expect(result.files).toHaveLength(2);
    expect(result.files[0].name).toBe('new-plan.md');
    expect(result.files[1].name).toBe('old-plan.md');
  });

  it('plan:read-file reads a plan file', async () => {
    fs.mkdirSync(plansDir, { recursive: true });
    fs.writeFileSync(path.join(plansDir, 'test.md'), '# Test Plan\n\n- Step 1\n- Step 2');

    const handler = handlers.get('plan:read-file')!;
    const result = await handler({}, { fileName: 'test.md' });

    expect(result.success).toBe(true);
    expect(result.content).toBe('# Test Plan\n\n- Step 1\n- Step 2');
  });

  it('plan:read-file rejects path traversal', async () => {
    fs.mkdirSync(plansDir, { recursive: true });

    const handler = handlers.get('plan:read-file')!;
    const result = await handler({}, { fileName: '../../etc/passwd' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Path traversal denied');
  });

  it('plan:read-file returns error for non-existent file', async () => {
    const handler = handlers.get('plan:read-file')!;
    const result = await handler({}, { fileName: 'nope.md' });

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('plan:watch-start succeeds even when dir does not exist', async () => {
    const handler = handlers.get('plan:watch-start')!;
    const result = await handler({});
    expect(result.success).toBe(true);

    const stopHandler = handlers.get('plan:watch-stop')!;
    await stopHandler({});
  });

  it('plan:watch-stop succeeds when not watching', async () => {
    const handler = handlers.get('plan:watch-stop')!;
    const result = await handler({});
    expect(result.success).toBe(true);
  });
});
