import { ptyExitChannel } from '@shared/events/ptyEvents';
import { makePtySessionId } from '@shared/ptySessionId';
import { createScriptTerminalId } from '@shared/terminals';
import { events } from '@main/lib/events';
import type { IDisposable } from '@main/lib/lifecycle';
import { ptySessionRegistry } from '../pty/pty-session-registry';
import type { TerminalProvider } from '../terminals/terminal-provider';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

type LifecycleScript = {
  type: 'setup' | 'run' | 'teardown';
  script: string;
};

export class LifecycleScriptService implements IDisposable {
  private readonly projectId: string;
  private readonly workspaceId: string;
  private readonly terminals: TerminalProvider;
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

  private async resolveIds(script: LifecycleScript): Promise<{
    terminalId: string;
    sessionId: string;
  }> {
    const terminalId = await createScriptTerminalId({
      projectId: this.projectId,
      scopeId: this.workspaceId,
      type: script.type,
      script: script.script,
    });
    const sessionId = makePtySessionId(this.projectId, this.workspaceId, terminalId);
    return { terminalId, sessionId };
  }

  async prepareLifecycleScript(
    script: LifecycleScript,
    options: { initialSize?: { cols: number; rows: number } } = {}
  ): Promise<void> {
    const { initialSize = { cols: DEFAULT_COLS, rows: DEFAULT_ROWS } } = options;
    const { terminalId } = await this.resolveIds(script);

    await this.terminals.spawnLifecycleScript({
      terminal: {
        id: terminalId,
        projectId: this.projectId,
        taskId: this.workspaceId,
        name: script.type,
      },
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
      initialSize?: { cols: number; rows: number };
    } = {}
  ): Promise<void> {
    const {
      waitForExit = false,
      exit = false,
      initialSize = { cols: DEFAULT_COLS, rows: DEFAULT_ROWS },
    } = options;

    const { sessionId } = await this.resolveIds(script);

    if (!ptySessionRegistry.get(sessionId)) {
      await this.prepareLifecycleScript(script, { initialSize });
    }

    const pty = ptySessionRegistry.get(sessionId);
    if (!pty) {
      throw new Error(
        `Lifecycle script session unavailable for ${script.type} in workspace ${this.workspaceId}`
      );
    }

    if (exit && !waitForExit) {
      pty.onExit(() => {
        if (this.disposed) return;
        void this.prepareLifecycleScript(script, { initialSize });
      });
    }

    const exitPromise = waitForExit
      ? new Promise<void>((resolve) => {
          events.once(ptyExitChannel, () => resolve(), sessionId);
        })
      : null;

    const command = exit ? `${script.script}; exit` : script.script;
    pty.write(`${command}\n`);

    if (exitPromise) {
      await exitPromise;
    }
  }

  async prepareAndRunLifecycleScript(
    script: LifecycleScript,
    options: {
      waitForExit?: boolean;
      exit?: boolean;
      initialSize?: { cols: number; rows: number };
    } = {}
  ): Promise<void> {
    const { initialSize = { cols: DEFAULT_COLS, rows: DEFAULT_ROWS }, ...executeOptions } = options;
    await this.prepareLifecycleScript(script, { initialSize });
    await this.runLifecycleScript(script, { initialSize, ...executeOptions });
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await this.terminals.destroyAll();
  }
}
