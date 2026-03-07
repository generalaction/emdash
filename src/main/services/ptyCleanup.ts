/**
 * ptyCleanup.ts — owns the PTY owner/listener registry and exposes cleanup helpers.
 *
 * Both ptyIpc.ts and dbIpc.ts import from this module to avoid a circular dependency
 * (dbIpc → ptyIpc → dbIpc).
 *
 * ptyManager.ts is a pure spawner with no DB access. All cleanup logic lives here.
 */
import type { WebContents } from 'electron';
import { killPty } from './ptyManager';
import { makePtyId } from '@shared/ptyId';
import { databaseService } from './DatabaseService';
import { terminalSnapshotService } from './TerminalSnapshotService';
import { events } from '../_new/events';
import { ptyKilledChannel } from '@shared/events/appEvents';
import { log } from '../_new/lib/logger';

/** Maps PTY ID → owning renderer WebContents */
export const owners = new Map<string, WebContents>();

/** PTY IDs for which data/exit listeners have been attached */
export const listeners = new Set<string>();

/**
 * Kill a PTY and remove it from the owner/listener registries.
 * Emits ptyKilledChannel so renderer sessions can dispose themselves.
 */
export function killRegisteredPty(id: string): void {
  try {
    killPty(id);
  } catch {
    // PTY may already be gone
  }
  owners.delete(id);
  listeners.delete(id);
  try {
    events.emit(ptyKilledChannel, { id });
  } catch (err) {
    log.warn('ptyCleanup: failed to emit ptyKilledChannel', { id, error: String(err) });
  }
}

/**
 * Kill all PTYs belonging to a task's conversations and delete their snapshots.
 * Called from dbIpc deleteTask / archiveTask before the DB mutation.
 *
 * @deprecated Use taskResourceManager.teardown(taskId) instead, which handles
 * both this legacy cleanup and the new PtySessionManager sessions.
 */
export async function cleanupTaskPtys(taskId: string): Promise<void> {
  try {
    const conversations = await databaseService.getConversations(taskId);
    for (const conv of conversations) {
      const provider = conv.provider;
      if (provider) {
        const ptyId = makePtyId(provider as any, conv.id);
        killRegisteredPty(ptyId);
        // Delete per-conversation snapshot
        try {
          await terminalSnapshotService.deleteSnapshot(ptyId);
        } catch {}
      }
    }
  } catch (err) {
    log.warn('ptyCleanup: failed to kill task PTYs', { taskId, error: String(err) });
  }
}

/**
 * Kill the PTY for a single conversation.
 * Called from dbIpc deleteConversation before the DB mutation.
 */
export function cleanupConversationPty(conversationId: string, provider: string): void {
  killRegisteredPty(makePtyId(provider as any, conversationId));
}
