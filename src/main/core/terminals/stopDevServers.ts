import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { hostPreviewEventChannel } from '@shared/events/hostPreviewEvents';
import { makePtySessionId } from '@shared/ptySessionId';
import { createLifecycleScriptTerminalId } from '@shared/terminals';
import { clearTerminalDevServer } from './dev-server-watcher';
import { stopLifecycleScriptSession } from './lifecycle-script-coordinator';

type DevServerRef = {
  projectId?: string;
  scopeId: string;
  terminalId: string;
};

const CTRL_C = '\x03';

function emitDevServerExit(projectId: string, scopeId: string, terminalId: string): void {
  if (clearTerminalDevServer(scopeId, terminalId)) return;
  events.emit(hostPreviewEventChannel, {
    type: 'exit',
    projectId,
    taskId: scopeId,
    terminalId,
  });
}

function stopRegisteredPty(projectId: string, scopeId: string, terminalId: string): void {
  const sessionId = makePtySessionId(projectId, scopeId, terminalId);
  const pty = ptySessionRegistry.get(sessionId);
  if (!pty) return;

  try {
    pty.kill();
  } catch (error) {
    log.warn('stopDevServers: failed to kill PTY', { sessionId, error: String(error) });
  }
  ptySessionRegistry.unregister(sessionId);
}

function interruptRegisteredPty(projectId: string, scopeId: string, terminalId: string): void {
  const sessionId = makePtySessionId(projectId, scopeId, terminalId);
  const pty = ptySessionRegistry.get(sessionId);
  if (!pty) return;

  try {
    pty.write(CTRL_C);
  } catch (error) {
    log.warn('stopDevServers: failed to interrupt PTY', { sessionId, error: String(error) });
  }
}

async function stopDevServer({
  projectId,
  taskId,
  workspaceId,
  server,
}: {
  projectId: string;
  taskId: string;
  workspaceId: string;
  server: DevServerRef;
}): Promise<void> {
  const serverProjectId = server.projectId ?? projectId;
  const runScriptTerminalId = createLifecycleScriptTerminalId('run');

  if (server.terminalId === runScriptTerminalId) {
    if (serverProjectId === projectId && server.scopeId === workspaceId) {
      const stopped = stopLifecycleScriptSession({
        projectId,
        taskId,
        workspaceId,
        type: 'run',
        origin: 'manual',
      });
      if (stopped) {
        emitDevServerExit(serverProjectId, server.scopeId, server.terminalId);
        return;
      }
    }

    stopRegisteredPty(serverProjectId, server.scopeId, server.terminalId);
  } else {
    interruptRegisteredPty(serverProjectId, server.scopeId, server.terminalId);
  }

  // Optimistically hide the pill after sending the stop signal. If a process ignores Ctrl+C,
  // the existing port probe has already been torn down and fresh detection requires new output.
  emitDevServerExit(serverProjectId, server.scopeId, server.terminalId);
}

export async function stopDevServers({
  projectId,
  taskId,
  workspaceId,
  servers,
}: {
  projectId: string;
  taskId: string;
  workspaceId: string;
  servers: DevServerRef[];
}): Promise<void> {
  await Promise.all(
    servers.map((server) =>
      stopDevServer({ projectId, taskId, workspaceId, server }).catch((error) => {
        log.warn('stopDevServers: failed to stop dev server', {
          projectId,
          taskId,
          workspaceId,
          scopeId: server.scopeId,
          terminalId: server.terminalId,
          error: String(error),
        });
      })
    )
  );
}
