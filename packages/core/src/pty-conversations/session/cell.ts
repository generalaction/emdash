import { ok } from '@emdash/shared';
import type { Result } from '@emdash/shared';
import type { Logger } from '@emdash/shared/logger';
import { LiveLogServer } from '../../live/log';
import { resolveCommandPath as resolveHostCommandPath } from '../../host-dependencies/runtime/probe';
import type { PtyAgentStartInput, PtySessionState } from '../api/schemas';
import type { PtyAgentError } from '../api/schemas';
import { ptyErr } from '../errors';
import type { PtyExitInfo, PtyHandle } from '../transport';
import { spawnLocalPty } from '../runtime/local-pty';
import { LocalProcessExecutionContext } from '../runtime/local-execution-context';
import { planSpawn, type KeystrokePromptDelivery, type SpawnPlan } from '../runtime/spawn-plan';
import { SessionRespawnPolicy } from '../runtime/supervisor';
import type { InternalStartInput, PtyRuntimeDeps, PtyStartResult } from '../runtime/types';

const DEFAULT_MAX_BUFFER_BYTES = 64 * 1024;
const FLUSH_INTERVAL_MS = 16;
const QUIET_PERIOD_MS = 800;
const MAX_PROMPT_INJECTION_WAIT_MS = 15_000;
const RESPAWN_DELAY_MS = 250;

export type ConversationSessionCellOptions = {
  conversationId: string;
  deps: PtyRuntimeDeps;
  outputMaxBufferBytes?: number;
  publish: (state: PtySessionState) => void;
};

type PromptInjectionPort = {
  write(data: string): void;
  onData(handler: () => void): () => void;
  onExit(handler: () => void): () => void;
};

export class ConversationSessionCell {
  readonly output: LiveLogServer;
  private readonly policy = new SessionRespawnPolicy();
  private readonly dataListeners = new Set<() => void>();
  private readonly exitListeners = new Set<() => void>();
  private pendingOutput = '';
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private respawnTimer: ReturnType<typeof setTimeout> | null = null;
  private state: PtySessionState | null = null;
  private handle: PtyHandle | null = null;
  private lastInput: PtyAgentStartInput | null = null;
  private activeSessionId: string | null = null;
  private disposed = false;

  constructor(private readonly options: ConversationSessionCellOptions) {
    this.output = new LiveLogServer({
      maxBufferBytes: options.outputMaxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES,
    });
  }

  get hasState(): boolean {
    return this.state !== null;
  }

  get isRunning(): boolean {
    return this.handle !== null;
  }

  snapshot(): PtySessionState | null {
    if (!this.state) return null;
    return structuredClone(this.state);
  }

  ensureStarted(input: PtyAgentStartInput): Promise<PtyStartResult> {
    return this.startInternal({
      ...input,
      mode: input.resume ? 'resume' : 'fresh',
    });
  }

  stop(): Result<void, PtyAgentError> {
    this.clearRespawnTimer();
    const handle = this.policy.stop();
    if (handle) {
      handle.kill();
    }
    this.handle = null;
    this.markExited({ exitCode: null });
    return ok(undefined);
  }

  dispose(): void {
    this.disposed = true;
    this.clearRespawnTimer();
    this.policy.dispose();
    this.handle?.kill();
    this.handle = null;
    this.flushPendingOutput();
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.dataListeners.clear();
    this.exitListeners.clear();
  }

  write(data: string): boolean {
    if (!this.handle) return false;
    this.handle.write(data);
    return true;
  }

  resize(cols: number, rows: number): void {
    this.handle?.resize(cols, rows);
    if (this.lastInput) {
      this.lastInput = {
        ...this.lastInput,
        cols,
        rows,
      };
    }
    if (!this.state) return;
    this.state = {
      ...this.state,
      cols,
      rows,
    };
    this.publish();
  }

  private async startInternal(input: InternalStartInput): Promise<PtyStartResult> {
    const spawnToken = this.policy.beginStart({
      requireDesired: input.requireDesired,
      mode: input.mode,
    });
    if (!spawnToken) {
      return ok({
        sessionId: this.activeSessionId ?? input.sessionId ?? input.conversationId,
        alreadyRunning: true,
      });
    }

    const resetOutput = input.mode === 'fresh';
    this.markStarting(input, resetOutput);

    const plugin = this.options.deps.plugins.get(input.providerId);
    if (!plugin) {
      this.policy.failSpawn(spawnToken);
      this.markExited({ exitCode: null });
      return ptyErr.unknownProvider(input.providerId);
    }

    const cli = await this.resolveCli(input);
    if (!cli) {
      this.policy.failSpawn(spawnToken);
      this.markExited({ exitCode: null });
      return ptyErr.noCommand(input.providerId);
    }

    const planResult = planSpawn(input, plugin, cli);
    if (!planResult.success) {
      this.policy.failSpawn(spawnToken);
      this.markExited({ exitCode: null });
      return planResult;
    }

    try {
      const env = await this.options.deps.buildEnv(input.providerId, planResult.data.spec.env);
      const plan = {
        ...planResult.data,
        spec: {
          ...planResult.data.spec,
          env,
        },
      };
      const handle = await this.spawnPty(plan);
      const accepted = this.policy.acceptSpawn(spawnToken, handle);
      if (!accepted) {
        handle.kill();
        return ok({
          sessionId: this.activeSessionId ?? input.sessionId ?? input.conversationId,
          alreadyRunning: true,
        });
      }

      this.attachHandle(input, plan, handle, resetOutput);
      await this.persistSessionId(input.conversationId, plan.resolvedSessionId);
      return ok({ sessionId: plan.resolvedSessionId });
    } catch (error) {
      this.policy.failSpawn(spawnToken);
      this.markExited({ exitCode: null });
      const message = error instanceof Error ? error.message : String(error);
      return ptyErr.spawnFailed(message);
    }
  }

  private attachHandle(
    input: InternalStartInput,
    plan: SpawnPlan,
    handle: PtyHandle,
    resetOutput: boolean
  ): void {
    if (resetOutput) this.output.reseed();
    this.handle = handle;
    this.activeSessionId = plan.resolvedSessionId;
    this.lastInput = {
      ...input,
      sessionId: plan.resolvedSessionId,
      resume: plan.commandSession.isResuming,
    };
    this.state = {
      ...toStartingState(input),
      status: 'running',
      startedAt: Date.now(),
      ...(handle.getPid ? { pid: handle.getPid() } : {}),
    };
    delete this.state.exit;
    this.publish();

    handle.onData((data) => {
      if (this.disposed || this.handle !== handle) return;
      this.enqueueOutput(data);
      this.emitData();
    });
    handle.onExit((info) => {
      if (this.disposed || this.handle !== handle) return;
      this.emitExit();
      this.handle = null;
      this.flushPendingOutput();
      const decision = this.policy.handleExit(handle);
      if (decision.kind === 'respawnResume' || decision.kind === 'respawnFresh') {
        const mode = decision.kind === 'respawnResume' ? 'resume' : 'fresh';
        this.markRestarting(info);
        this.scheduleRespawn(mode);
        return;
      }
      this.markExited(info);
      if (decision.kind === 'failed') {
        this.options.deps.logger.warn('PtyConversations: session failed after fresh recovery', {
          conversationId: this.options.conversationId,
          exitCode: info.exitCode,
          signal: info.signal,
        });
      }
    });

    if (plan.promptDelivery.kind === 'keystroke') {
      scheduleInitialPromptInjection({
        pty: this.promptInjectionPort(),
        initialPrompt: input.initialPrompt,
        isResuming: plan.commandSession.isResuming,
        promptDelivery: plan.promptDelivery,
        logger: this.options.deps.logger,
        conversationId: input.conversationId,
      });
    }
  }

  private markStarting(input: PtyAgentStartInput, resetOutput: boolean): void {
    this.disposed = false;
    this.flushPendingOutput();
    if (resetOutput) this.output.reseed();
    this.state = toStartingState(input);
    this.publish();
  }

  private enqueueOutput(data: string): void {
    if (this.disposed) return;
    if (!data) return;
    this.pendingOutput += data;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushPendingOutput();
    }, FLUSH_INTERVAL_MS);
  }

  private flushPendingOutput(): void {
    if (!this.pendingOutput) return;
    const chunk = this.pendingOutput;
    this.pendingOutput = '';
    this.output.append(chunk);
  }

  private markRestarting(info: PtyExitInfo): void {
    if (!this.state) return;
    this.state = {
      ...this.state,
      status: 'restarting',
      exit: {
        exitCode: info.exitCode,
        ...(info.signal !== undefined ? { signal: info.signal } : {}),
      },
    };
    this.publish();
  }

  private markExited(info: PtyExitInfo): void {
    if (this.disposed) return;
    this.handle = null;
    if (!this.state) {
      const input = this.lastInput;
      if (!input) return;
      this.state = toStartingState(input);
    }
    this.state = {
      ...this.state,
      status: 'exited',
      exit: {
        exitCode: info.exitCode,
        ...(info.signal !== undefined ? { signal: info.signal } : {}),
      },
    };
    this.publish();
  }

  private scheduleRespawn(mode: 'fresh' | 'resume'): void {
    if (!this.lastInput) return;
    this.clearRespawnTimer();
    const state = this.state;
    const input = {
      ...this.lastInput,
      resume: mode === 'resume',
      cols: state?.cols ?? this.lastInput.cols,
      rows: state?.rows ?? this.lastInput.rows,
      mode,
      requireDesired: true,
    };
    const delay = this.options.deps.respawnDelayMs ?? RESPAWN_DELAY_MS;
    this.respawnTimer = setTimeout(() => {
      this.respawnTimer = null;
      void this.startInternal(input);
    }, delay);
  }

  private clearRespawnTimer(): void {
    if (!this.respawnTimer) return;
    clearTimeout(this.respawnTimer);
    this.respawnTimer = null;
  }

  private async resolveCli(input: PtyAgentStartInput): Promise<string | null> {
    const plugin = this.options.deps.plugins.get(input.providerId);
    const binaryNames = plugin?.capabilities.hostDependency.binaryNames ?? [input.providerId];
    for (const binaryName of binaryNames) {
      const resolved = this.options.deps.resolveCliPath
        ? await this.options.deps.resolveCliPath(binaryName, input.cwd)
        : await resolveHostCommandPath(binaryName, new LocalProcessExecutionContext(input.cwd));
      if (resolved) return resolved;
    }
    return null;
  }

  private async spawnPty(plan: SpawnPlan): Promise<PtyHandle> {
    if (this.options.deps.spawnPty) return await this.options.deps.spawnPty(plan.spec);
    return spawnLocalPty({ ...plan.spec, logger: this.options.deps.logger });
  }

  private async persistSessionId(conversationId: string, sessionId: string): Promise<void> {
    if (!this.options.deps.persistSessionId) return;
    const result = await this.options.deps.persistSessionId(conversationId, sessionId);
    if (!result.success) {
      this.options.deps.logger.warn('PtyConversations: failed to persist session id', {
        conversationId,
        sessionId,
        error: result.error,
      });
    }
  }

  private publish(): void {
    if (!this.state) return;
    this.options.publish(this.snapshot()!);
  }

  private promptInjectionPort(): PromptInjectionPort {
    return {
      write: (data) => this.handle?.write(data),
      onData: (handler) => {
        this.dataListeners.add(handler);
        return () => this.dataListeners.delete(handler);
      },
      onExit: (handler) => {
        this.exitListeners.add(handler);
        return () => this.exitListeners.delete(handler);
      },
    };
  }

  private emitData(): void {
    for (const listener of this.dataListeners) listener();
  }

  private emitExit(): void {
    for (const listener of this.exitListeners) listener();
  }
}

export function scheduleInitialPromptInjection(args: {
  pty: PromptInjectionPort;
  conversationId: string;
  initialPrompt: string | undefined;
  isResuming: boolean;
  promptDelivery: KeystrokePromptDelivery;
  logger: Pick<Logger, 'warn'>;
}): void {
  if (args.isResuming) return;
  if (!args.initialPrompt?.trim()) return;

  const submitSequence = args.promptDelivery.submitSequence ?? '\r';
  const submitDelayMs = args.promptDelivery.submitDelayMs;
  const payload = buildPromptInjectionPayload({
    text: args.initialPrompt,
    bracketedPaste: args.promptDelivery.bracketedPaste,
  });

  let injected = false;
  let sawAnyOutput = false;
  let quietTimer: ReturnType<typeof setTimeout> | null = null;

  const inject = () => {
    if (injected) return;
    injected = true;
    if (quietTimer) clearTimeout(quietTimer);
    clearTimeout(maxWaitTimer);
    unsubscribeData?.();
    unsubscribeExit?.();
    try {
      if (submitDelayMs) {
        args.pty.write(payload);
        setTimeout(() => args.pty.write(submitSequence), submitDelayMs);
        return;
      }
      args.pty.write(`${payload}${submitSequence}`);
    } catch (error) {
      args.logger.warn('PtyConversations: failed to inject initial prompt', {
        conversationId: args.conversationId,
        error: String(error),
      });
    }
  };

  const maxWaitTimer = setTimeout(inject, MAX_PROMPT_INJECTION_WAIT_MS);

  const unsubscribeData = args.pty.onData(() => {
    if (injected) return;
    sawAnyOutput = true;
    if (quietTimer) clearTimeout(quietTimer);
    quietTimer = setTimeout(inject, QUIET_PERIOD_MS);
  });

  const unsubscribeExit = args.pty.onExit(() => {
    const promptWasInjected = injected;
    injected = true;
    if (quietTimer) clearTimeout(quietTimer);
    clearTimeout(maxWaitTimer);
    unsubscribeData?.();
    unsubscribeExit?.();
    if (!promptWasInjected) {
      args.logger.warn('PtyConversations: PTY exited before initial prompt could be injected', {
        conversationId: args.conversationId,
        sawAnyOutput,
      });
    }
  });
}

function toStartingState(input: PtyAgentStartInput): PtySessionState {
  return {
    conversationId: input.conversationId,
    providerId: input.providerId,
    status: 'starting',
    cols: input.cols,
    rows: input.rows,
    isRemote: false,
    title: input.providerId,
    startedAt: Date.now(),
  };
}

function buildPromptInjectionPayload(args: {
  text: string;
  bracketedPaste: 'multiline' | 'never';
}): string {
  const trimmed = args.text.trim();
  const hasMultilinePayload = trimmed.includes('\n');
  const shouldUseBracketedPaste = args.bracketedPaste === 'multiline' && hasMultilinePayload;
  if (!shouldUseBracketedPaste) return trimmed;
  return `\x1b[200~${trimmed}\x1b[201~`;
}
