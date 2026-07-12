import { err, ok, type IDisposable, type Result } from '@emdash/shared';
import { makePtySessionId } from '@shared/core/pty/ptySessionId';
import { createLifecycleScriptTerminalId } from '@shared/core/terminals/terminals';
import type { Pty, PtyExitInfo } from '../pty/pty';
import { ptySessionRegistry } from '../pty/pty-session-registry';
import type { TerminalProvider } from '../terminals/terminal-provider';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const OUTPUT_TAIL_CAP = 16 * 1024;
const DEFAULT_SETUP_TIMEOUT_MS = 15 * 60_000;
const STARTUP_CLEANUP_TIMEOUT_MS = 5_000;

export type LifecycleScript = {
  type: 'setup' | 'run' | 'teardown';
  script: string;
  shellSetup?: string;
};

export type LifecyclePreviewStartupError = {
  type: 'preview-timeout' | 'preview-failed' | 'preview-ambiguous';
  stage: 'preview';
  message: string;
};

export type LifecycleStartupError =
  | { type: 'setup-failed'; stage: 'setup'; message: string }
  | { type: 'setup-timeout'; stage: 'setup'; message: string }
  | { type: 'run-start-failed'; stage: 'run'; message: string }
  | { type: 'run-exited'; stage: 'run'; message: string }
  | { type: 'cancelled'; stage: 'setup' | 'run' | 'preview'; message: string }
  | LifecyclePreviewStartupError;

export type LifecycleStartupReady = {
  setup: 'not-configured' | 'succeeded';
  run: 'not-configured' | 'running';
  preview: 'not-required' | 'ready';
};

export type LifecycleStartupReceipt = {
  ready: Promise<Result<LifecycleStartupReady, LifecycleStartupError>>;
  cancel(reason?: unknown): void;
};

export type RequiredLifecycleStartup = {
  setup?: LifecycleScript;
  run?: LifecycleScript;
  signal?: AbortSignal;
  deadlineAt?: number;
  setupTimeoutMs?: number;
  runStartupGraceMs?: number;
  waitForPreview?: (input: {
    signal: AbortSignal;
  }) => Promise<Result<void, LifecyclePreviewStartupError>>;
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

function terminalInputForScript(script: string, exit: boolean, windowsCmdExit: boolean): string {
  const normalizedScript = script.replace(/\r?\n/g, '\r');
  if (!exit) return `${normalizedScript}\r`;
  const scriptBeforeExit = normalizedScript.replace(/\r+$/, '');
  return windowsCmdExit ? `${scriptBeforeExit}\rexit\r` : `${scriptBeforeExit}; exit\r`;
}

export class LifecycleScriptService implements IDisposable {
  private readonly projectId: string;
  private readonly workspaceId: string;
  private readonly terminals: TerminalProvider;
  private readonly sessionsWithRespawnHandler = new Set<string>();
  private readonly sessionsWaitingForExit = new Set<string>();
  private readonly latestRespawnRequest = new Map<string, LifecycleRespawnRequest>();
  private disposed = false;
  private requiredStartupReceipt: LifecycleStartupReceipt | undefined;
  private readonly requiredStartupLifetime = new AbortController();
  private disposeOperation: Promise<void> | undefined;

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

  private async shouldUseWindowsCommandExit(terminalId: string): Promise<boolean> {
    if (this.terminals.kind !== 'local' || process.platform !== 'win32') return false;
    const shellFamily = await this.terminals.getLifecycleScriptShellFamily?.(terminalId);
    return shellFamily === 'windows-cmd' || shellFamily === 'powershell';
  }

  async prepareLifecycleScript(
    script: LifecycleScript,
    options: { initialSize?: { cols: number; rows: number } } = {}
  ): Promise<Pty | null> {
    const { initialSize = { cols: DEFAULT_COLS, rows: DEFAULT_ROWS } } = options;
    const { terminalId, sessionId } = this.resolveIds(script);
    const existingPty = ptySessionRegistry.get(sessionId);
    if (existingPty) return existingPty;

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

    return ptySessionRegistry.get(sessionId) ?? null;
  }

  startRequiredStartup(input: RequiredLifecycleStartup): LifecycleStartupReceipt {
    if (this.requiredStartupReceipt) return this.requiredStartupReceipt;

    const external = createStartupExternalControl(input.signal, input.deadlineAt);
    const signal = AbortSignal.any([external.signal, this.requiredStartupLifetime.signal]);
    const ready = this.runRequiredStartup(input, signal);
    void ready.then(external.detach, external.detach);
    const receipt: LifecycleStartupReceipt = {
      ready,
      cancel: (reason) => {
        if (!this.requiredStartupLifetime.signal.aborted) {
          this.requiredStartupLifetime.abort(reason);
        }
      },
    };
    this.requiredStartupReceipt = receipt;
    return receipt;
  }

  waitForRequiredStartup(): Promise<Result<LifecycleStartupReady, LifecycleStartupError>> {
    return (
      this.requiredStartupReceipt?.ready ??
      Promise.resolve(
        ok({
          setup: 'not-configured',
          run: 'not-configured',
          preview: 'not-required',
        })
      )
    );
  }

  private async runRequiredStartup(
    input: RequiredLifecycleStartup,
    signal: AbortSignal
  ): Promise<Result<LifecycleStartupReady, LifecycleStartupError>> {
    let stage: LifecycleStartupError['stage'] = 'setup';
    let runHandle: Awaited<ReturnType<LifecycleScriptService['startExitBackedScript']>> | undefined;
    try {
      if (signal.aborted) return err(cancelledStartup(stage));

      if (input.setup) {
        const setupHandle = await this.startExitBackedScript(input.setup, signal);
        const setupOutcome = await Promise.race([
          setupHandle.completed.then((result) => ({ kind: 'completed' as const, result })),
          timeout(
            capLifecycleTimeout(input.setupTimeoutMs ?? DEFAULT_SETUP_TIMEOUT_MS, input.deadlineAt)
          ).then(() => ({
            kind: 'timeout' as const,
          })),
          aborted(signal).then(() => ({ kind: 'aborted' as const })),
        ]);
        if (setupOutcome.kind === 'aborted') {
          await this.stopAndDrain(setupHandle);
          return err(cancelledStartup('setup'));
        }
        if (setupOutcome.kind === 'timeout') {
          await this.stopAndDrain(setupHandle);
          return err({
            type: 'setup-timeout',
            stage: 'setup',
            message: 'Setup script did not finish before the timeout.',
          });
        }
        if (signal.aborted) return err(cancelledStartup('setup'));
        if (!successfulExit(setupOutcome.result)) {
          return err({
            type: 'setup-failed',
            stage: 'setup',
            message: 'Setup script did not complete successfully.',
          });
        }
      }

      stage = 'run';
      if (input.run) {
        runHandle = await this.startExitBackedScript(input.run, signal);
      }

      if (input.waitForPreview) {
        stage = 'preview';
        const preview = input
          .waitForPreview({ signal })
          .then((result) => ({ kind: 'preview' as const, result }))
          .catch(() => ({ kind: 'preview-threw' as const }));
        const first = await Promise.race([
          preview,
          ...(runHandle ? [runHandle.completed.then(() => ({ kind: 'run-exit' as const }))] : []),
          aborted(signal).then(() => ({ kind: 'aborted' as const })),
        ]);
        if (first.kind === 'aborted' || signal.aborted) {
          if (runHandle) await this.stopAndDrain(runHandle);
          return err(cancelledStartup('preview'));
        }
        if (first.kind === 'run-exit') {
          return err({
            type: 'run-exited',
            stage: 'run',
            message: 'Run script exited before required readiness.',
          });
        }
        if (first.kind === 'preview-threw') {
          if (runHandle) await this.stopAndDrain(runHandle);
          return err({
            type: 'preview-failed',
            stage: 'preview',
            message: 'Preview readiness failed unexpectedly.',
          });
        }
        if (!first.result.success) {
          if (runHandle) await this.stopAndDrain(runHandle);
          return first.result;
        }
      } else if (runHandle) {
        const graceMs = capLifecycleTimeout(input.runStartupGraceMs ?? 100, input.deadlineAt);
        const first = await Promise.race([
          timeout(graceMs).then(() => 'running' as const),
          runHandle.completed.then(() => 'exited' as const),
          aborted(signal).then(() => 'aborted' as const),
        ]);
        if (first === 'aborted' || signal.aborted) {
          await this.stopAndDrain(runHandle);
          return err(cancelledStartup('run'));
        }
        if (first === 'exited') {
          return err({
            type: 'run-exited',
            stage: 'run',
            message: 'Run script exited before required readiness.',
          });
        }
      }

      if (signal.aborted) {
        if (runHandle) await this.stopAndDrain(runHandle);
        return err(cancelledStartup(stage));
      }

      return ok({
        setup: input.setup ? 'succeeded' : 'not-configured',
        run: input.run ? 'running' : 'not-configured',
        preview: input.waitForPreview ? 'ready' : 'not-required',
      });
    } catch (error) {
      if (runHandle) await this.stopAndDrain(runHandle);
      if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        return err(cancelledStartup(stage));
      }
      if (stage === 'preview') {
        return err({
          type: 'preview-failed',
          stage: 'preview',
          message: 'Preview readiness failed unexpectedly.',
        });
      }
      return stage === 'setup'
        ? err({
            type: 'setup-failed',
            stage: 'setup',
            message: 'Setup script failed to start.',
          })
        : err({
            type: 'run-start-failed',
            stage: 'run',
            message: 'Run script failed to start.',
          });
    }
  }

  private async stopAndDrain(
    handle: Awaited<ReturnType<LifecycleScriptService['startExitBackedScript']>>
  ): Promise<void> {
    handle.kill();
    const drained = await Promise.race([
      handle.completed.then(() => true),
      timeout(STARTUP_CLEANUP_TIMEOUT_MS).then(() => false),
    ]);
    if (!drained) {
      await this.terminals.destroyAll();
    }
  }

  private async startExitBackedScript(
    script: LifecycleScript,
    signal: AbortSignal
  ): Promise<{
    completed: Promise<LifecycleScriptExecutionResult>;
    kill(): void;
  }> {
    if (signal.aborted) throw abortError(signal);
    const { sessionId } = this.resolveIds(script);
    if (!ptySessionRegistry.get(sessionId)) {
      const preparation = this.prepareLifecycleScript(script);
      try {
        await preparation;
      } catch (error) {
        if (signal.aborted) {
          await preparation.catch(() => {});
          await this.terminals.destroyAll();
          throw abortError(signal);
        }
        throw error;
      }
    }
    const pty = ptySessionRegistry.get(sessionId);
    if (signal.aborted) {
      pty?.kill();
      await this.terminals.destroyAll();
      throw abortError(signal);
    }
    if (!pty) {
      throw new Error(
        `Lifecycle script session unavailable for ${script.type} in workspace ${this.workspaceId}`
      );
    }

    let outputTail = '';
    let settled = false;
    let resolveCompletion: (result: LifecycleScriptExecutionResult) => void = () => {};
    const completed = new Promise<LifecycleScriptExecutionResult>((resolve) => {
      resolveCompletion = resolve;
    });
    const finish = (info: PtyExitInfo) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      resolveCompletion({
        kind: 'exited',
        exitCode: info.exitCode,
        signal: info.signal,
        outputTail,
      });
    };
    const onAbort = () => pty.kill();
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      await this.terminals.destroyAll();
      throw abortError(signal);
    }
    pty.onData((data) => {
      outputTail = appendOutputTail(outputTail, data);
    });
    pty.onExit(finish);
    try {
      pty.write(`${script.script}; exit\n`);
    } catch (error) {
      pty.kill();
      await Promise.race([completed, timeout(STARTUP_CLEANUP_TIMEOUT_MS)]).catch(() => {});
      throw error;
    }

    return { completed, kill: () => pty.kill() };
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

    const { terminalId, sessionId } = this.resolveIds(script);

    const pty = await this.prepareLifecycleScript(script, { initialSize });
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

      pty.write(
        terminalInputForScript(
          script.script,
          exit,
          await this.shouldUseWindowsCommandExit(terminalId)
        )
      );

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

  dispose(): Promise<void> {
    if (this.disposeOperation) return this.disposeOperation;
    const operation = this.disposeRequiredStartup();
    this.disposeOperation = operation;
    void operation.catch(() => {
      if (this.disposeOperation === operation) this.disposeOperation = undefined;
    });
    return operation;
  }

  private async disposeRequiredStartup(): Promise<void> {
    this.disposed = true;
    if (!this.requiredStartupLifetime.signal.aborted) {
      this.requiredStartupLifetime.abort(new Error('Lifecycle service disposed'));
    }
    this.sessionsWithRespawnHandler.clear();
    this.sessionsWaitingForExit.clear();
    this.latestRespawnRequest.clear();
    if (this.requiredStartupReceipt) {
      await this.requiredStartupReceipt.ready.catch(() => {});
    }
    await this.terminals.destroyAll();
  }
}

function successfulExit(result: LifecycleScriptExecutionResult): boolean {
  return (
    result.kind === 'exited' &&
    result.signal === undefined &&
    (result.exitCode === 0 || result.exitCode === undefined)
  );
}

function cancelledStartup(stage: LifecycleStartupError['stage']): LifecycleStartupError {
  return {
    type: 'cancelled',
    stage,
    message: 'Required workspace startup was cancelled.',
  };
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
}

function timeout(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function aborted(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

function createStartupExternalControl(
  callerSignal: AbortSignal | undefined,
  deadlineAt: number | undefined
): { signal: AbortSignal; detach(): void } {
  const controller = new AbortController();
  let detached = false;
  const abortFromCaller = () => {
    if (!controller.signal.aborted) controller.abort(callerSignal?.reason);
  };
  const abortFromDeadline = () => {
    if (!controller.signal.aborted) {
      controller.abort(new DOMException('Workspace startup deadline exceeded.', 'TimeoutError'));
    }
  };
  const remaining = deadlineAt === undefined ? undefined : Math.max(0, deadlineAt - Date.now());
  const timer = remaining === undefined ? undefined : setTimeout(abortFromDeadline, remaining);
  timer?.unref?.();
  callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
  if (callerSignal?.aborted) abortFromCaller();
  if (deadlineAt !== undefined && deadlineAt <= Date.now()) abortFromDeadline();
  return {
    signal: controller.signal,
    detach: () => {
      if (detached) return;
      detached = true;
      if (timer) clearTimeout(timer);
      callerSignal?.removeEventListener('abort', abortFromCaller);
    },
  };
}

function capLifecycleTimeout(timeoutMs: number, deadlineAt: number | undefined): number {
  return deadlineAt === undefined
    ? timeoutMs
    : Math.max(1, Math.min(timeoutMs, deadlineAt - Date.now()));
}
