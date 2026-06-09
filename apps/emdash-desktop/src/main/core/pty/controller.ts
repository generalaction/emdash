import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { conversationEvents } from '@main/core/conversations/conversation-events';
import { log } from '@main/lib/logger';
import { parsePtySessionId } from '@shared/core/pty/ptySessionId';
import { createRPCController } from '@shared/lib/ipc/rpc';
import { err, ok } from '@shared/lib/result';
import { taskSessionManager } from '../tasks/task-session-manager';
import { workspaceRegistry } from '../workspaces/workspace-registry';
import {
  cleanupExpiredDroppedBlobs,
  persistClipboardImagePath,
  persistDroppedBlobBytes,
} from './persist-dropped-blob';
import { ptySessionRegistry } from './pty-session-registry';

void cleanupExpiredDroppedBlobs().catch((error) => {
  log.warn('pty:cleanupExpiredDroppedBlobs failed', { error });
});

export const ptyController = createRPCController({
  /** Send raw input data to a PTY session. */
  sendInput: (sessionId: string, data: string) => {
    const pty = ptySessionRegistry.get(sessionId);
    if (!pty) return err({ type: 'not_found' as const });
    pty.write(data);
    if (data.includes('\r')) {
      const meta = ptySessionRegistry.getMetadata(sessionId);
      if (meta?.providerId && !meta.isRemote) {
        const parsed = parsePtySessionId(sessionId);
        if (parsed) {
          conversationEvents._emit('conversation:input-submitted', {
            projectId: parsed.projectId,
            taskId: parsed.scopeId,
            conversationId: parsed.leafId,
            providerId: meta.providerId,
          });
        }
      }
    }
    return ok();
  },

  /** Resize a PTY session to the given terminal dimensions. */
  resize: (sessionId: string, cols: number, rows: number) => {
    const resized = ptySessionRegistry.resize(sessionId, cols, rows);
    if (!resized) return err({ type: 'not_found' as const });
    return ok();
  },

  /**
   * Atomically return the ring buffer and register the renderer as a consumer
   * for future IPC delivery. Non-destructive — the ring buffer is kept intact.
   * Called once by the renderer when connecting a FrontendPty to a session.
   */
  subscribe: (sessionId: string) => {
    return ok({ buffer: ptySessionRegistry.subscribe(sessionId) });
  },

  /**
   * Remove the renderer's consumer registration for a session.
   * Called when the renderer disposes its FrontendPty.
   */
  unsubscribe: (sessionId: string) => {
    ptySessionRegistry.unsubscribe(sessionId);
    return ok();
  },

  /** Kill a PTY session and clean it up immediately. */
  kill: (sessionId: string) => {
    const pty = ptySessionRegistry.get(sessionId);
    if (pty) {
      try {
        pty.kill();
      } catch (e) {
        log.warn('ptyController.kill: error killing PTY', { sessionId, error: String(e) });
      }
    }
    ptySessionRegistry.unregister(sessionId);
    return ok();
  },

  /**
   * Stop a session for good without deleting its conversation/terminal record.
   *
   * Unlike `kill`, which only terminates the OS process, this routes through
   * the owning provider so the session is removed from its respawn tracking
   * (`knownSessionIds`/`sessions`). A bare `kill` leaves those intact, so the
   * provider's `onExit` handler respawns the PTY ~500ms later — which is what
   * made killing from the resource monitor appear to do nothing. The tab and
   * its history are preserved; the session simply stays stopped until the task
   * is remounted or the user starts a new one.
   */
  stopSession: async (sessionId: string) => {
    const parsed = parsePtySessionId(sessionId);
    if (!parsed) return err({ type: 'invalid_session' as const });
    const { scopeId, leafId } = parsed;

    // Agents and terminals are scoped by task id, so the task lookup resolves
    // the owning provider. Conversation PTYs carry a providerId in their
    // registry metadata; plain terminals do not — that distinguishes the two.
    const task = taskSessionManager.getTask(scopeId);
    if (task) {
      const isConversation = ptySessionRegistry.getMetadata(sessionId)?.providerId !== undefined;
      try {
        if (isConversation) {
          await task.conversations.stopSession(leafId);
        } else {
          await task.terminals.killTerminal(leafId);
        }
      } catch (e) {
        log.warn('ptyController.stopSession: error stopping task PTY', {
          sessionId,
          error: String(e),
        });
        return err({ type: 'stop_failed' as const, message: String((e as Error)?.message || e) });
      }
      return ok();
    }

    // Lifecycle scripts are scoped by workspace id (no task match) and never
    // respawn, so a raw kill is sufficient and safe.
    const pty = ptySessionRegistry.get(sessionId);
    if (pty) {
      try {
        pty.kill();
      } catch (e) {
        log.warn('ptyController.stopSession: error killing PTY', { sessionId, error: String(e) });
      }
    }
    ptySessionRegistry.unregister(sessionId);
    return ok();
  },

  /**
   * Upload local files into the task's working directory on a remote SSH host
   * and return their remote paths.  Uses the SFTP subsystem of the already-
   * connected ssh2 client — no local ssh/scp binaries are involved.
   *
   * The session ID encodes the project and scope (`projectId:scopeId:leafId`),
   * where `scopeId` is a task ID for conversation uploads.
   */
  uploadFiles: async (args: { sessionId: string; localPaths: string[] }) => {
    try {
      const parsed = parsePtySessionId(args.sessionId);
      if (!parsed) {
        return err({ type: 'invalid_session' as const });
      }
      const { scopeId } = parsed;

      const taskProvider = taskSessionManager.getTask(scopeId);
      if (!taskProvider) return err({ type: 'not_ssh' as const });

      const workspaceId = taskSessionManager.getWorkspaceId(scopeId) ?? '';
      const workspace = workspaceRegistry.get(workspaceId);
      if (!workspace?.fs.copyLocalFile) return err({ type: 'not_ssh' as const });

      const remotePaths = await Promise.all(
        args.localPaths.map(async (localPath) => {
          const remoteName = `${randomUUID()}-${basename(localPath)}`;
          await workspace.fs.copyLocalFile!(localPath, remoteName);
          return `${workspace.path}/${remoteName}`;
        })
      );
      return ok({ remotePaths });
    } catch (e: unknown) {
      log.error('pty:uploadFiles failed', {
        sessionId: args.sessionId,
        error: (e as Error)?.message || e,
      });
      return err({ type: 'upload_failed' as const, message: String((e as Error)?.message || e) });
    }
  },

  /**
   * Persist a dropped or pasted in-memory image to a stable temp file.
   * HEIC/HEIF bytes are converted to PNG so Claude Code can inline them.
   */
  persistDroppedBlob: async (args: { bytes: Uint8Array; name?: string; mimeType?: string }) => {
    try {
      const path = await persistDroppedBlobBytes(args);
      return ok({ path });
    } catch (e: unknown) {
      log.error('pty:persistDroppedBlob failed', {
        error: (e as Error)?.message || e,
      });
      return err({ type: 'persist_failed' as const, message: String((e as Error)?.message || e) });
    }
  },

  /** Persist the OS clipboard image (macOS HEIC paste, screenshots, etc.). */
  persistClipboardImage: async () => {
    try {
      const path = await persistClipboardImagePath();
      return ok({ path });
    } catch (e: unknown) {
      log.error('pty:persistClipboardImage failed', {
        error: (e as Error)?.message || e,
      });
      return err({ type: 'persist_failed' as const, message: String((e as Error)?.message || e) });
    }
  },
});
