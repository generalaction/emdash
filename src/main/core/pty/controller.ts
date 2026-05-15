import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { app } from 'electron';
import { createRPCController } from '@shared/ipc/rpc';
import { parsePtySessionId } from '@shared/ptySessionId';
import { err, ok } from '@shared/result';
import { log } from '@main/lib/logger';
import { taskManager } from '../tasks/task-manager';
import { workspaceRegistry } from '../workspaces/workspace-registry';
import { ptySessionRegistry } from './pty-session-registry';

const MAX_DROPPED_BLOB_BYTES = 50 * 1024 * 1024;

const MIME_TO_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/bmp': '.bmp',
  'image/tiff': '.tiff',
  'image/heic': '.heic',
};

function sanitizeName(name: string | undefined): string {
  if (!name) return '';
  const base = basename(name).replace(/[^A-Za-z0-9._-]/g, '_');
  return base.slice(0, 64);
}

function inferExtension(name: string | undefined, mimeType: string | undefined): string {
  const fromName = name ? extname(name).toLowerCase() : '';
  if (fromName) return fromName;
  if (mimeType && MIME_TO_EXT[mimeType.toLowerCase()]) return MIME_TO_EXT[mimeType.toLowerCase()];
  return '.bin';
}

export const ptyController = createRPCController({
  /** Send raw input data to a PTY session. */
  sendInput: (sessionId: string, data: string) => {
    const pty = ptySessionRegistry.get(sessionId);
    if (!pty) return err({ type: 'not_found' as const });
    pty.write(data);
    return ok();
  },

  /** Resize a PTY session to the given terminal dimensions. */
  resize: (sessionId: string, cols: number, rows: number) => {
    const pty = ptySessionRegistry.get(sessionId);
    if (!pty) return err({ type: 'not_found' as const });
    pty.resize(cols, rows);
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

      const taskProvider = taskManager.getTask(scopeId);
      if (!taskProvider) return err({ type: 'not_ssh' as const });

      const workspaceId = taskManager.getWorkspaceId(scopeId) ?? '';
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
   * Persist a dropped in-memory blob (browser/Slack drag, screenshot paste, etc.)
   * to a stable file in the OS temp directory and return its absolute path.
   *
   * Renderer falls back to this when `webUtils.getPathForFile()` returns a
   * Chromium drag-temp path that vanishes before Claude/Codex/etc. can read it.
   */
  persistDroppedBlob: async (args: { bytes: Uint8Array; name?: string; mimeType?: string }) => {
    try {
      if (args.bytes.byteLength > MAX_DROPPED_BLOB_BYTES) {
        return err({
          type: 'persist_failed' as const,
          message: `Dropped file is too large (${args.bytes.byteLength} bytes)`,
        });
      }

      const ext = inferExtension(args.name, args.mimeType);
      const safe = sanitizeName(args.name?.replace(/\.[^.]+$/, ''));
      const filename = `emdash-drop-${randomUUID()}${safe ? `-${safe}` : ''}${ext}`;
      const dir = app.getPath('temp');
      const fullPath = join(dir, filename);
      await writeFile(fullPath, args.bytes);
      return ok({ path: fullPath });
    } catch (e: unknown) {
      log.error('pty:persistDroppedBlob failed', {
        error: (e as Error)?.message || e,
      });
      return err({ type: 'persist_failed' as const, message: String((e as Error)?.message || e) });
    }
  },
});
