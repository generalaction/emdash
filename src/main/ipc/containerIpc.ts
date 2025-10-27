import { ipcMain } from 'electron';

import { log } from '../lib/logger';
import {
  ContainerConfigLoadError,
  ContainerConfigLoadErrorCode,
  loadWorkspaceContainerConfig,
} from '../services/containerConfigService';
import type { ResolvedContainerConfig } from '@shared/container';

type ContainerConfigIpcErrorCode =
  | ContainerConfigLoadErrorCode
  | 'INVALID_ARGUMENT'
  | 'UNKNOWN';

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

export function registerContainerIpc(): void {
  ipcMain.handle('container:load-config', async (_event, args): Promise<ContainerConfigIpcResponse> => {
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
  });
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
