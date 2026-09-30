import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createMemoryKeyValueStore } from '@emdash/core/primitives/kv/api';
import {
  AgentPluginHost,
  createPluginRegistry,
  type CLIAgentPluginProvider,
} from '@emdash/core/services/agent-plugins/api/plugins';
import { createLocalPluginFs } from '@emdash/core/services/agent-plugins/api/plugins/helpers';
import { NodeExecutionContext } from '@emdash/core/services/exec/api';
import { HostDependenciesRuntime } from '@emdash/core/services/host-dependencies/node';
import { createScope } from '@emdash/shared/concurrency';
import { describe, expect, it } from 'vitest';
import { getPlugin } from '@core/features/agents/api/node/plugin-registry';
import { toAgentInstallationStatus } from './agent-payload-builder';

describe.skipIf(process.platform === 'win32')('Claude executable override launch', () => {
  it('uses the saved wrapper for TUI and Claude ACP without changing provider arguments', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'emdash-override-launch-'));
    const wrapper = join(directory, 'sandbox wrapper');
    await writeFile(wrapper, '#!/bin/sh\nprintf "wrapper:%s\\n" "$@"\n', { mode: 0o755 });
    const scope = createScope({ label: 'override-launch-test' });
    const exec = new NodeExecutionContext({ env: { PATH: process.env.PATH } });
    const runtime = new HostDependenciesRuntime({
      hostId: 'local',
      store: createMemoryKeyValueStore(),
      exec,
      definitions: [
        {
          id: 'claude',
          name: 'Claude',
          category: 'agent',
          binaryNames: ['claude'],
          status: 'active',
        },
      ],
    });
    const registry = createPluginRegistry<CLIAgentPluginProvider>();
    registry.register(getPlugin('claude'));
    const host = new AgentPluginHost({
      scope,
      registry,
      exec,
      dependencies: runtime,
      fs: createLocalPluginFs(directory),
      env: async () => ({ HOME: directory, PATH: process.env.PATH }),
      homeDir: directory,
    });
    try {
      const selected = await runtime.setSelection('claude', { kind: 'path', path: wrapper });
      expect(selected.success).toBe(true);
      if (!selected.success) throw new Error('Wrapper selection failed');
      const status = toAgentInstallationStatus('claude', undefined, selected.data);
      expect(status).toMatchObject({ used: { kind: 'path', path: wrapper }, command: wrapper });
      expect(status.installations.find((installation) => installation.id === 'path')).toMatchObject(
        { pathEntry: wrapper, isActive: true, status: 'available' }
      );

      const tui = await host.buildPromptCommand('claude', {
        model: 'sonnet',
        autoApprove: false,
        initialPrompt: 'hello',
      });
      expect(tui).toMatchObject({ success: true, data: { command: wrapper } });
      if (!tui.success) throw new Error('TUI invocation failed');
      const output = await promisify(execFile)(tui.data.command, tui.data.args);
      expect(output.stdout).toContain('wrapper:hello');

      const acp = await host.buildAcpSpawn('claude', { cwd: directory });
      expect(acp).toMatchObject({
        success: true,
        data: { command: process.execPath, env: { CLAUDE_CODE_EXECUTABLE: wrapper } },
      });
      await rm(wrapper);
      expect(
        await host.buildPromptCommand('claude', { model: 'sonnet', autoApprove: false })
      ).toMatchObject({ success: false, error: { type: 'cli-not-found' } });
      expect(await host.buildAcpSpawn('claude', { cwd: directory })).toMatchObject({
        success: false,
        error: { type: 'cli-not-found' },
      });
    } finally {
      await host.dispose();
      runtime.dispose();
      await scope.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
