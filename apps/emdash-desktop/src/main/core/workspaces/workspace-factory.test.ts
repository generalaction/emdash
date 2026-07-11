import { ok } from '@emdash/shared';
import { describe, expect, it, vi } from 'vitest';
import type { PreviewServer } from '@shared/core/preview-servers/types';
import { dispatchWorkspaceLifecycleStartup, waitForWorkspacePreview } from './workspace-factory';

vi.mock('@main/db/client', () => ({ db: {} }));

function previews(...servers: PreviewServer[]) {
  return { listForWorkspace: () => servers };
}

describe('waitForWorkspacePreview', () => {
  it('returns ready for one exact forwarded SSH preview only after its tunnel is ready', async () => {
    const server: PreviewServer = {
      id: 'ssh:auto:project:workspace:ssh-1:3000',
      kind: 'forwarded',
      projectId: 'project',
      workspaceId: 'workspace',
      source: { kind: 'terminal-output', terminalId: 'run' },
      protocol: 'http:',
      urlPath: '/',
      status: { kind: 'ready' },
      connectionId: 'ssh-1',
      remotePort: 3000,
      localPort: 43000,
    };

    await expect(
      waitForWorkspacePreview({
        projectId: 'project',
        workspaceId: 'workspace',
        signal: new AbortController().signal,
        previewServers: previews(server),
      })
    ).resolves.toEqual({ success: true, data: undefined });
  });

  it('fails on ambiguous previews instead of choosing one implicitly', async () => {
    const direct = (id: string, port: number): PreviewServer => ({
      id,
      kind: 'direct',
      projectId: 'project',
      workspaceId: 'workspace',
      source: { kind: 'terminal-output', terminalId: 'run' },
      protocol: 'http:',
      urlPath: '/',
      status: { kind: 'ready' },
      host: '127.0.0.1',
      port,
    });

    await expect(
      waitForWorkspacePreview({
        projectId: 'project',
        workspaceId: 'workspace',
        signal: new AbortController().signal,
        previewServers: previews(direct('one', 3000), direct('two', 3001)),
      })
    ).resolves.toMatchObject({
      success: false,
      error: { type: 'preview-ambiguous', stage: 'preview' },
    });
  });

  it('fails when SSH forwarding reports a failed preview', async () => {
    const failed: PreviewServer = {
      id: 'ssh:auto:project:workspace:ssh-1:3000',
      kind: 'forwarded',
      projectId: 'project',
      workspaceId: 'workspace',
      source: { kind: 'terminal-output', terminalId: 'run' },
      protocol: 'http:',
      urlPath: '/',
      status: { kind: 'failed', message: 'forward failed' },
      connectionId: 'ssh-1',
      remotePort: 3000,
    };

    await expect(
      waitForWorkspacePreview({
        projectId: 'project',
        workspaceId: 'workspace',
        signal: new AbortController().signal,
        previewServers: previews(failed),
      })
    ).resolves.toMatchObject({
      success: false,
      error: { type: 'preview-failed', stage: 'preview' },
    });
  });
});

describe('dispatchWorkspaceLifecycleStartup', () => {
  it('starts the strict receipt exactly once and suppresses legacy fire-and-forget startup', () => {
    const startRequiredStartup = vi.fn(() => ({
      ready: Promise.resolve(
        ok({ setup: 'succeeded' as const, run: 'running' as const, preview: 'ready' as const })
      ),
      cancel: vi.fn(),
    }));
    const startNormal = vi.fn(async () => {});
    const required = {
      setup: { type: 'setup' as const, script: 'pnpm install' },
      run: { type: 'run' as const, script: 'pnpm dev' },
    };

    dispatchWorkspaceLifecycleStartup({
      strict: true,
      lifecycleService: { startRequiredStartup },
      required,
      startNormal,
    });

    expect(startRequiredStartup).toHaveBeenCalledTimes(1);
    expect(startRequiredStartup).toHaveBeenCalledWith(required);
    expect(startNormal).not.toHaveBeenCalled();
  });

  it('preserves the legacy startup path for ordinary workspaces', async () => {
    const startRequiredStartup = vi.fn(() => ({
      ready: Promise.resolve(
        ok({ setup: 'succeeded' as const, run: 'running' as const, preview: 'ready' as const })
      ),
      cancel: vi.fn(),
    }));
    const startNormal = vi.fn(async () => {});

    dispatchWorkspaceLifecycleStartup({
      strict: false,
      lifecycleService: { startRequiredStartup },
      required: {},
      startNormal,
    });

    await expect.poll(() => startNormal).toHaveBeenCalledTimes(1);
    expect(startRequiredStartup).not.toHaveBeenCalled();
  });
});
