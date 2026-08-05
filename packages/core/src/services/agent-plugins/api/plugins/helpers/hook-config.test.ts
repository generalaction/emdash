import type { PluginFs } from '@primitives/plugin-fs/api';
import { describe, expect, it, vi } from 'vitest';
import { readJsonConfig, readTomlConfig } from './hook-config';

function configFs(content: string): PluginFs {
  return {
    read: async () => content,
    write: vi.fn(async () => {}),
    delete: async () => {},
    exists: async () => true,
    list: async () => [],
  };
}

describe('hook config parsing', () => {
  it('refuses to treat invalid JSON as an empty config', async () => {
    await expect(readJsonConfig(configFs('{ invalid'), 'settings.json')).rejects.toThrow(
      'Failed to parse settings.json'
    );
  });

  it('refuses non-object JSON roots', async () => {
    await expect(readJsonConfig(configFs('[]'), 'settings.json')).rejects.toThrow(
      'expected an object at the config root'
    );
  });

  it('refuses to treat invalid TOML as an empty config', async () => {
    await expect(readTomlConfig(configFs('invalid = ['), 'config.toml')).rejects.toThrow(
      'Failed to parse config.toml'
    );
  });
});
