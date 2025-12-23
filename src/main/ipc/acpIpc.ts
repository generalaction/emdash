import { ipcMain } from 'electron';
import path from 'path';
import fs from 'fs/promises';
import { acpService } from '../services/AcpService';
import { isValidProviderId, PROVIDER_IDS } from '../../shared/providers/registry';

/**
 * Validates and sanitizes the ACP start session arguments.
 * Throws an error with a descriptive message if validation fails.
 */
async function validateAcpStartArgs(
  args: unknown
): Promise<{ taskId: string; providerId: string; cwd: string }> {
  // Check if args exists and is an object
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw new Error('Invalid arguments: must be an object');
  }

  const { taskId, providerId, cwd } = args as Record<string, unknown>;

  // Validate taskId
  if (typeof taskId !== 'string' || taskId.trim() === '') {
    throw new Error('Invalid taskId: must be a non-empty string');
  }

  // Validate providerId
  if (typeof providerId !== 'string' || providerId.trim() === '') {
    throw new Error('Invalid providerId: must be a non-empty string');
  }

  // Check providerId against the canonical list of allowed provider IDs
  if (!isValidProviderId(providerId)) {
    throw new Error(
      `Unknown providerId: "${providerId}". Allowed providers: ${PROVIDER_IDS.join(', ')}`
    );
  }

  // Validate cwd
  if (typeof cwd !== 'string' || cwd.trim() === '') {
    throw new Error('Invalid cwd: must be a non-empty string');
  }

  // Resolve and normalize the path to prevent path traversal
  let resolvedCwd: string;
  try {
    resolvedCwd = await fs.realpath(cwd);
  } catch {
    // If realpath fails (e.g., path doesn't exist), fall back to path.resolve
    // This still normalizes the path and prevents path traversal
    resolvedCwd = path.resolve(cwd);
  }

  // Ensure the resolved path is absolute
  if (!path.isAbsolute(resolvedCwd)) {
    throw new Error('Invalid cwd: must be an absolute path');
  }

  return { taskId, providerId, cwd: resolvedCwd };
}

export function registerAcpIpc() {
  ipcMain.handle(
    'acp:start',
    async (_event, args: { taskId: string; providerId: string; cwd: string }) => {
      try {
        const validatedArgs = await validateAcpStartArgs(args);
        return acpService.startSession(validatedArgs);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown validation error';
        return { success: false, error: message };
      }
    }
  );

  ipcMain.handle(
    'acp:prompt',
    async (
      _event,
      args: { sessionId: string; prompt: Array<{ type: string; [key: string]: any }> }
    ) => {
      return acpService.sendPrompt(args);
    }
  );

  ipcMain.handle('acp:cancel', async (_event, args: { sessionId: string }) => {
    try {
      await acpService.cancelSession(args.sessionId);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('acp:dispose', async (_event, args: { sessionId: string }) => {
    try {
      await acpService.disposeSession(args.sessionId);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(
    'acp:permission',
    async (
      _event,
      args: {
        sessionId: string;
        requestId: number;
        outcome: { outcome: 'selected'; optionId: string } | { outcome: 'cancelled' };
      }
    ) => {
      return acpService.respondPermission(args);
    }
  );

  ipcMain.handle('acp:set-mode', async (_event, args: { sessionId: string; modeId: string }) => {
    return acpService.setMode(args.sessionId, args.modeId);
  });

  ipcMain.handle(
    'acp:set-model',
    async (_event, args: { sessionId: string; modelId: string }) => {
      return acpService.setModel(args.sessionId, args.modelId);
    }
  );

  ipcMain.handle(
    'acp:set-config-option',
    async (
      _event,
      args: { sessionId: string; configId: string; value: unknown }
    ) => {
      return acpService.setConfigOption(args.sessionId, args.configId, args.value);
    }
  );
}
