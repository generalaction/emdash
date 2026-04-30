import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { MemoryFs } from '@main/core/fs/test-helpers/memory-fs';
import { HookConfigWriter } from './hook-config';

const mockResolveCommandPath = vi.hoisted(() => vi.fn());

vi.mock('@main/core/dependencies/probe', () => ({
  resolveCommandPath: mockResolveCommandPath,
}));

function makeExecutionContext(): IExecutionContext {
  return {
    supportsLocalSpawn: false,
    exec: vi.fn(async () => ({ stdout: '', stderr: '' })),
    execStreaming: vi.fn(async () => {}),
    dispose: vi.fn(),
  };
}

function makeWriter(fs: MemoryFs): HookConfigWriter {
  return new HookConfigWriter(fs, makeExecutionContext());
}

describe('HookConfigWriter', () => {
  beforeEach(() => {
    mockResolveCommandPath.mockReset();
    mockResolveCommandPath.mockResolvedValue('/usr/local/bin/pi');
  });

  it('writes the Pi lifecycle extension and ignores it in git', async () => {
    const fs = new MemoryFs();
    const writer = makeWriter(fs);

    await writer.writeForProvider('pi');

    expect(fs.files.get('.pi/extensions/emdash-hook.ts')).toContain("pi.on('agent_end'");
    expect(fs.files.get('.pi/extensions/emdash-hook.ts')).toContain(
      "process.once('uncaughtException'"
    );
    expect(fs.files.get('.pi/extensions/emdash-hook.ts')).toContain("'X-Emdash-Event-Type'");
    expect(fs.files.get('.gitignore')).toBe('.pi/extensions/emdash-hook.ts\n');
  });

  it('does not duplicate the Pi gitignore entry', async () => {
    const fs = new MemoryFs();
    fs.files.set('.gitignore', '.pi/extensions/emdash-hook.ts\n');
    const writer = makeWriter(fs);

    await writer.writeForProvider('pi');

    expect(fs.files.get('.gitignore')).toBe('.pi/extensions/emdash-hook.ts\n');
  });

  it('skips the Pi extension when pi is unavailable', async () => {
    mockResolveCommandPath.mockResolvedValue(undefined);
    const fs = new MemoryFs();
    const writer = makeWriter(fs);

    await writer.writeForProvider('pi');

    expect(fs.files.has('.pi/extensions/emdash-hook.ts')).toBe(false);
    expect(fs.files.has('.gitignore')).toBe(false);
  });

  it('writes the OpenCode notifications plugin and ignores it in git', async () => {
    mockResolveCommandPath.mockResolvedValue('/usr/local/bin/opencode');
    const fs = new MemoryFs();
    const writer = makeWriter(fs);

    await writer.writeForProvider('opencode');

    expect(fs.files.get('.opencode/plugins/emdash-notifications.js')).toContain(
      'EmdashNotifications'
    );
    expect(fs.files.get('.opencode/plugins/emdash-notifications.js')).toContain(
      "event.type === 'session.idle'"
    );
    expect(fs.files.get('.gitignore')).toBe('.opencode/plugins/emdash-notifications.js\n');
  });

  it('skips the OpenCode plugin when opencode is unavailable', async () => {
    mockResolveCommandPath.mockResolvedValue(undefined);
    const fs = new MemoryFs();
    const writer = makeWriter(fs);

    await writer.writeForProvider('opencode');

    expect(fs.files.has('.opencode/plugins/emdash-notifications.js')).toBe(false);
    expect(fs.files.has('.gitignore')).toBe(false);
  });
});
