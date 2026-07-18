import type { PluginFs } from '@emdash/core/agents/plugins';
import { describe, expect, it } from 'vitest';
import { provider } from './index';

function createMemoryFs(): PluginFs & { files: Map<string, string> } {
  const files = new Map<string, string>();

  return {
    files,
    async read(path) {
      return files.get(path) ?? null;
    },
    async write(path, content) {
      files.set(path, content);
    },
    async delete(path) {
      files.delete(path);
    },
    async exists(path) {
      return files.has(path);
    },
    async list(path) {
      return [...files.keys()].filter((file) => file.startsWith(path));
    },
  };
}

describe('pi plugin hooks', () => {
  it('installs a session hook that can report the active Pi session file', async () => {
    const fs = createMemoryFs();

    const written = await provider.behavior.plugins?.installPlugin(fs, {
      kind: 'workspace',
      path: '/workspace',
    });

    expect(written).toEqual(['.pi/extensions/emdash-hook.ts']);
    const content = await fs.read('.pi/extensions/emdash-hook.ts');
    expect(content).toContain("eventType: 'stop' | 'error' | 'notification' | 'session'");
    expect(content).toContain("pi.on('session_start'");
    expect(content).toContain('ctx.sessionManager.getSessionFile()');
    expect(content).toContain("notifyEmdash('session'");
  });
});
