import { BrowserWindow, ipcMain } from 'electron';

import { log } from '../lib/logger';
import {
  ContainerConfigLoadError,
  ContainerConfigLoadErrorCode,
  loadWorkspaceContainerConfig,
} from '../services/containerConfigService';
import type { ResolvedContainerConfig } from '@shared/container';
import {
  containerRunnerService,
  type ContainerStartError,
  type ContainerStartResult,
} from '../services/containerRunnerService';
import type { RunnerMode } from '@shared/container';
import { resolveServiceIcon } from '../services/iconService';

type ContainerConfigIpcErrorCode =
  | ContainerConfigLoadErrorCode
  | 'INVALID_ARGUMENT'
  | 'UNKNOWN'
  | 'PORT_ALLOC_FAILED';

export interface SerializedContainerConfigError {
  code: ContainerConfigIpcErrorCode;
  message: string;
  configPath: string | null;
  configKey: string | null;
}

export interface ContainerConfigIpcResponse {
  ok: boolean;
  config?: ResolvedContainerConfig;
  sourcePath?: string | null;
  error?: SerializedContainerConfigError;
}

export interface ContainerStartIpcSuccess {
  ok: true;
  runId: string;
  sourcePath: string | null;
}

export interface ContainerStartIpcFailure {
  ok: false;
  error: SerializedContainerConfigError;
}

export type ContainerStartIpcResponse = ContainerStartIpcSuccess | ContainerStartIpcFailure;

containerRunnerService.onRunnerEvent((event) => {
  const windows = BrowserWindow.getAllWindows();
  for (const window of windows) {
    try {
      window.webContents.send('run:event', event);
    } catch (error) {
      log.warn('Failed to forward container runner event', error);
    }
  }
});

export function registerContainerIpc(): void {
  ipcMain.handle(
    'container:load-config',
    async (_event, args): Promise<ContainerConfigIpcResponse> => {
      const workspacePath = resolveWorkspacePath(args);
      if (!workspacePath) {
        return {
          ok: false,
          error: {
            code: 'INVALID_ARGUMENT',
            message: '`workspacePath` must be a non-empty string',
            configPath: null,
            configKey: null,
          },
        };
      }

      try {
        const result = await loadWorkspaceContainerConfig(workspacePath);
        if (result.ok) {
          return {
            ok: true,
            config: result.config,
            sourcePath: result.sourcePath,
          };
        }

        const serializedError = serializeError(result.error);
        log.debug('container:load-config validation failed', serializedError);
        return { ok: false, error: serializedError };
      } catch (error) {
        log.error('container:load-config unexpected failure', error);
        return {
          ok: false,
          error: {
            code: 'UNKNOWN',
            message: 'Failed to load container configuration',
            configPath: null,
            configKey: null,
          },
        };
      }
    }
  );

  ipcMain.handle(
    'container:start-run',
    async (_event, args): Promise<ContainerStartIpcResponse> => {
      log.info('IPC container:start-run invoked with args', args);
      const parsed = parseStartRunArgs(args);
      if (!parsed) {
        return {
          ok: false,
          error: {
            code: 'INVALID_ARGUMENT',
            message: '`workspaceId` and `workspacePath` must be provided to start a container run',
            configPath: null,
            configKey: null,
          },
        };
      }

      const result = await containerRunnerService.startRun(parsed);
      log.info('IPC container:start-run result', result?.ok);
      return serializeStartRunResult(result);
    }
  );

  ipcMain.handle(
    'container:stop-run',
    async (_event, args): Promise<{ ok: boolean; error?: string }> => {
      try {
        const workspaceId = typeof args?.workspaceId === 'string' ? args.workspaceId.trim() : '';
        if (!workspaceId) {
          return { ok: false, error: '`workspaceId` must be provided' };
        }
        const res = await containerRunnerService.stopRun(workspaceId);
        return res as any;
      } catch (error: any) {
        return { ok: false, error: error?.message || String(error) };
      }
    }
  );

  ipcMain.handle(
    'container:inspect-run',
    async (
      _event,
      args
    ): Promise<
      | {
          ok: true;
          running: boolean;
          ports: Array<{ service: string; container: number; host: number }>;
          previewService?: string;
        }
      | { ok: false; error: string }
    > => {
      try {
        const workspaceId = typeof args?.workspaceId === 'string' ? args.workspaceId.trim() : '';
        if (!workspaceId) {
          return { ok: false, error: '`workspaceId` must be provided' } as const;
        }
        return await containerRunnerService.inspectRun(workspaceId);
      } catch (error: any) {
        const message = error?.message || String(error);
        log.warn('container:inspect-run failed', message);
        return { ok: false, error: message } as const;
      }
    }
  );

  ipcMain.handle(
    'icons:resolve-service',
    async (_event, args: any): Promise<{ ok: boolean; dataUrl?: string; error?: string }> => {
      try {
        const service = typeof args?.service === 'string' ? args.service : '';
        const allowNetwork = args?.allowNetwork === true;
        const workspacePath = typeof args?.workspacePath === 'string' ? args.workspacePath : undefined;
        const res = await resolveServiceIcon({ service, allowNetwork, workspacePath });
        if (res.ok) return { ok: true, dataUrl: res.dataUrl };
        return { ok: false };
      } catch (error: any) {
        return { ok: false, error: error?.message || String(error) };
      }
    }
  );
}

function resolveWorkspacePath(args: unknown): string | null {
  if (typeof args === 'string') {
    const trimmed = args.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (args && typeof args === 'object') {
    const candidate = (args as { workspacePath?: unknown }).workspacePath;
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }

  return null;
}

function serializeError(error: ContainerConfigLoadError): SerializedContainerConfigError {
  return {
    code: error.code,
    message: error.message,
    configPath: error.configPath ?? null,
    configKey: error.configKey ?? null,
  };
}

function parseStartRunArgs(args: unknown): {
  workspaceId: string;
  workspacePath: string;
  runId?: string;
  mode?: RunnerMode;
} | null {
  if (!args || typeof args !== 'object') {
    return null;
  }

  const payload = args as Record<string, unknown>;
  const workspaceId = typeof payload.workspaceId === 'string' ? payload.workspaceId.trim() : '';
  const workspacePath =
    typeof payload.workspacePath === 'string' ? payload.workspacePath.trim() : '';
  if (!workspaceId || !workspacePath) {
    return null;
  }

  let runId: string | undefined;
  if (typeof payload.runId === 'string' && payload.runId.trim().length > 0) {
    runId = payload.runId.trim();
  }

  let mode: RunnerMode | undefined;
  if (typeof payload.mode === 'string') {
    if (payload.mode === 'container' || payload.mode === 'host') {
      mode = payload.mode;
    }
  }

  return { workspaceId, workspacePath, runId, mode };
}

function serializeStartRunResult(result: ContainerStartResult): ContainerStartIpcResponse {
  if (result.ok) {
    return {
      ok: true,
      runId: result.runId,
      sourcePath: result.sourcePath,
    };
  }

  return {
    ok: false,
    error: serializeStartError(result.error),
  };
}

function serializeStartError(error: ContainerStartError): SerializedContainerConfigError {
  return {
    code: error.code,
    message: error.message,
    configPath: error.configPath,
    configKey: error.configKey,
  };
}
