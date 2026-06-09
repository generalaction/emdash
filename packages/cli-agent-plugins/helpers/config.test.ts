import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { jsonConfig, tomlConfig } from './config';
import type { CLIAgentPluginFs } from '../core/plugin';

function makeMockFs(files: Record<string, string> = {}): CLIAgentPluginFs & {
  store: Record<string, string>;
} {
  const store: Record<string, string> = { ...files };
  return {
    store,
    async read(path) {
      return store[path] ?? null;
    },
    async write(path, content) {
      store[path] = content;
    },
    async delete(path) {
      delete store[path];
    },
    async exists(path) {
      return path in store;
    },
    async list() {
      return [];
    },
  };
}

const schema = z.object({ name: z.string(), count: z.number() });
const defaultValue = { name: 'default', count: 0 };

describe('jsonConfig', () => {
  const cfg = jsonConfig(schema, defaultValue);

  it('returns default when file does not exist', async () => {
    const fs = makeMockFs();
    expect(await cfg.read(fs, 'config.json')).toEqual(defaultValue);
  });

  it('reads and validates valid JSON', async () => {
    const fs = makeMockFs({ 'config.json': JSON.stringify({ name: 'hello', count: 5 }) });
    expect(await cfg.read(fs, 'config.json')).toEqual({ name: 'hello', count: 5 });
  });

  it('throws on invalid JSON content', async () => {
    const fs = makeMockFs({ 'config.json': JSON.stringify({ name: 123, count: 'bad' }) });
    await expect(cfg.read(fs, 'config.json')).rejects.toThrow();
  });

  it('writes valid data as formatted JSON', async () => {
    const fs = makeMockFs();
    await cfg.write(fs, 'config.json', { name: 'test', count: 2 });
    const raw = fs.store['config.json'];
    expect(raw).toContain('"name": "test"');
    expect(raw.endsWith('\n')).toBe(true);
    expect(JSON.parse(raw)).toEqual({ name: 'test', count: 2 });
  });

  it('throws on write with invalid data', async () => {
    const fs = makeMockFs();
    await expect(
      cfg.write(fs, 'config.json', { name: 123 as unknown as string, count: 0 }),
    ).rejects.toThrow();
  });

  it('update reads, transforms, and writes', async () => {
    const fs = makeMockFs({ 'config.json': JSON.stringify({ name: 'old', count: 1 }) });
    await cfg.update(fs, 'config.json', (current) => ({ ...current, count: current.count + 10 }));
    expect(JSON.parse(fs.store['config.json'])).toEqual({ name: 'old', count: 11 });
  });
});

describe('tomlConfig', () => {
  const cfg = tomlConfig(schema, defaultValue);

  it('returns default when file does not exist', async () => {
    const fs = makeMockFs();
    expect(await cfg.read(fs, 'config.toml')).toEqual(defaultValue);
  });

  it('reads and validates valid TOML', async () => {
    const fs = makeMockFs({ 'config.toml': 'name = "hello"\ncount = 5\n' });
    expect(await cfg.read(fs, 'config.toml')).toEqual({ name: 'hello', count: 5 });
  });

  it('writes valid data as TOML', async () => {
    const fs = makeMockFs();
    await cfg.write(fs, 'config.toml', { name: 'test', count: 3 });
    const raw = fs.store['config.toml'];
    expect(raw).toContain('name');
    expect(raw).toContain('test');
    // Round-trip: reading back should yield original data
    expect(await cfg.read(fs, 'config.toml')).toEqual({ name: 'test', count: 3 });
  });

  it('update reads, transforms, and writes', async () => {
    const fs = makeMockFs({ 'config.toml': 'name = "x"\ncount = 2\n' });
    await cfg.update(fs, 'config.toml', (current) => ({ ...current, count: current.count + 5 }));
    expect(await cfg.read(fs, 'config.toml')).toEqual({ name: 'x', count: 7 });
  });
});
