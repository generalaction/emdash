import { createRPCController } from '../../../shared/ipc/rpc';
import { ok, err } from '../../lib/result';
import { ptyManager } from '../pty/pty-manager';
import { ptySessionManager } from '../pty/session/core';

export const ptyController = createRPCController({
  /** Send raw input data to a PTY session. */
  sendInput: (sessionId: string, data: string) => {
    const pty = ptyManager.getPty(sessionId);
    if (!pty) return err({ type: 'not_found' as const });
    pty.write(data);
    return ok();
  },

  /** Resize a PTY session to the given terminal dimensions. */
  resize: (sessionId: string, cols: number, rows: number) => {
    const pty = ptyManager.getPty(sessionId);
    if (!pty) return err({ type: 'not_found' as const });
    pty.resize(cols, rows);
    return ok();
  },

  /** Kill a PTY session and remove it from the session manager. */
  kill: (sessionId: string) => {
    ptySessionManager.destroySession(sessionId);
    return ok();
  },

  /** List all active PTY sessions for a task. */
  getSessions: (taskId: string) => {
    const sessions = ptySessionManager.getSessionsForTask(taskId);
    return ok(
      sessions.map((s) => ({
        id: s.id,
        type: s.type,
        transport: s.transport,
      }))
    );
  },
});
