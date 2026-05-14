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

  it('detects importable Superset settings', async () => {
    const fs = createFs({
      '.superset/config.json': JSON.stringify({
        setup: ['bun install', 'cp "$SUPERSET_ROOT_PATH/.env" .env'],
        run: ['./.superset/run.sh'],
        teardown: ['docker-compose down'],
      }),
    });

    await expect(inspectProjectConfigMigrations(fs)).resolves.toEqual([
      {
        provider: 'superset',
        label: 'Superset',
        files: ['.superset/config.json'],
        fields: ['scripts.setup', 'scripts.run', 'scripts.teardown'],
        unsupportedFields: [],
      },
    ]);
  });

  it('writes Superset settings into .emdash.json', async () => {
    const fs = createFs({
      '.superset/config.json': JSON.stringify({
        setup: ['bun install', 'cp "$SUPERSET_ROOT_PATH/.env" .env'],
        run: ['./.superset/run.sh'],
        teardown: ['docker-compose down'],
      }),
    });
    const patch = vi.fn().mockResolvedValue({ success: true });

    const result = await migrateProjectConfigFromProvider(
      {
        fs,
        settings: {
          patch,
        },
      } as never,
      { provider: 'superset', destination: 'shared' }
    );

    expect(result.success).toBe(true);
    expect(JSON.parse(fs.content('.emdash.json') ?? '{}')).toEqual({
      scripts: {
        setup: 'bun install\ncp "$SUPERSET_ROOT_PATH/.env" .env',
        run: './.superset/run.sh',
        teardown: 'docker-compose down',
      },
    });
    expect(patch).toHaveBeenCalledWith({
      clearShareableFields: ['scripts.setup', 'scripts.run', 'scripts.teardown'],
    });
  });

  it('imports Superset settings into local project settings', async () => {
    const fs = createFs({
      '.superset/config.json': JSON.stringify({
        run: ['./.superset/run.sh'],
      }),
    });
    const update = vi.fn().mockResolvedValue({ success: true });

    const result = await migrateProjectConfigFromProvider(
      {
        fs,
        settings: {
          get: vi.fn().mockResolvedValue({
            scripts: {
              setup: 'bun install',
            },
          }),
          update,
        },
      } as never,
      { provider: 'superset', destination: 'local' }
    );

    expect(result.success).toBe(true);
    expect(fs.write).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      scripts: {
        setup: 'bun install',
        run: './.superset/run.sh',
      },
    });
  });

  it('does not import Superset before and after script extensions', async () => {
    const fs = createFs({
      '.superset/config.json': JSON.stringify({
        setup: {
          before: ["echo 'running pre-setup'"],
          after: ['./.superset/my-post-setup.sh'],
        },
        teardown: {
          after: ['./.superset/my-cleanup.sh'],
        },
      }),
    });

    await expect(inspectProjectConfigMigrations(fs)).resolves.toEqual([]);
    await expect(
      migrateProjectConfigFromProvider({ fs } as never, {
        provider: 'superset',
        destination: 'shared',
      })
    ).resolves.toEqual({
      success: false,
      error: {
        type: 'write-config-failed',
        message: 'No supported Superset settings were found.',
      },
    });
  });

  it('detects importable Paseo settings', async () => {
    const fs = createFs({
      'paseo.json': JSON.stringify({
        worktree: {
          setup: ['npm ci', 'cp "$PASEO_SOURCE_CHECKOUT_PATH/.env" .env', 'npm run db:migrate'],
          teardown: 'npm run db:drop || true',
          terminals: [{ name: 'logs', command: 'tail -f dev.log' }],
        },
        scripts: {
          test: { command: 'npm test' },
          web: { command: 'npm run dev -- --port $PASEO_PORT', type: 'service', port: 3000 },
        },
      }),
    });

    await expect(inspectProjectConfigMigrations(fs)).resolves.toEqual([
      {
        provider: 'paseo',
        label: 'Paseo',
        files: ['paseo.json'],
        fields: ['scripts.setup', 'scripts.teardown'],
        unsupportedFields: [
          'scripts.test.command',
          'scripts.web.command',
          'scripts.web.type',
          'scripts.web.port',
          'worktree.terminals',
        ],
      },
    ]);
  });

  it('writes Paseo settings into .emdash.json', async () => {
    const fs = createFs({
      'paseo.json': JSON.stringify({
        worktree: {
          setup: 'npm ci',
          teardown: ['rm -rf .cache'],
        },
        scripts: {
          web: { command: 'npm run dev', type: 'service', port: 3000 },
          lint: { command: 'npm run lint' },
        },
      }),
    });
    const patch = vi.fn().mockResolvedValue({ success: true });

    const result = await migrateProjectConfigFromProvider(
      {
        fs,
        settings: {
          patch,
        },
      } as never,
      { provider: 'paseo', destination: 'shared' }
    );

    expect(result.success).toBe(true);
    expect(JSON.parse(fs.content('.emdash.json') ?? '{}')).toEqual({
      scripts: {
        setup: 'npm ci',
        teardown: 'rm -rf .cache',
      },
    });
    expect(patch).toHaveBeenCalledWith({
      clearShareableFields: ['scripts.setup', 'scripts.teardown'],
    });
  });

  it('imports Paseo settings into local project settings', async () => {
    const fs = createFs({
      'paseo.json': JSON.stringify({
        worktree: {
          setup: 'npm ci',
        },
        scripts: {
          web: { command: 'npm run dev', type: 'service' },
        },
      }),
    });
    const update = vi.fn().mockResolvedValue({ success: true });

    const result = await migrateProjectConfigFromProvider(
      {
        fs,
        settings: {
          get: vi.fn().mockResolvedValue({
            scripts: {
              teardown: 'docker compose down',
            },
          }),
          update,
        },
      } as never,
      { provider: 'paseo', destination: 'local' }
    );

    expect(result.success).toBe(true);
    expect(fs.write).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      scripts: {
        setup: 'npm ci',
        teardown: 'docker compose down',
      },
    });
  });

  it('does not import when only Paseo scripts are configured', async () => {
    const fs = createFs({
      'paseo.json': JSON.stringify({
        scripts: {
          test: { command: 'npm test' },
          web: { command: 'npm run dev', type: 'service' },
        },
      }),
    });

    await expect(inspectProjectConfigMigrations(fs)).resolves.toEqual([]);
    await expect(
      migrateProjectConfigFromProvider({ fs } as never, {
        provider: 'paseo',
        destination: 'shared',
      })
    ).resolves.toEqual({
      success: false,
      error: {
        type: 'write-config-failed',
        message: 'No supported Paseo settings were found.',
      },
    });
  });

  it('detects importable Codex local environment settings', async () => {
    const fs = createFs({
      '.codex/environments/environment.toml': `
        version = 1
        name = "emdash"

        [setup]
        script = """
        npm install
        npm run build
        """

        [cleanup]
        script = "docker compose down"

        [[actions]]
        name = "Run"
        icon = "run"
        command = "npm run dev"
      `,
    });

    await expect(inspectProjectConfigMigrations(fs)).resolves.toEqual([
      {
        provider: 'codex',
        label: 'Codex',
        files: ['.codex/environments/environment.toml'],
        fields: ['scripts.setup', 'scripts.teardown'],
        unsupportedFields: ['actions.Run.command', 'actions.Run.icon'],
      },
    ]);
  });

  it('writes Codex local environment settings into .emdash.json', async () => {
    const fs = createFs({
      '.codex/environments/environment.toml': `
        [setup]
        script = "npm ci"

        [cleanup]
        script = "rm -rf .cache"

        [[actions]]
        name = "Test"
        command = "npm test"
      `,
    });
    const patch = vi.fn().mockResolvedValue({ success: true });

    const result = await migrateProjectConfigFromProvider(
      {
        fs,
        settings: {
          patch,
        },
      } as never,
      { provider: 'codex', destination: 'shared' }
    );

    expect(result.success).toBe(true);
    expect(JSON.parse(fs.content('.emdash.json') ?? '{}')).toEqual({
      scripts: {
        setup: 'npm ci',
        teardown: 'rm -rf .cache',
      },
    });
    expect(patch).toHaveBeenCalledWith({
      clearShareableFields: ['scripts.setup', 'scripts.teardown'],
    });
  });

  it('imports Codex local environment settings into local project settings', async () => {
    const fs = createFs({
      '.codex/environments/environment.toml': `
        [setup]
        script = "npm ci"
      `,
    });
    const update = vi.fn().mockResolvedValue({ success: true });

    const result = await migrateProjectConfigFromProvider(
      {
        fs,
        settings: {
          get: vi.fn().mockResolvedValue({
            scripts: {
              teardown: 'docker compose down',
            },
          }),
          update,
        },
      } as never,
      { provider: 'codex', destination: 'local' }
    );

    expect(result.success).toBe(true);
    expect(fs.write).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      scripts: {
        setup: 'npm ci',
        teardown: 'docker compose down',
      },
    });
  });

  it('does not import when only Codex actions are configured', async () => {
    const fs = createFs({
      '.codex/environments/environment.toml': `
        [[actions]]
        name = "Run"
        icon = "run"
        command = "npm run dev"
      `,
    });

    await expect(inspectProjectConfigMigrations(fs)).resolves.toEqual([]);
    await expect(
      migrateProjectConfigFromProvider({ fs } as never, {
        provider: 'codex',
        destination: 'shared',
      })
    ).resolves.toEqual({
      success: false,
      error: {
        type: 'write-config-failed',
        message: 'No supported Codex settings were found.',
      },
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
