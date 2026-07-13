import type { PluginFs } from '@emdash/core/services/agent-plugins/api/plugins';
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

describe('oh-my-pi plugin hooks', () => {
  it('installs an OMP extension that reports turn completion from session_stop', async () => {
    const fs = createMemoryFs();

    const written = await provider.behavior.plugins?.installPlugin(fs, {
      kind: 'workspace',
      path: '/workspace',
    });

    expect(written).toEqual(['.omp/extensions/emdash-hook.ts']);
    const content = await fs.read('.omp/extensions/emdash-hook.ts');
    expect(content).toContain("pi.on('session_stop'");
    expect(content).toContain('event.session_file');
    expect(content).toContain("notifyEmdash('stop'");
    expect(content).toContain("pi.on('session_shutdown', async ()");
  });
});
