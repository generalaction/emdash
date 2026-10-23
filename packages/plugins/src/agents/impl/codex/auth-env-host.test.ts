import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AgentPluginHost,
  createPluginRegistry,
  type CLIAgentPluginProvider,
} from '@emdash/core/services/agent-plugins/api/plugins';
import { createLocalPluginFs } from '@emdash/core/services/agent-plugins/api/plugins/helpers';
import { NodeExecutionContext } from '@emdash/core/services/exec/api';
import { createScope } from '@emdash/shared/concurrency';
import { afterEach, describe, expect, it } from 'vitest';
import { provider } from './index';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
});

async function fixture(): Promise<{ home: string; host: AgentPluginHost }> {
  const home = await mkdtemp(join(tmpdir(), 'codex-auth-env-'));
  cleanup.push(() => rm(home, { recursive: true, force: true }));
  await mkdir(join(home, '.codex'));
  await writeFile(
    join(home, '.codex/config.toml'),
    '[model_providers.local]\nenv_key = "LOCAL_API_KEY"\n'
  );
  const registry = createPluginRegistry<CLIAgentPluginProvider>();
  registry.register(provider);
  const env = async (): Promise<Record<string, string>> => ({
    HOME: home,
    PATH: '/bin',
    LOCAL_API_KEY: 'fixture-only',
    OTHER_SECRET: 'excluded',
  });
  const host = new AgentPluginHost({
    scope: createScope({ label: 'codex-auth-env-test' }),
    registry,
    exec: new NodeExecutionContext({ env }),
    env,
    homeDir: home,
    platform: 'linux',
    fs: createLocalPluginFs(home),
    configFs: createLocalPluginFs,
    dependencies: {
      resolve: async (id) => ({
        success: true,
        data: {
          id,
          command: 'codex',
          path: '/bin/codex',
          realpath: '/bin/codex',
          source: { kind: 'auto' },
        },
      }),
    },
  });
  cleanup.push(() => host.dispose());
  return { home, host };
}

describe('Codex user configuration to agent environment', () => {
  it('inherits declared remote keys without copying unrelated secrets', async () => {
    const { host } = await fixture();
    const result = await host.buildAcpSpawn('codex', { cwd: '/untrusted/project' });
    expect(result).toMatchObject({
      success: true,
      data: { env: { LOCAL_API_KEY: 'fixture-only' } },
    });
    if (result.success) expect(result.data.env).not.toHaveProperty('OTHER_SECRET');
  });

  it('keeps explicit user overrides above inherited credentials', async () => {
    const { host } = await fixture();
    const result = await host.buildAcpSpawn('codex', {
      cwd: '/work',
      env: { LOCAL_API_KEY: 'override-fixture' },
    });
    expect(result).toMatchObject({
      success: true,
      data: { env: { LOCAL_API_KEY: 'override-fixture' } },
    });
  });

  it('uses the overridden CODEX_HOME and refreshes names after config edits', async () => {
    const { home, host } = await fixture();
    const root = join(home, 'alternate');
    await mkdir(root);
    const file = join(root, 'config.toml');
    await writeFile(file, '[model_providers.local]\nenv_key = "OTHER_SECRET"\n');
    const result = await host.buildAcpSpawn('codex', { cwd: '/work', env: { CODEX_HOME: root } });
    expect(result).toMatchObject({ success: true, data: { env: { OTHER_SECRET: 'excluded' } } });
    if (result.success) expect(result.data.env).not.toHaveProperty('LOCAL_API_KEY');
    await writeFile(file, '');
    const updated = await host.buildAcpSpawn('codex', { cwd: '/work', env: { CODEX_HOME: root } });
    expect(updated.success).toBe(true);
    if (updated.success) expect(updated.data.env).not.toHaveProperty('OTHER_SECRET');
  });

  it('uses the overridden user config for terminal commands too', async () => {
    const { home, host } = await fixture();
    const root = join(home, 'terminal-config');
    await mkdir(root);
    await writeFile(
      join(root, 'config.toml'),
      '[model_providers.local]\nenv_key = "OTHER_SECRET"\n'
    );
    const result = await host.buildPromptCommand(
      'codex',
      { autoApprove: false, model: '' },
      { CODEX_HOME: root }
    );
    expect(result).toMatchObject({
      success: true,
      data: { env: { CODEX_HOME: root, OTHER_SECRET: 'excluded' } },
    });
    if (result.success) expect(result.data.env).not.toHaveProperty('LOCAL_API_KEY');
  });

  it('reports configuration failures as environment failures without leaking TOML', async () => {
    const { home, host } = await fixture();
    await writeFile(join(home, '.codex/config.toml'), 'secret = "fixture-private"\nbroken = [');
    expect(await host.resolveSpawnContext('codex')).toEqual({
      success: false,
      error: {
        type: 'environment-unavailable',
        providerId: 'codex',
        message: 'Cannot parse Codex user config.toml for authentication environment',
      },
    });
  });
});
