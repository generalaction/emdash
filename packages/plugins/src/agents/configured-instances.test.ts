import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { CLIAgentPluginProvider } from '@emdash/core/services/agent-plugins/api/plugins';
import type { PluginRegistry } from '@emdash/shared/plugins';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyConfiguredAgentInstances,
  applyConfiguredAgentInstancesFromEnv,
  CONFIGURED_AGENTS_ENV_VAR,
  loadConfiguredAgentInstances,
} from './configured-instances';

function fakeProvider(id: string, name: string): CLIAgentPluginProvider {
  return { metadata: { id, name } } as unknown as CLIAgentPluginProvider;
}

function fakeRegistry(preloadedIds: string[] = []): PluginRegistry<CLIAgentPluginProvider> {
  const plugins = new Map<string, CLIAgentPluginProvider>(
    preloadedIds.map((id) => [id, fakeProvider(id, id)])
  );
  return {
    register: (plugin) => plugins.set(plugin.metadata.id, plugin),
    get: (id) => plugins.get(id),
    getAll: () => [...plugins.values()],
    ids: () => [...plugins.keys()],
  };
}

const factories = {
  claude: (options: { id: string; name: string }) => fakeProvider(options.id, options.name),
};

describe('applyConfiguredAgentInstances', () => {
  it('does not resolve an inherited Object.prototype member as a factory', () => {
    const registry = fakeRegistry(['claude']);

    const result = applyConfiguredAgentInstances(
      [
        { id: 'evil-1', name: 'Evil', extends: 'constructor' },
        { id: 'evil-2', name: 'Evil', extends: 'toString' },
        { id: 'evil-3', name: 'Evil', extends: '__proto__' },
      ],
      { registry, factories }
    );

    expect(result.registeredIds).toEqual([]);
    expect(result.warnings).toHaveLength(3);
    for (const warning of result.warnings) {
      expect(warning).toContain('unknown extends');
    }
    expect(registry.getAll()).toHaveLength(1);
  });

  it('skips an entry whose factory throws instead of crashing the caller', () => {
    const registry = fakeRegistry(['claude']);
    const throwingFactories = {
      ...factories,
      broken: () => {
        throw new Error('boom');
      },
    };

    const result = applyConfiguredAgentInstances(
      [
        { id: 'claude-work', name: 'Claude (Work)', extends: 'claude' },
        { id: 'broken-work', name: 'Broken', extends: 'broken' },
      ],
      { registry, factories: throwingFactories }
    );

    expect(result.registeredIds).toEqual(['claude-work']);
    expect(result.warnings).toEqual([`skipped provider 'broken-work': factory threw: Error: boom`]);
    expect(registry.get('broken-work')).toBeUndefined();
  });
});

describe('loadConfiguredAgentInstances', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'configured-agent-instances-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('is a no-op when the file is missing', async () => {
    const registry = fakeRegistry(['claude']);
    const result = await loadConfiguredAgentInstances(path.join(dir, 'absent.json'), {
      registry,
      factories,
    });
    expect(result).toEqual({ instances: [], registeredIds: [], warnings: [] });
    expect(registry.getAll()).toHaveLength(1);
  });

  it('registers a valid declared instance', async () => {
    const file = path.join(dir, 'agents.json');
    await writeFile(
      file,
      JSON.stringify({
        providers: [{ id: 'claude-work', name: 'Claude (Work)', extends: 'claude' }],
      })
    );
    const registry = fakeRegistry(['claude']);
    const result = await loadConfiguredAgentInstances(file, { registry, factories });

    expect(result).toEqual({
      instances: [{ id: 'claude-work', name: 'Claude (Work)', extends: 'claude' }],
      registeredIds: ['claude-work'],
      warnings: [],
    });
    expect(registry.get('claude-work')?.metadata.name).toBe('Claude (Work)');
  });

  it('drops a malformed entry with a warning but keeps registering valid siblings', async () => {
    const file = path.join(dir, 'agents.json');
    await writeFile(
      file,
      JSON.stringify({
        providers: [
          { id: 'claude-work', name: 'Claude (Work)', extends: 'claude' },
          { id: '', name: 'Broken', extends: 'claude' },
        ],
      })
    );
    const registry = fakeRegistry(['claude']);
    const result = await loadConfiguredAgentInstances(file, { registry, factories });

    expect(result.registeredIds).toEqual(['claude-work']);
    expect(result.warnings).toHaveLength(1);
  });

  it('skips an entry whose id collides with an already-registered provider', async () => {
    const file = path.join(dir, 'agents.json');
    await writeFile(
      file,
      JSON.stringify({
        providers: [{ id: 'claude', name: 'Duplicate', extends: 'claude' }],
      })
    );
    const registry = fakeRegistry(['claude']);
    const result = await loadConfiguredAgentInstances(file, { registry, factories });

    expect(result.registeredIds).toEqual([]);
    expect(result.warnings).toEqual([`skipped provider 'claude': id is already registered`]);
    expect(registry.get('claude')?.metadata.name).toBe('claude');
  });

  it('skips an entry with an unknown extends value', async () => {
    const file = path.join(dir, 'agents.json');
    await writeFile(
      file,
      JSON.stringify({
        providers: [{ id: 'codex-work', name: 'Codex (Work)', extends: 'codex' }],
      })
    );
    const registry = fakeRegistry(['claude']);
    const result = await loadConfiguredAgentInstances(file, { registry, factories });

    expect(result.registeredIds).toEqual([]);
    expect(result.warnings).toEqual([
      `skipped provider 'codex-work': unknown extends 'codex' (supported: claude)`,
    ]);
  });

  it('treats a mistyped top-level key as an invalid shape instead of silently defaulting to empty', async () => {
    const file = path.join(dir, 'agents.json');
    await writeFile(
      file,
      JSON.stringify({
        provider: [{ id: 'claude-work', name: 'Claude (Work)', extends: 'claude' }],
      })
    );
    const registry = fakeRegistry(['claude']);
    const result = await loadConfiguredAgentInstances(file, { registry, factories });

    expect(result.registeredIds).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('invalid top-level shape');
  });

  it('treats a present-but-unparseable file as a warning with no registrations', async () => {
    const file = path.join(dir, 'agents.json');
    await writeFile(file, '{not json');
    const registry = fakeRegistry(['claude']);
    const result = await loadConfiguredAgentInstances(file, { registry, factories });

    expect(result.registeredIds).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('could not be read or parsed');
  });
});

describe('applyConfiguredAgentInstancesFromEnv', () => {
  const originalEnv = process.env[CONFIGURED_AGENTS_ENV_VAR];

  afterEach(() => {
    if (originalEnv === undefined) delete process.env[CONFIGURED_AGENTS_ENV_VAR];
    else process.env[CONFIGURED_AGENTS_ENV_VAR] = originalEnv;
  });

  function fakeLogger() {
    const warnings: Array<{ message: string; fields?: unknown }> = [];
    return {
      warn: (message: string, fields?: unknown) => warnings.push({ message, fields }),
      warnings,
    };
  }

  it('is a no-op when the env var is unset', () => {
    delete process.env[CONFIGURED_AGENTS_ENV_VAR];
    const registry = fakeRegistry(['claude']);
    const logger = fakeLogger();

    applyConfiguredAgentInstancesFromEnv(logger, { registry, factories });

    expect(registry.getAll()).toHaveLength(1);
    expect(logger.warnings).toEqual([]);
  });

  it('registers the instances published by the owning process', () => {
    process.env[CONFIGURED_AGENTS_ENV_VAR] = JSON.stringify([
      { id: 'claude-work', name: 'Claude (Work)', extends: 'claude' },
    ]);
    const registry = fakeRegistry(['claude']);
    const logger = fakeLogger();

    applyConfiguredAgentInstancesFromEnv(logger, { registry, factories });

    expect(registry.get('claude-work')?.metadata.name).toBe('Claude (Work)');
    expect(logger.warnings).toEqual([]);
  });

  it('logs a warning and no-ops when the env var is not valid JSON', () => {
    process.env[CONFIGURED_AGENTS_ENV_VAR] = '{not json';
    const registry = fakeRegistry(['claude']);
    const logger = fakeLogger();

    applyConfiguredAgentInstancesFromEnv(logger, { registry, factories });

    expect(registry.getAll()).toHaveLength(1);
    expect(logger.warnings).toHaveLength(1);
  });
});
