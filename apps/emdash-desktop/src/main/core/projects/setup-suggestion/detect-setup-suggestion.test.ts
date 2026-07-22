import { describe, expect, it } from 'vitest';
import { detectSetupSuggestion } from './detect-setup-suggestion';

function fsWith(files: string[], opts: { throwOn?: string } = {}) {
  const present = new Set(files);
  return {
    exists: (path: string): Promise<boolean> => {
      if (opts.throwOn && path === opts.throwOn) {
        return Promise.reject(new Error('boom'));
      }
      return Promise.resolve(present.has(path));
    },
  };
}

describe('detectSetupSuggestion', () => {
  it('suggests bun install for a bun lockfile', async () => {
    const result = await detectSetupSuggestion(fsWith(['bun.lock', 'package.json']));
    expect(result).toEqual({ tool: 'bun', displayName: 'Bun', command: 'bun install' });
  });

  it('prefers a pinned package manager over a bare package.json', async () => {
    const result = await detectSetupSuggestion(fsWith(['pnpm-lock.yaml', 'package.json']));
    expect(result?.command).toBe('pnpm install');
  });

  it('falls back to npm install for a bare package.json', async () => {
    const result = await detectSetupSuggestion(fsWith(['package.json']));
    expect(result).toEqual({ tool: 'node', displayName: 'Node.js', command: 'npm install' });
  });

  it('detects non-JS ecosystems', async () => {
    expect((await detectSetupSuggestion(fsWith(['Cargo.toml'])))?.command).toBe('cargo build');
    expect((await detectSetupSuggestion(fsWith(['go.mod'])))?.command).toBe('go mod download');
    expect((await detectSetupSuggestion(fsWith(['Gemfile'])))?.command).toBe('bundle install');
  });

  it('returns null when no known tooling is present', async () => {
    expect(await detectSetupSuggestion(fsWith(['README.md']))).toBeNull();
  });

  it('treats a failing exists() check as not present', async () => {
    const result = await detectSetupSuggestion(fsWith([], { throwOn: 'bun.lockb' }));
    expect(result).toBeNull();
  });
});
