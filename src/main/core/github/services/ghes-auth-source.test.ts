import { describe, expect, it, vi } from 'vitest';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { GhCliGitHubEnterpriseAuthSource } from './ghes-auth-source';

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

describe('GhCliGitHubEnterpriseAuthSource', () => {
  it('does not cache failed token lookups', async () => {
    const contexts = [
      makeCtx({}, new Error('not authenticated')),
      makeCtx({
        'gh auth token --hostname ghe.example.com': { stdout: 'ghes_token\n', stderr: '' },
      }),
    ];
    const source = new GhCliGitHubEnterpriseAuthSource(() => contexts.shift()!);

    await expect(source.getToken('ghe.example.com')).resolves.toBeNull();
    await expect(source.getToken('ghe.example.com')).resolves.toBe('ghes_token');
  });

  it('caches successful token lookups by normalized host', async () => {
    const ctx = makeCtx({
      'gh auth token --hostname ghe.example.com': { stdout: 'ghes_token\n', stderr: '' },
    });
    const source = new GhCliGitHubEnterpriseAuthSource(() => ctx);

    await expect(source.getToken('GHE.EXAMPLE.COM')).resolves.toBe('ghes_token');
    await expect(source.getToken('ghe.example.com')).resolves.toBe('ghes_token');
    expect(ctx.exec).toHaveBeenCalledTimes(1);
  });
});
