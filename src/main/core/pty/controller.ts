import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { createRPCController } from '@shared/ipc/rpc';
import { err, ok } from '@shared/result';
import { log } from '@main/lib/logger';
import { projectManager } from '../projects/project-manager';
import { workspaceRegistry } from '../workspaces/workspace-registry';
import { ptySessionRegistry } from './pty-session-registry';

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
      const [projectId, scopeId] = args.sessionId.split(':');
      if (!projectId || !scopeId) return err({ type: 'invalid_session' as const });

      const provider = projectManager.getProject(projectId);
      if (!provider) return err({ type: 'not_ssh' as const });

      const taskProvider = provider.tasks.getTask(scopeId);
      if (!taskProvider) return err({ type: 'not_ssh' as const });

      const workspace = workspaceRegistry.get(taskProvider.workspaceId);
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
});
