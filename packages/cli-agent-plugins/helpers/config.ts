// packages/cli-agent-plugins/helpers/config.ts
import { z } from 'zod';
import type { CLIAgentPluginFs } from '../core/plugin';

export interface ConfigFile<T> {
  read(fs: CLIAgentPluginFs, path: string): Promise<T>;
  write(fs: CLIAgentPluginFs, path: string, data: T): Promise<void>;
  update(fs: CLIAgentPluginFs, path: string, updater: (current: T) => T): Promise<void>;
}

export function jsonConfig<T>(schema: z.ZodType<T>, defaultValue: T): ConfigFile<T> {
  return {
    async read(fs, path) {
      const content = await fs.read(path);
      if (!content) return defaultValue;
      const parsed = JSON.parse(content);
      return schema.parse(parsed);
    },
    async write(fs, path, data) {
      schema.parse(data); // validate before write
      await fs.write(path, JSON.stringify(data, null, 2) + '\n');
    },
    async update(fs, path, updater) {
      const current = await this.read(fs, path);
      const updated = updater(current);
      await this.write(fs, path, updated);
    },
  };
}

export function tomlConfig<T>(schema: z.ZodType<T>, defaultValue: T): ConfigFile<T> {
  return {
    async read(fs, path) {
      const content = await fs.read(path);
      if (!content) return defaultValue;
      const { parse } = await import('smol-toml');
      const parsed = parse(content);
      return schema.parse(parsed);
    },
    async write(fs, path, data) {
      schema.parse(data);
      const { stringify } = await import('smol-toml');
      await fs.write(path, stringify(data as Record<string, unknown>));
    },
    async update(fs, path, updater) {
      const current = await this.read(fs, path);
      const updated = updater(current);
      await this.write(fs, path, updated);
    },
  };
}
