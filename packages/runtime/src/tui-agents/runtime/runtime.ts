import type { ResolvedTuiProvider } from '@emdash/core/agents/plugins';
import { PtyRegistry, type PtyExitInfo, type PtySession } from '@emdash/core/pty';
import type {
  TuiAgentError,
  TuiAgentStartInput,
  TuiResumeOutcome,
  TuiSessionState,
} from '@emdash/core/workspace-server';
import { err, ok, type Result } from '@emdash/shared';
import { LiveLog, managedLiveSource, type LiveSource } from '@emdash/wire';
import { createManagedSource, type ManagedSource } from '@emdash/wire/util';
import {
  createTuiNotificationsLiveHost,
  createTuiNotificationsListModel,
  createTuiSessionsLiveHost,
  createTuiSessionsListModel,
  type TuiNotificationsLiveHost,
  type TuiNotificationsListModel,
  type TuiSessionsLiveHost,
  type TuiSessionsListModel,
} from '../state/live-models';
import { scheduleInitialPromptInjection } from './keystroke-injection';
import { TuiAgentNotifications } from './notifications';
import type { TuiAgentsRuntimeDeps, TuiSessionConfig } from './types';

const SESSION_GRACE_MS = 3_000;
const RESUME_FALLBACK_WINDOW_MS = 3_000;

type TuiAgentSession = {
  conversationId: string;
  output: LiveLog;
  pty: PtySession | null;
  config: TuiSessionConfig | null;
  provider: ResolvedTuiProvider | null;
};

export class TuiAgentsRuntime {
  private readonly registry: PtyRegistry;
  private readonly sessionsSource: ManagedSource<{ conversationId: string }, TuiAgentSession>;
  private readonly logs = new Map<string, LiveLog>();
  private readonly configs = new Map<string, TuiSessionConfig>();
  private readonly sessionsHost: TuiSessionsLiveHost;
  private readonly notificationsHost: TuiNotificationsLiveHost;
  private readonly sessionsList: TuiSessionsListModel;
  private readonly notificationsList: TuiNotificationsListModel;
  private readonly notifications: TuiAgentNotifications;

  constructor(private readonly deps: TuiAgentsRuntimeDeps) {
    this.registry = new PtyRegistry(deps.spawner);
    this.sessionsHost = createTuiSessionsLiveHost();
    this.notificationsHost = createTuiNotificationsLiveHost();
    this.sessionsList = createTuiSessionsListModel(this.sessionsHost);
    this.notificationsList = createTuiNotificationsListModel(this.notificationsHost);
    this.notifications = new TuiAgentNotifications(this.sessionsList, this.notificationsList);
    this.sessionsSource = createManagedSource({
      key: (key) => key.conversationId,
      graceMs: SESSION_GRACE_MS,
      create: async (key, scope) => {
        const session = this.createRetainedSession(key.conversationId);
        const config = this.configs.get(key.conversationId);
        if (config && config.intent !== 'stopped') {
          await this.spawnInto(session, config);
        }
        scope.add(() => {
          this.killSessionProcess(session);
        });
        return session;
      },
      onError: (error, key) => {
        deps.logger.warn('TuiAgentsRuntime: session creation failed', {
          conversationId: key,
          error: String(error),
        });
      },
    });
  }

  startSession(input: TuiAgentStartInput): Result<void, TuiAgentError> {
    const provider = this.resolveProvider(input.providerId);
    if (!provider.success) return provider;

    const config: TuiSessionConfig = { input, intent: 'fresh' };
    this.configs.set(input.conversationId, config);
    void this.ensureActiveSessionUsesConfig(input.conversationId, config);
    return ok(undefined);
  }

  resumeSession(input: TuiAgentStartInput): Result<{ outcome: TuiResumeOutcome }, TuiAgentError> {
    const provider = this.resolveProvider(input.providerId);
    if (!provider.success) return provider;

    const active = this.sessionsSource.peek({ conversationId: input.conversationId });
    if (active?.pty) {
      return ok({ outcome: 'attached' });
    }

    const intent = input.sessionId ? 'resume' : 'fresh';
    const config: TuiSessionConfig = { input, intent };
    this.configs.set(input.conversationId, config);
    this.setResumeState(input.conversationId, {
      requested: true,
      outcome: input.sessionId ? 'pending' : 'fresh-fallback',
      reason: input.sessionId ? undefined : 'missing-provider-session-id',
    });
    void this.ensureActiveSessionUsesConfig(input.conversationId, config);
    return ok({ outcome: input.sessionId ? 'resumed' : 'fresh-fallback' });
  }

  stopSession(conversationId: string): Result<void, TuiAgentError> {
    const config = this.configs.get(conversationId);
    if (config) this.configs.set(conversationId, { ...config, intent: 'stopped' });
    this.registry.dispose(conversationId);
    const active = this.sessionsSource.peek({ conversationId });
    if (active) active.pty = null;
    this.markExited(conversationId, null);
    this.notifications.resetToIdle(conversationId);
    return ok(undefined);
  }

  deleteSession(conversationId: string): Result<void, TuiAgentError> {
    this.registry.dispose(conversationId);
    this.configs.delete(conversationId);
    this.logs.delete(conversationId);
    const active = this.sessionsSource.peek({ conversationId });
    active?.output.reseed();
    if (active) active.pty = null;
    this.sessionsList.states.list.produce((draft) => {
      delete draft[conversationId];
    });
    this.notifications.clear(conversationId);
    return ok(undefined);
  }

  sendInput(conversationId: string, data: string): Result<void, TuiAgentError> {
    const active = this.sessionsSource.peek({ conversationId });
    if (!active?.pty) return err({ type: 'not-found', conversationId });
    active.pty.write(data);
    this.notifications.markInputSubmitted(conversationId, active.provider, data);
    return ok(undefined);
  }

  resize(conversationId: string, cols: number, rows: number): Result<void, TuiAgentError> {
    const active = this.sessionsSource.peek({ conversationId });
    if (!active?.pty) return err({ type: 'not-found', conversationId });
    active.pty.resize(cols, rows);
    this.updateSessionSize(conversationId, cols, rows);
    return ok(undefined);
  }

  emitHookEvent(input: {
    conversationId: string;
    eventType: string;
    body: Record<string, unknown>;
  }): Result<void, TuiAgentError> {
    const config = this.configs.get(input.conversationId);
    const provider = config
      ? this.deps.pluginHost.resolveTuiProvider(config.input.providerId)
      : null;
    this.notifications.emitHookEvent(input.conversationId, provider, input.eventType, input.body);
    return ok(undefined);
  }

  outputLog(key: { conversationId: string }): LiveSource {
    return managedLiveSource(this.sessionsSource, key, (session) => session.output);
  }

  sessionsLiveHost(): TuiSessionsLiveHost {
    return this.sessionsHost;
  }

  notificationsLiveHost(): TuiNotificationsLiveHost {
    return this.notificationsHost;
  }

  dispose(): void {
    void this.sessionsSource.dispose();
    this.registry.killAll();
    this.logs.clear();
    this.configs.clear();
  }

  private async ensureActiveSessionUsesConfig(
    conversationId: string,
    config: TuiSessionConfig
  ): Promise<void> {
    const active = this.sessionsSource.peek({ conversationId });
    if (!active || active.pty || config.intent === 'stopped') return;
    await this.spawnInto(active, config);
  }

  private async spawnInto(session: TuiAgentSession, config: TuiSessionConfig): Promise<void> {
    const providerResult = this.resolveProvider(config.input.providerId);
    if (!providerResult.success) throw new Error(JSON.stringify(providerResult.error));

    const provider = providerResult.data;
    const spawnContext = await this.deps.resolveSpawnContext(config.input.providerId);
    const isResuming = config.intent === 'resume';
    const resumeState =
      isResuming ||
      this.currentResumeState(config.input.conversationId)?.outcome === 'fresh-fallback'
        ? (this.currentResumeState(config.input.conversationId) ?? {
            requested: true,
            outcome: 'pending' as const,
          })
        : null;
    const startedAt = Date.now();
    const command = provider.buildCommand({
      cli: spawnContext.cli,
      extraArgs: config.input.extraArgs,
      autoApprove: config.input.autoApprove ?? false,
      initialPrompt: isResuming ? undefined : config.input.initialPrompt,
      sessionId: config.input.conversationId,
      providerSessionId: config.input.sessionId ?? undefined,
      isResuming,
      model: config.input.model ?? '',
    });

    session.config = config;
    session.provider = provider;
    this.syncSessionState({
      conversationId: config.input.conversationId,
      providerId: config.input.providerId,
      sessionId: config.input.sessionId,
      status: 'starting',
      cols: config.input.cols,
      rows: config.input.rows,
      resume: resumeState,
      startedAt,
    });

    const pty = await this.registry.create(
      config.input.conversationId,
      {
        command: command.command,
        args: command.args,
        cwd: config.input.cwd,
        env: {
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
          TERM_PROGRAM: 'emdash',
          ...spawnContext.agentEnv,
          ...command.env,
          ...config.input.providerVars,
          ...this.hookEnv(config.input),
        },
        cols: config.input.cols,
        rows: config.input.rows,
      },
      {
        output: session.output,
        onProcess: (proc) => {
          scheduleInitialPromptInjection({
            pty: proc,
            providerId: config.input.providerId,
            provider,
            conversationId: config.input.conversationId,
            initialPrompt: config.input.initialPrompt,
            isResuming,
            logger: this.deps.logger,
          });
        },
        onExit: (info) => {
          if (session.pty === pty) session.pty = null;
          if (isResuming && Date.now() - startedAt <= RESUME_FALLBACK_WINDOW_MS) {
            this.setResumeState(config.input.conversationId, {
              requested: true,
              outcome: 'fresh-fallback',
              reason: 'resume-process-exited-early',
            });
            const nextConfig: TuiSessionConfig = { input: config.input, intent: 'fresh' };
            this.configs.set(config.input.conversationId, nextConfig);
            void this.spawnInto(session, nextConfig);
            return;
          }
          this.markExited(config.input.conversationId, info);
          this.notifications.resetToIdle(config.input.conversationId);
        },
        onStateChange: () => {
          this.syncSessionState({
            conversationId: config.input.conversationId,
            providerId: config.input.providerId,
            sessionId: this.currentProviderSessionId(
              config.input.conversationId,
              config.input.sessionId
            ),
            status: pty.exited ? 'exited' : 'running',
            pid: pty.getPid(),
            cols: config.input.cols,
            rows: config.input.rows,
            resume: isResuming ? { requested: true, outcome: 'resumed' } : resumeState,
            startedAt,
            exit: pty.exitStatus
              ? { exitCode: pty.exitStatus.exitCode, signal: pty.exitStatus.signal ?? undefined }
              : undefined,
          });
        },
      }
    );

    session.pty = pty;
    this.syncSessionState({
      conversationId: config.input.conversationId,
      providerId: config.input.providerId,
      sessionId: this.currentProviderSessionId(config.input.conversationId, config.input.sessionId),
      status: 'running',
      pid: pty.getPid(),
      cols: config.input.cols,
      rows: config.input.rows,
      resume: isResuming ? { requested: true, outcome: 'resumed' } : resumeState,
      startedAt,
    });
  }

  private createRetainedSession(conversationId: string): TuiAgentSession {
    return {
      conversationId,
      output: this.logFor(conversationId),
      pty: null,
      config: null,
      provider: null,
    };
  }

  private logFor(conversationId: string): LiveLog {
    let log = this.logs.get(conversationId);
    if (!log) {
      log = new LiveLog(this.deps.log);
      this.logs.set(conversationId, log);
    }
    return log;
  }

  private resolveProvider(providerId: string): Result<ResolvedTuiProvider, TuiAgentError> {
    const provider = this.deps.pluginHost.resolveTuiProvider(providerId);
    if (provider) return ok(provider);
    return this.deps.pluginHost.get(providerId)
      ? err({ type: 'no-command', providerId })
      : err({ type: 'unknown-provider', providerId });
  }

  private hookEnv(input: TuiAgentStartInput): Record<string, string> {
    const hook = this.deps.hook;
    if (!hook || hook.port <= 0) return {};
    return {
      EMDASH_HOOK_PORT: String(hook.port),
      EMDASH_PTY_ID: `${input.providerId}-conv-${input.conversationId}`,
      EMDASH_HOOK_NONCE: hook.token,
      EMDASH_HOOK_TOKEN: hook.token,
    };
  }

  private syncSessionState(state: TuiSessionState): void {
    this.sessionsList.states.list.produce((draft) => {
      draft[state.conversationId] = state;
    });
  }

  private setResumeState(
    conversationId: string,
    resume: NonNullable<TuiSessionState['resume']>
  ): void {
    this.sessionsList.states.list.produce((draft) => {
      const current = draft[conversationId];
      if (current) {
        current.resume = resume;
        return;
      }
      const config = this.configs.get(conversationId);
      if (!config) return;
      draft[conversationId] = {
        conversationId,
        providerId: config.input.providerId,
        sessionId: config.input.sessionId,
        status: 'exited',
        cols: config.input.cols,
        rows: config.input.rows,
        resume,
        startedAt: Date.now(),
      };
    });
  }

  private markExited(conversationId: string, info: PtyExitInfo | null): void {
    this.sessionsList.states.list.produce((draft) => {
      const current = draft[conversationId];
      if (!current) return;
      current.status = 'exited';
      current.exit = info
        ? { exitCode: info.exitCode, signal: info.signal ?? undefined }
        : undefined;
    });
  }

  private updateSessionSize(conversationId: string, cols: number, rows: number): void {
    this.sessionsList.states.list.produce((draft) => {
      const current = draft[conversationId];
      if (!current) return;
      current.cols = cols;
      current.rows = rows;
    });
  }

  private currentProviderSessionId(conversationId: string, fallback: string | null): string | null {
    return this.sessionsList.states.list.snapshot().data[conversationId]?.sessionId ?? fallback;
  }

  private currentResumeState(conversationId: string): TuiSessionState['resume'] {
    return this.sessionsList.states.list.snapshot().data[conversationId]?.resume ?? null;
  }

  private killSessionProcess(session: TuiAgentSession): void {
    if (!session.pty) return;
    session.pty.kill();
    session.pty = null;
  }
}
