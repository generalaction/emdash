import type * as nodePath from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IExecutionContext } from '#primitives/exec/api';
import { resolveOverride } from './resolve-override';

vi.mock('node:fs/promises', () => ({
  stat: vi.fn(async () => ({ isFile: () => true })),
  access: vi.fn(async () => {}),
  realpath: vi.fn(async (path: string) => path),
}));

vi.mock('node:path', async (importOriginal) => {
  const path = await importOriginal<typeof nodePath>();
  return { ...path, isAbsolute: path.win32.isAbsolute, extname: path.win32.extname };
});

describe('Windows executable overrides', () => {
  const exec = {
    root: '',
    supportsLocalSpawn: true,
    exec: vi.fn(),
    execStreaming: vi.fn(),
    dispose: vi.fn(),
  } satisfies IExecutionContext;

  beforeEach(() => {
    vi.stubGlobal('process', { ...process, platform: 'win32' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(['ps1', 'PS1'])(
    'accepts a PowerShell .%s wrapper in either override field',
    async (extension) => {
      const path = `C:\\Scripts\\provider.${extension}`;
      for (const selection of [
        { kind: 'path' as const, path },
        { kind: 'cli' as const, command: path },
      ]) {
        expect(await resolveOverride('claude', selection, exec)).toEqual({
          success: true,
          data: { id: 'claude', command: path, path, realpath: path, source: selection },
        });
      }
    }
  );

  it('still rejects unsupported Windows file extensions', async () => {
    expect(
      await resolveOverride('claude', { kind: 'path', path: 'C:\\Scripts\\provider.txt' }, exec)
    ).toMatchObject({ success: false, error: { type: 'invalid-selection' } });
  });
});
