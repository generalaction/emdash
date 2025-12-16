import { BrowserWindow, ipcMain } from 'electron';

import { log } from '../lib/logger';
import {
  ContainerConfigLoadError,
  ContainerConfigLoadErrorCode,
  loadTaskContainerConfig,
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
      const taskPath = resolveTaskPath(args);
      if (!taskPath) {
        return {
          ok: false,
          error: {
            code: 'INVALID_ARGUMENT',
            message: '`taskPath` must be a non-empty string',
            configPath: null,
            configKey: null,
          },
        };
      }

      try {
        const result = await loadTaskContainerConfig(taskPath);
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
            message: '`taskId` and `taskPath` must be provided to start a container run',
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
        const taskId = typeof args?.taskId === 'string' ? args.taskId.trim() : '';
        if (!taskId) {
          return { ok: false, error: '`taskId` must be provided' };
        }
        const res = await containerRunnerService.stopRun(taskId);
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
        const taskId = typeof args?.taskId === 'string' ? args.taskId.trim() : '';
        if (!taskId) {
          return { ok: false, error: '`taskId` must be provided' } as const;
        }
        return await containerRunnerService.inspectRun(taskId);
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
        const taskPath =
          typeof args?.taskPath === 'string' ? args.taskPath : undefined;
        const res = await resolveServiceIcon({ service, allowNetwork, taskPath });
        if (res.ok) return { ok: true, dataUrl: res.dataUrl };
        return { ok: false };
      } catch (error: any) {
        return { ok: false, error: error?.message || String(error) };
      }
    }
  );
}

function resolveTaskPath(args: unknown): string | null {
  if (typeof args === 'string') {
    const trimmed = args.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (args && typeof args === 'object') {
    const candidate = (args as { taskPath?: unknown }).taskPath;
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
  taskId: string;
  taskPath: string;
  runId?: string;
  mode?: RunnerMode;
} | null {
  if (!args || typeof args !== 'object') {
    return null;
  }

  const payload = args as Record<string, unknown>;
  const taskId = typeof payload.taskId === 'string' ? payload.taskId.trim() : '';
  const taskPath =
    typeof payload.taskPath === 'string' ? payload.taskPath.trim() : '';
  if (!taskId || !taskPath) {
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

  return { taskId, taskPath, runId, mode };
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
