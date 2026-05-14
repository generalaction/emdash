import { describe, expect, it, vi } from 'vitest';
import {
  inspectProjectConfigMigrations,
  migrateProjectConfigFromProvider,
} from './config-migration';

vi.mock('@main/lib/logger', () => ({
  log: {
    warn: vi.fn(),
  },
}));

function createFs(initialFiles: Record<string, string>) {
  const files = new Map(Object.entries(initialFiles));
  return {
    exists: vi.fn((filePath: string) => Promise.resolve(files.has(filePath))),
    read: vi.fn((filePath: string) => {
      const content = files.get(filePath);
      if (content === undefined) throw new Error(`Missing file: ${filePath}`);
      return Promise.resolve({
        content,
        truncated: false,
        totalSize: Buffer.byteLength(content),
      });
    }),
    write: vi.fn((filePath: string, content: string) => {
      files.set(filePath, content);
      return Promise.resolve({
        success: true,
        bytesWritten: Buffer.byteLength(content),
      });
    }),
    content(filePath: string) {
      return files.get(filePath);
    },
  };
}

describe('config migration', () => {
  it('detects importable Conductor settings', async () => {
    const fs = createFs({
      'conductor.json': JSON.stringify({
        scripts: {
          setup: 'pnpm install',
          run: 'pnpm dev',
          archive: 'pnpm cleanup',
        },
        runScriptMode: 'nonconcurrent',
        enterpriseDataPrivacy: true,
      }),
      '.worktreeinclude': `
        # local env
        .env
        .env.local
        !*.example
      `,
    });

    await expect(inspectProjectConfigMigrations(fs)).resolves.toEqual([
      {
        provider: 'conductor',
        label: 'Conductor',
        files: ['conductor.json', '.worktreeinclude'],
        fields: ['scripts.setup', 'scripts.run', 'scripts.teardown', 'preservePatterns'],
        unsupportedFields: ['runScriptMode', 'enterpriseDataPrivacy'],
      },
    ]);
  });

  it('writes Conductor settings into .emdash.json', async () => {
    const fs = createFs({
      'conductor.json': JSON.stringify({
        scripts: {
          setup: 'pnpm install',
          run: 'pnpm dev',
          archive: 'pnpm cleanup',
        },
      }),
      '.worktreeinclude': '.env\n.env.local\n',
    });
    const patch = vi.fn().mockResolvedValue({ success: true });

    const result = await migrateProjectConfigFromProvider(
      {
        fs,
        settings: {
          patch,
        },
      } as never,
      { provider: 'conductor', destination: 'shared' }
    );

    expect(result.success).toBe(true);
    expect(JSON.parse(fs.content('.emdash.json') ?? '{}')).toEqual({
      scripts: {
        setup: 'pnpm install',
        run: 'pnpm dev',
        teardown: 'pnpm cleanup',
      },
      preservePatterns: ['.env', '.env.local'],
    });
    expect(patch).toHaveBeenCalledWith({
      clearShareableFields: [
        'scripts.setup',
        'scripts.run',
        'scripts.teardown',
        'preservePatterns',
      ],
    });
  });

  it('imports Conductor settings into local project settings', async () => {
    const fs = createFs({
      'conductor.json': JSON.stringify({
        scripts: {
          run: 'pnpm dev',
        },
      }),
      '.worktreeinclude': '.env\n.env.local\n',
    });
    const update = vi.fn().mockResolvedValue({ success: true });

    const result = await migrateProjectConfigFromProvider(
      {
        fs,
        settings: {
          get: vi.fn().mockResolvedValue({
            shellSetup: 'source .envrc',
            scripts: {
              setup: 'pnpm install',
            },
          }),
          update,
        },
      } as never,
      { provider: 'conductor', destination: 'local' }
    );

    expect(result.success).toBe(true);
    expect(fs.write).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      shellSetup: 'source .envrc',
      scripts: {
        setup: 'pnpm install',
        run: 'pnpm dev',
      },
      preservePatterns: ['.env', '.env.local'],
    });
  });

  it('returns an error when no supported Conductor settings exist', async () => {
    const fs = createFs({
      'conductor.json': JSON.stringify({
        runScriptMode: 'concurrent',
      }),
    });

    await expect(
      migrateProjectConfigFromProvider({ fs } as never, {
        provider: 'conductor',
        destination: 'shared',
      })
    ).resolves.toEqual({
      success: false,
      error: {
        type: 'write-config-failed',
        message: 'No supported Conductor settings were found.',
      },
    });
  });

  it('does not import when .emdash.json already exists', async () => {
    const fs = createFs({
      'conductor.json': JSON.stringify({
        scripts: {
          run: 'pnpm dev',
        },
      }),
      '.emdash.json': JSON.stringify({ scripts: { run: 'pnpm dev' } }),
    });

    const result = await migrateProjectConfigFromProvider({ fs } as never, {
      provider: 'conductor',
      destination: 'shared',
    });

    expect(result.success).toBe(false);
    expect(result).toEqual({
      success: false,
      error: {
        type: 'write-config-failed',
        message: '.emdash.json already exists.',
      },
    });
    expect(fs.write).not.toHaveBeenCalled();
  });

  it('returns an error for unknown providers', async () => {
    const fs = createFs({});

    await expect(
      migrateProjectConfigFromProvider({ fs } as never, {
        provider: 'unknown' as never,
        destination: 'shared',
      })
    ).resolves.toEqual({
      success: false,
      error: {
        type: 'write-config-failed',
        message: 'Unsupported config provider.',
      },
    });
  });
});
