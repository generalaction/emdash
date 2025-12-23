/**
 * IPC handlers for custom slash commands
 */

import { ipcMain } from 'electron';
import path from 'path';
import { log } from '../lib/logger';
import { scanCustomCommands } from '../../shared/providers/customCommands';
import { isValidProviderId, PROVIDER_IDS } from '../../shared/providers/registry';
import type { ProviderId } from '../../shared/providers/registry';

/**
 * Validates custom command scan arguments.
 * Returns validated args or throws an error.
 */
function validateScanArgs(args: unknown): { projectPath: string; providerId: ProviderId } {
  // Check if args exists and is an object
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw new Error('Invalid arguments: must be an object');
  }

  const { projectPath, providerId } = args as Record<string, unknown>;

  // Validate projectPath
  if (typeof projectPath !== 'string' || projectPath.trim() === '') {
    throw new Error('Invalid projectPath: must be a non-empty string');
  }

  if (!path.isAbsolute(projectPath)) {
    throw new Error('Invalid projectPath: must be an absolute path');
  }

  // Validate providerId
  if (typeof providerId !== 'string' || providerId.trim() === '') {
    throw new Error('Invalid providerId: must be a non-empty string');
  }

  if (!isValidProviderId(providerId)) {
    throw new Error(
      `Unknown providerId: "${providerId}". Allowed providers: ${PROVIDER_IDS.join(', ')}`
    );
  }

  return { projectPath, providerId: providerId as ProviderId };
}

export function registerCustomCommandsHandlers(): void {
  ipcMain.handle('custom-commands:scan', async (_event, args: unknown) => {
    try {
      const { projectPath, providerId } = validateScanArgs(args);
      log.debug('acp:custom-commands:ipc:scan:request', { projectPath, providerId });
      const commands = await scanCustomCommands(projectPath, providerId, log);
      log.debug('acp:custom-commands:ipc:scan:complete', { count: commands.length, providerId });
      return { success: true, commands };
    } catch (error: unknown) {
      const errorMessage =
        error && typeof error === 'object' && 'message' in error
          ? String(error.message)
          : String(error);
      log.error('acp:custom-commands:ipc:scan:failed', {
        error: errorMessage,
      });
      return { success: false, error: errorMessage || 'Failed to scan custom commands' };
    }
  });
}
