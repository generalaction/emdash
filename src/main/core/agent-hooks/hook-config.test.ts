import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileSystemProvider, ReadResult, WriteResult } from '@main/core/fs/types';
import type { ExecFn } from '@main/core/utils/exec';
import { HookConfigWriter } from './hook-config';

const mockResolveCommandPath = vi.hoisted(() => vi.fn());

vi.mock('@main/core/dependencies/probe', () => ({
  resolveCommandPath: mockResolveCommandPath,
}));

class MemoryFs implements Pick<FileSystemProvider, 'exists' | 'read' | 'write'> {
  readonly files = new Map<string, string>();

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async read(path: string): Promise<ReadResult> {
    const content = this.files.get(path);
    if (content === undefined) {
      throw new Error(`not found: ${path}`);
    }
    return {
      content,
      truncated: false,
      totalSize: Buffer.byteLength(content),
    };
  }

  async write(path: string, content: string): Promise<WriteResult> {
    this.files.set(path, content);
    return {
      success: true,
      bytesWritten: Buffer.byteLength(content),
    };
  }
}

function makeWriter(fs: MemoryFs): HookConfigWriter {
  return new HookConfigWriter(fs as unknown as FileSystemProvider, vi.fn() as ExecFn);
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
});
