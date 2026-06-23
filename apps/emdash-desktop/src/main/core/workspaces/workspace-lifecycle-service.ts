import type { IDisposable } from '@emdash/shared';
import { makePtySessionId } from '@shared/core/pty/ptySessionId';
import { createLifecycleScriptTerminalId } from '@shared/core/terminals/terminals';
import type { Pty, PtyExitInfo } from '../pty/pty';
import { ptySessionRegistry } from '../pty/pty-session-registry';
import type { TerminalProvider } from '../terminals/terminal-provider';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const OUTPUT_TAIL_CAP = 16 * 1024;

type LifecycleScript = {
  type: 'setup' | 'run' | 'teardown';
  script: string;
  shellSetup?: string;
};

type LifecycleRespawnRequest = {
  script: LifecycleScript;
  initialSize: { cols: number; rows: number };
};

export type LifecycleScriptExecutionResult =
  | { kind: 'started' }
  | { kind: 'already-running' }
  | {
      kind: 'exited';
      exitCode?: number;
      signal?: string | number;
      outputTail: string;
    };

function stripTerminalControls(value: string): string {
  return value
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\x1b\][^\x1b]*\x1b\\/g, '')
    .replace(/\r/g, '');
}

function appendOutputTail(current: string, chunk: string): string {
  const next = current + stripTerminalControls(chunk);
  return next.length > OUTPUT_TAIL_CAP ? next.slice(-OUTPUT_TAIL_CAP) : next;
}

export class LifecycleScriptService implements IDisposable {
  private readonly projectId: string;
  private readonly workspaceId: string;
  private readonly terminals: TerminalProvider;
  private readonly sessionsWithRespawnHandler = new Set<string>();
  private readonly sessionsWaitingForExit = new Set<string>();
  private readonly latestRespawnRequest = new Map<string, LifecycleRespawnRequest>();
  private disposed = false;

  constructor({
    projectId,
    workspaceId,
    terminals,
  }: {
    projectId: string;
    workspaceId: string;
    terminals: TerminalProvider;
  }) {
    this.projectId = projectId;
    this.workspaceId = workspaceId;
    this.terminals = terminals;
  }

  private respawnAfterExit(sessionId: string): void {
    const respawnRequest = this.latestRespawnRequest.get(sessionId);
    this.latestRespawnRequest.delete(sessionId);
    this.sessionsWithRespawnHandler.delete(sessionId);
    if (this.disposed || !respawnRequest) return;
    void this.prepareLifecycleScript(respawnRequest.script, {
      initialSize: respawnRequest.initialSize,
    });
  }

  private ensureRespawnAfterExit({
    sessionId,
    pty,
    script,
    initialSize,
  }: {
    sessionId: string;
    pty: Pty;
    script: LifecycleScript;
    initialSize: { cols: number; rows: number };
  }): void {
    // Restores the user-facing prompt after manual script completion/stop. Later reruns
    // already work because the PTY registry drops exited sessions.
    this.latestRespawnRequest.set(sessionId, { script, initialSize });
    if (this.sessionsWithRespawnHandler.has(sessionId)) return;

    this.sessionsWithRespawnHandler.add(sessionId);
    pty.onExit(() => this.respawnAfterExit(sessionId));
  }

  private resolveIds(script: Pick<LifecycleScript, 'type'>): {
    terminalId: string;
    sessionId: string;
  } {
    const terminalId = createLifecycleScriptTerminalId(script.type);
    const sessionId = makePtySessionId(this.projectId, this.workspaceId, terminalId);
    return { terminalId, sessionId };
  }

  async prepareLifecycleScript(
    script: LifecycleScript,
    options: { initialSize?: { cols: number; rows: number } } = {}
  ): Promise<void> {
    const { initialSize = { cols: DEFAULT_COLS, rows: DEFAULT_ROWS } } = options;
    const { terminalId, sessionId } = this.resolveIds(script);
    if (ptySessionRegistry.get(sessionId)) return;

    await this.terminals.spawnLifecycleScript({
      terminal: {
        id: terminalId,
        projectId: this.projectId,
        taskId: this.workspaceId,
        shellId: 'system',
        name: script.type,
      },
      shellSetup: script.shellSetup,
      initialSize,
      respawnOnExit: false,
      preserveBufferOnExit: true,
      watchDevServer: script.type === 'run',
    });
  }

  async runLifecycleScript(
    script: LifecycleScript,
    options: {
      waitForExit?: boolean;
      exit?: boolean;
      respawnAfterExit?: boolean;
      initialSize?: { cols: number; rows: number };
    } = {}
  ): Promise<LifecycleScriptExecutionResult> {
    const {
      waitForExit = false,
      exit = false,
      respawnAfterExit = false,
      initialSize = { cols: DEFAULT_COLS, rows: DEFAULT_ROWS },
    } = options;

    const { sessionId } = this.resolveIds(script);

    if (!ptySessionRegistry.get(sessionId)) {
      await this.prepareLifecycleScript(script, { initialSize });
    }

    const pty = ptySessionRegistry.get(sessionId);
    if (!pty) {
      throw new Error(
        `Lifecycle script session unavailable for ${script.type} in workspace ${this.workspaceId}`
      );
    }

    if (waitForExit) {
      if (this.sessionsWaitingForExit.has(sessionId)) {
        return { kind: 'already-running' };
      }
      this.sessionsWaitingForExit.add(sessionId);
    }

    if (exit && (respawnAfterExit || !waitForExit)) {
      this.ensureRespawnAfterExit({ sessionId, pty, script, initialSize });
    }

    try {
      let outputTail = '';
      const exitPromise = waitForExit
        ? new Promise<PtyExitInfo>((resolve) => {
            pty.onData((data) => {
              outputTail = appendOutputTail(outputTail, data);
            });
            pty.onExit((info) => resolve(info));
          })
        : null;

      const command = exit ? `${script.script}; exit` : script.script;
      pty.write(`${command}\n`);

      if (!exitPromise) {
        return { kind: 'started' };
      }

      const exitInfo = await exitPromise;
      return {
        kind: 'exited',
        exitCode: exitInfo.exitCode,
        signal: exitInfo.signal,
        outputTail,
      };
    } finally {
      if (waitForExit) {
        this.sessionsWaitingForExit.delete(sessionId);
      }
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.sessionsWithRespawnHandler.clear();
    this.sessionsWaitingForExit.clear();
    this.latestRespawnRequest.clear();
    await this.terminals.destroyAll();
  }
}
