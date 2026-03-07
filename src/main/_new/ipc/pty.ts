import { createRPCController } from '../../../shared/ipc/rpc';
import { ok, err } from '../../_deprecated/lib/result';
import { ptySessionRegistry } from '../pty/pty-session-registry';
import { log } from '../lib/logger';
import { environmentProviderManager } from '../environment/provider-manager';
import { SshEnvironmentProvider } from '../environment/impl/ssh-env-provider';

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
   * The session ID encodes the project and task (`projectId:taskId:leafId`),
   * so no extra arguments are needed to locate the destination.
   */
  uploadFiles: async (args: { sessionId: string; localPaths: string[] }) => {
    try {
      const [projectId, taskId] = args.sessionId.split(':');
      if (!projectId || !taskId) {
        return err({ type: 'invalid_session' as const });
      }

      const provider = environmentProviderManager.getProvider(projectId);
      if (!provider || !(provider instanceof SshEnvironmentProvider)) {
        return err({ type: 'not_ssh' as const });
      }

      const remotePaths = await provider.uploadFiles(taskId, args.localPaths);
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
