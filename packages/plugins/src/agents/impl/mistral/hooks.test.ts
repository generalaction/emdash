import type { PluginFs } from '@emdash/shared/agents/plugins';
import { describe, expect, it } from 'vitest';
import { MISTRAL_CONFIG_PATH, MISTRAL_HOOKS_PATH, buildMistralHookConfig } from './hooks';

function createMemoryFs(initial: Record<string, string> = {}): PluginFs {
  const files = new Map(Object.entries(initial));

  return {
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

describe('buildMistralHookConfig', () => {
  it('removes the experimental hooks flag when deleting hooks', async () => {
    const fs = createMemoryFs({
      [MISTRAL_CONFIG_PATH]: 'enable_experimental_hooks = true\nmodel = "mistral-large"\n',
      [MISTRAL_HOOKS_PATH]: `[[hooks]]
name = "emdash-post-agent-turn"
type = "post_agent_turn"
command = "curl http://127.0.0.1:$EMDASH_HOOK_PORT/hook"
`,
    });
    const hooks = buildMistralHookConfig();

    await hooks.deleteHooks(fs);

    await expect(fs.read(MISTRAL_CONFIG_PATH)).resolves.toBe('model = "mistral-large"\n');
  });

  it('fails before writing hooks when config.toml is invalid', async () => {
    const fs = createMemoryFs({ [MISTRAL_CONFIG_PATH]: 'invalid = [' });
    const hooks = buildMistralHookConfig();

    await expect(hooks.writeHooks(fs, [])).rejects.toThrow(
      `Failed to parse ${MISTRAL_CONFIG_PATH}`
    );
    await expect(fs.exists(MISTRAL_HOOKS_PATH)).resolves.toBe(false);
  });
});
