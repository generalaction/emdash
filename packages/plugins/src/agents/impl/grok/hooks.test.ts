import { spawnSync } from 'node:child_process';
import type { PluginFs } from '@agent/core/services/agent-plugins/api/plugins';
import { describe, expect, it } from 'vitest';
import { GROK_HOOKS_PATH, buildGrokHookConfig } from './hooks';

function createMemoryFs(): PluginFs & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    read: async (path) => files.get(path) ?? null,
    write: async (path, content) => {
      files.set(path, content);
    },
    delete: async (path) => {
      files.delete(path);
    },
    exists: async (path) => files.has(path),
    list: async () => [],
  };
}

describe('Grok hook config', () => {
  it.skipIf(process.platform === 'win32')(
    'does not invoke its custom session hook outside Agent',
    async () => {
      const fs = createMemoryFs();
      await buildGrokHookConfig().writeHooks(fs, []);
      const config = JSON.parse(fs.files.get(GROK_HOOKS_PATH) ?? '{}') as {
        hooks: { SessionStart: Array<{ hooks: Array<{ command: string }> }> };
      };
      const command = config.hooks.SessionStart[0]?.hooks[0]?.command;
      expect(command).toBeDefined();

      const shellCommand = `curl() { printf called; }; ${command}`;
      const outsideAgent = spawnSync('/bin/sh', ['-c', shellCommand], {
        encoding: 'utf8',
        env: { PATH: process.env.PATH ?? '' },
      });
      const insideAgent = spawnSync('/bin/sh', ['-c', shellCommand], {
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH ?? '',
          AGENT_HOOK_PORT: '1234',
          AGENT_HOOK_NONCE: 'nonce',
          AGENT_PTY_ID: 'pty-1',
          GROK_SESSION_ID: 'session-1',
        },
      });

      expect(outsideAgent.status).toBe(0);
      expect(outsideAgent.stdout).toBe('');
      expect(insideAgent.status).toBe(0);
      expect(insideAgent.stdout).toBe('called');
    }
  );
});
