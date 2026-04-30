import { describe, expect, it, vi } from 'vitest';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { extractGhCliToken, isGhCliAuthenticated } from './gh-cli-token';

function makeCtx(
  responses: Record<string, { stdout: string; stderr: string }>,
  throwAll?: Error
): IExecutionContext {
  return {
    root: undefined,
    supportsLocalSpawn: false,
    exec: vi.fn().mockImplementation(async (command: string, args: string[] = []) => {
      if (throwAll) throw throwAll;
      const key = [command, ...args].join(' ');
      const response = responses[key];
      if (!response) throw new Error(`Command not found: ${key}`);
      return response;
    }),
    execStreaming: vi.fn(),
    dispose: vi.fn(),
  } as unknown as IExecutionContext;
}

describe('isGhCliAuthenticated', () => {
  it('returns true when gh auth status succeeds', async () => {
    const ctx = makeCtx({ 'gh auth status': { stdout: '', stderr: '' } });
    expect(await isGhCliAuthenticated(ctx)).toBe(true);
  });

  it('returns false when gh auth status fails', async () => {
    const ctx = makeCtx({}, new Error('not authenticated'));
    expect(await isGhCliAuthenticated(ctx)).toBe(false);
  });
});

describe('extractGhCliToken', () => {
  it('returns trimmed token from gh auth token', async () => {
    const ctx = makeCtx({ 'gh auth token': { stdout: 'gho_abc123\n', stderr: '' } });
    expect(await extractGhCliToken(ctx)).toBe('gho_abc123');
  });

  it('returns null when gh auth token fails', async () => {
    const ctx = makeCtx({}, new Error('no token'));
    expect(await extractGhCliToken(ctx)).toBeNull();
  });

  it('returns null for empty stdout', async () => {
    const ctx = makeCtx({ 'gh auth token': { stdout: '', stderr: '' } });
    expect(await extractGhCliToken(ctx)).toBeNull();
  });
});
