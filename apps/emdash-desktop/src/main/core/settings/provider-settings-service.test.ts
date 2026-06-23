import { describe, expect, it, vi } from 'vitest';
import type { IHostDependencyStore } from '../dependencies/host-dependency-store';
import {
  migrateProviderConfigOverrides,
  migrateProviderConfigToHostDependencyStore,
} from './provider-config-migrations';
import { providerCustomConfigEntrySchema } from './schema';

describe('providerCustomConfigEntrySchema', () => {
  it('accepts extraArgs and env fields', () => {
    const input = {
      extraArgs: '--verbose',
      env: { MY_KEY: 'value' },
    };
    expect(providerCustomConfigEntrySchema.parse(input)).toEqual(input);
  });

  it('treats absent fields as undefined', () => {
    const result = providerCustomConfigEntrySchema.parse({});
    expect(result.extraArgs).toBeUndefined();
    expect(result.env).toBeUndefined();
  });

  it('strips unknown fields like cli, path, installSource (legacy fields)', () => {
    const result = providerCustomConfigEntrySchema.parse({
      cli: 'claude',
      path: '/usr/local/bin/claude',
      installSource: 'path',
    });
    expect((result as Record<string, unknown>).cli).toBeUndefined();
    expect((result as Record<string, unknown>).path).toBeUndefined();
    expect((result as Record<string, unknown>).installSource).toBeUndefined();
  });
});

describe('migrateProviderConfigOverrides', () => {
  it('passes through an empty overrides object unchanged', () => {
    expect(migrateProviderConfigOverrides({})).toEqual({});
  });

  it('passes through extraArgs/env overrides unchanged', () => {
    expect(
      migrateProviderConfigOverrides({
        claude: { extraArgs: '--model claude-3-5-sonnet-latest' },
        codex: { env: { OPENAI_API_KEY: 'key' } },
      })
    ).toEqual({
      claude: { extraArgs: '--model claude-3-5-sonnet-latest' },
      codex: { env: { OPENAI_API_KEY: 'key' } },
    });
  });

  it('passes through overrides with unknown fields unchanged', () => {
    const overrides = {
      copilot: { cli: 'copilot', resumeFlag: '--resume' },
    } as Record<string, object>;
    expect(migrateProviderConfigOverrides(overrides)).toBe(overrides);
  });
});

describe('migrateProviderConfigToHostDependencyStore', () => {
  it('migrates path+installSource=path to kind:path selection', async () => {
    const mockStore: IHostDependencyStore = {
      getSelection: vi.fn(),
      setSelection: vi.fn().mockResolvedValue(undefined),
    };
    await migrateProviderConfigToHostDependencyStore(
      { claude: { installSource: 'path', path: '/usr/local/bin/claude' } },
      mockStore
    );
    expect(mockStore.setSelection).toHaveBeenCalledWith('local', 'claude', {
      kind: 'path',
      path: '/usr/local/bin/claude',
    });
  });

  it('migrates cli+installSource=cli to kind:cli selection', async () => {
    const mockStore: IHostDependencyStore = {
      getSelection: vi.fn(),
      setSelection: vi.fn().mockResolvedValue(undefined),
    };
    await migrateProviderConfigToHostDependencyStore(
      { claude: { installSource: 'cli', cli: 'my-claude' } },
      mockStore
    );
    expect(mockStore.setSelection).toHaveBeenCalledWith('local', 'claude', {
      kind: 'cli',
      command: 'my-claude',
    });
  });

  it('migrates installSource=homebrew to kind:method homebrew selection', async () => {
    const mockStore: IHostDependencyStore = {
      getSelection: vi.fn(),
      setSelection: vi.fn().mockResolvedValue(undefined),
    };
    await migrateProviderConfigToHostDependencyStore(
      { claude: { installSource: 'homebrew' } },
      mockStore
    );
    expect(mockStore.setSelection).toHaveBeenCalledWith('local', 'claude', {
      kind: 'method',
      method: 'homebrew',
    });
  });

  it('skips entries without legacy fields', async () => {
    const mockStore: IHostDependencyStore = {
      getSelection: vi.fn(),
      setSelection: vi.fn().mockResolvedValue(undefined),
    };
    await migrateProviderConfigToHostDependencyStore(
      { claude: { extraArgs: '--verbose' } },
      mockStore
    );
    expect(mockStore.setSelection).not.toHaveBeenCalled();
  });
});
