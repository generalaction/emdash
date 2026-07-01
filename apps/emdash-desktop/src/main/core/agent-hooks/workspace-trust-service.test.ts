import { describe, expect, it, vi } from 'vitest';
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { IFilesRuntime } from '@main/core/runtime/types';

vi.mock('@main/core/settings/settings-service', () => ({
  appSettingsService: { get: vi.fn() },
}));

import { WorkspaceTrustService } from './workspace-trust-service';

function makeProvider() {
  return {
    maybeAutoTrustLocal: vi.fn().mockResolvedValue(undefined),
    maybeAutoTrustSsh: vi.fn().mockResolvedValue(undefined),
  };
}

function makeCtx(): IExecutionContext {
  return {
    root: undefined,
    supportsLocalSpawn: false,
    exec: vi.fn(),
    execStreaming: vi.fn(),
    dispose: vi.fn(),
  };
}

function makeFilesRuntime(): IFilesRuntime {
  return { fileSystem: vi.fn() } as unknown as IFilesRuntime;
}

describe('WorkspaceTrustService', () => {
  it('delegates local workspace trust to each provider', async () => {
    const first = makeProvider();
    const second = makeProvider();
    const service = new WorkspaceTrustService([first, second]);
    const args = {
      providerId: 'cursor' as const,
      workspacePath: '/tmp/worktree',
      homedir: '/home/local-user',
      force: true,
    };

    await service.maybeAutoTrustLocal(args);

    expect(first.maybeAutoTrustLocal).toHaveBeenCalledWith(args);
    expect(second.maybeAutoTrustLocal).toHaveBeenCalledWith(args);
  });

  it('delegates ssh workspace trust to each provider', async () => {
    const first = makeProvider();
    const second = makeProvider();
    const service = new WorkspaceTrustService([first, second]);
    const args = {
      providerId: 'cursor' as const,
      workspacePath: '/remote/worktree',
      ctx: makeCtx(),
      files: makeFilesRuntime(),
      force: true,
    };

    await service.maybeAutoTrustSsh(args);

    expect(first.maybeAutoTrustSsh).toHaveBeenCalledWith(args);
    expect(second.maybeAutoTrustSsh).toHaveBeenCalledWith(args);
  });
});
