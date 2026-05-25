import { events } from '@main/lib/events';
import type { IDisposable } from '@main/lib/lifecycle';
import { ptyExitChannel } from '@shared/events/ptyEvents';
import { makePtySessionId } from '@shared/ptySessionId';
import { createLifecycleScriptTerminalId } from '@shared/terminals';
import type { Pty } from '../pty/pty';
import { ptySessionRegistry } from '../pty/pty-session-registry';
import { formatLifecycleScriptInput } from '../terminals/format-lifecycle-script-input';
import type { TerminalProvider } from '../terminals/terminal-provider';

type LifecycleScriptShellKind = 'cmd' | 'posix';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

type LifecycleScript = {
  type: 'setup' | 'run' | 'teardown';
  script: string;
  shellSetup?: string;
};

type LifecycleRespawnRequest = {
  script: LifecycleScript;
  initialSize: { cols: number; rows: number };
};

export class LifecycleScriptService implements IDisposable {
  private readonly projectId: string;
  private readonly workspaceId: string;
  private readonly terminals: TerminalProvider;
  private readonly shellKind: LifecycleScriptShellKind;
  private readonly sessionsWithRespawnHandler = new Set<string>();
  private readonly latestRespawnRequest = new Map<string, LifecycleRespawnRequest>();
  private disposed = false;

  constructor({
    projectId,
    workspaceId,
    terminals,
    shellKind = process.platform === 'win32' ? 'cmd' : 'posix',
  }: {
    projectId: string;
    workspaceId: string;
    terminals: TerminalProvider;
    shellKind?: LifecycleScriptShellKind;
  }) {
    this.projectId = projectId;
    this.workspaceId = workspaceId;
    this.terminals = terminals;
    this.shellKind = shellKind;
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
    const { terminalId } = this.resolveIds(script);

    await this.terminals.spawnLifecycleScript({
      terminal: {
        id: terminalId,
        projectId: this.projectId,
        taskId: this.workspaceId,
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
      initialSize?: { cols: number; rows: number };
    } = {}
  ): Promise<void> {
    const {
      waitForExit = false,
      exit = false,
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

    if (exit && !waitForExit) {
      this.ensureRespawnAfterExit({ sessionId, pty, script, initialSize });
    }

    const exitPromise = waitForExit
      ? new Promise<void>((resolve) => {
          events.once(ptyExitChannel, () => resolve(), sessionId);
        })
      : null;

    const command = formatLifecycleScriptInput(script.script, { exit, shellKind: this.shellKind });
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
    this.sessionsWithRespawnHandler.clear();
    this.latestRespawnRequest.clear();
    await this.terminals.destroyAll();
  }
}
