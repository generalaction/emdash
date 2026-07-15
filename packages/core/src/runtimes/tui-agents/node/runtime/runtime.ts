import { err, ok, type Result, type Serializable } from '@emdash/shared';
import { createResourceCache, type ResourceCache } from '@emdash/shared/concurrency';
import { LiveLog, type LiveSource } from '@emdash/wire';
import {
  compileIdlePolicy,
  createIdleSweeper,
  createIoActivityTracker,
  type IdlePolicy,
  type IdleSweeper,
  type IoActivitySnapshot,
  type IoActivityTracker,
} from '@primitives/io-activity/api';
import type {
  TuiAgentStartInput,
  TuiInputError,
  TuiResumeOutcome,
  TuiResumeSessionError,
  TuiSessionControlError,
  TuiSessionState,
  TuiStartSessionError,
} from '@runtimes/tui-agents/api';
import { tuiAgentStartInputSchema } from '@runtimes/tui-agents/api';
import {
  createTuiNotificationsLiveHost,
  createTuiNotificationsListModel,
  createTuiSessionsLiveHost,
  createTuiSessionsListModel,
  type TuiNotificationsLiveHost,
  type TuiNotificationsListModel,
  type TuiSessionsLiveHost,
  type TuiSessionsListModel,
} from '@runtimes/tui-agents/node/state/live-models';
import type { AgentCommand, ResolvedTuiProvider } from '@services/agent-plugins/api/plugins';
import { quoteShellArg } from '@services/agent-plugins/api/plugins/helpers/standard-command';
import {
  buildTmuxShellLine,
  killTmuxSession,
  listTmuxSessionActivity,
  PtyRegistry,
  type PtyExitInfo,
  type PtySession,
  type PtySpawnSpec,
} from '@services/pty/api';
import { TuiAgentNotifications } from './notifications';
import type { TuiAgentsRuntimeDeps, TuiSessionConfig } from './types';

const SESSION_GRACE_MS = 3_000;
const RESUME_FALLBACK_WINDOW_MS = 3_000;
const RESPAWN_DELAY_MS = 500;
const MAX_UNEXPECTED_RESPAWNS = 1;
const DEFAULT_SESSION_IDLE_MS = 60 * 60_000;
const BUSY_OUTPUT_WINDOW_MS = 60_000;

type TuiAgentSession = {
  conversationId: string;
  output: LiveLog;
  pty: PtySession | null;
  config: TuiSessionConfig | null;
  provider: ResolvedTuiProvider | null;
};

export class TuiAgentsRuntime {
  private readonly registry: PtyRegistry;
  private readonly sessionsSource: ResourceCache<{ conversationId: string }, TuiAgentSession>;
  private readonly logs = new Map<string, LiveLog>();
  private readonly configs = new Map<string, TuiSessionConfig>();
  private readonly sessionsHost: TuiSessionsLiveHost;
  private readonly notificationsHost: TuiNotificationsLiveHost;
  private readonly sessionsList: TuiSessionsListModel;
  private readonly notificationsList: TuiNotificationsListModel;
  private readonly notifications: TuiAgentNotifications;
  private readonly sessionIdlePolicy: IdlePolicy;
  private readonly idleSweeper: IdleSweeper;
  private readonly activity = new Map<string, IoActivityTracker>();
  private tmuxActivity = new Map<string, number>();
  private readonly unexpectedRespawns = new Map<string, number>();

  constructor(private readonly deps: TuiAgentsRuntimeDeps) {
    this.registry = new PtyRegistry(deps.spawner);
    this.sessionsHost = createTuiSessionsLiveHost();
    this.notificationsHost = createTuiNotificationsLiveHost();
    this.sessionsList = createTuiSessionsListModel(this.sessionsHost);
    this.notificationsList = createTuiNotificationsListModel(this.notificationsHost);
    this.notifications = new TuiAgentNotifications(this.sessionsList, this.notificationsList);
    this.sessionIdlePolicy = compileIdlePolicy(
      deps.lifecycle?.session ?? { kind: 'idle-after', outputMs: DEFAULT_SESSION_IDLE_MS }
    );
    this.sessionsSource = createResourceCache<{ conversationId: string }, TuiAgentSession>({
      key: (key) => key.conversationId,
      idleTtlMs: SESSION_GRACE_MS,
      create: async (key, scope) => {
        const config = this.configs.get(key.conversationId) ?? null;
        const session = this.createRetainedSession(key.conversationId);
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
    this.idleSweeper = createIdleSweeper<string>({
      ...(deps.clock ? { clock: deps.clock } : {}),
      intervalMs: deps.lifecycle?.sweepIntervalMs ?? 60_000,
      beforeSweep: async () => {
        this.tmuxActivity = await listTmuxSessionActivity(this.deps.exec);
      },
      entries: () => Array.from(this.configs.keys()),
      snapshot: (conversationId) => this.lifecycleSnapshot(conversationId),
      policy: () => this.sessionIdlePolicy,
      deactivate: (conversationId, reason) => {
        this.deactivateSession(conversationId, reason);
      },
      onError: (error, conversationId) => {
        this.deps.logger.warn('TuiAgentsRuntime: idle sweep failed', {
          conversationId,
          error: String(error),
        });
      },
    });
  }

  startSession(input: TuiAgentStartInput): Result<void, TuiStartSessionError> {
    const provider = this.resolveProvider(input.providerId);
    if (!provider.success) return provider;

    const config: TuiSessionConfig = { input, intent: 'fresh' };
    this.configs.set(input.conversationId, config);
    this.persistActiveIntent(input);
    this.recordInputActivity(input.conversationId);
    this.unexpectedRespawns.delete(input.conversationId);
    void this.ensureActiveSessionUsesConfig(input.conversationId, config);
    return ok(undefined);
  }

  resumeSession(
    input: TuiAgentStartInput
  ): Result<{ outcome: TuiResumeOutcome }, TuiResumeSessionError> {
    const provider = this.resolveProvider(input.providerId);
    if (!provider.success) return provider;

    const active = this.sessionsSource.peek({ conversationId: input.conversationId });
    if (active?.pty) {
      this.persistActiveIntent(input);
      return ok({ outcome: 'attached' });
    }

    const intent = input.sessionId ? 'resume' : 'fresh';
    const config: TuiSessionConfig = { input, intent };
    this.configs.set(input.conversationId, config);
    this.persistActiveIntent(input);
    this.recordInputActivity(input.conversationId);
    this.unexpectedRespawns.delete(input.conversationId);
    this.setResumeState(input.conversationId, {
      requested: true,
      outcome: input.sessionId ? 'pending' : 'fresh-fallback',
      reason: input.sessionId ? undefined : 'missing-provider-session-id',
    });
    void this.ensureActiveSessionUsesConfig(input.conversationId, config);
    return ok({ outcome: input.sessionId ? 'resumed' : 'fresh-fallback' });
  }

  stopSession(conversationId: string): Result<void, TuiSessionControlError> {
    const config = this.configs.get(conversationId);
    if (config) this.configs.set(conversationId, { ...config, intent: 'stopped' });
    this.unexpectedRespawns.delete(conversationId);
    void this.killTmuxForConfig(config);
    this.registry.dispose(conversationId);
    const active = this.sessionsSource.peek({ conversationId });
    if (active) active.pty = null;
    this.markExited(conversationId, null);
    this.notifications.resetToIdle(conversationId);
    this.persistSuspendedIntent(conversationId, 'user');
    return ok(undefined);
  }

  deleteSession(conversationId: string): Result<void, TuiSessionControlError> {
    const config = this.configs.get(conversationId);
    this.unexpectedRespawns.delete(conversationId);
    void this.killTmuxForConfig(config);
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
    this.removePersistedIntent(conversationId);
    return ok(undefined);
  }

  deactivateSession(conversationId: string, cause: string): Result<void, TuiSessionControlError> {
    const config = this.configs.get(conversationId);
    if (!config || config.intent === 'stopped') return ok(undefined);
    if (cause === 'idle' && this.isSessionBusy(conversationId)) return ok(undefined);
    this.unexpectedRespawns.delete(conversationId);
    void this.killTmuxForConfig(config);
    this.registry.dispose(conversationId);
    this.configs.delete(conversationId);
    this.logs.delete(conversationId);
    this.activity.delete(conversationId);
    const active = this.sessionsSource.peek({ conversationId });
    active?.output.reseed();
    if (active) active.pty = null;
    this.sessionsList.states.list.produce((draft) => {
      delete draft[conversationId];
    });
    this.notifications.clear(conversationId);
    this.persistSuspendedIntent(conversationId, cause);
    return ok(undefined);
  }

  killSession(conversationId: string): Result<void, TuiSessionControlError> {
    const result = this.deactivateSession(conversationId, 'user');
    if (!result.success) return result;
    this.removePersistedIntent(conversationId);
    return ok(undefined);
  }

  sendInput(conversationId: string, data: string): Result<void, TuiInputError> {
    const active = this.sessionsSource.peek({ conversationId });
    if (!active?.pty) return err({ type: 'not-found', conversationId });
    active.pty.write(data);
    this.recordInputActivity(conversationId);
    this.notifications.markInputSubmitted(conversationId, active.provider, data);
    return ok(undefined);
  }

  resize(conversationId: string, cols: number, rows: number): Result<void, TuiInputError> {
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
  }): Result<void, TuiSessionControlError> {
    const config = this.configs.get(input.conversationId);
    const provider = config
      ? this.deps.agentHost.resolveTuiProvider(config.input.providerId)
      : null;
    this.notifications.emitHookEvent(input.conversationId, provider, input.eventType, input.body);
    return ok(undefined);
  }

  outputLog(key: { conversationId: string }): LiveSource {
    return {
      snapshot: async () => {
        const lease = this.sessionsSource.acquire(key);
        try {
          return await (await lease.ready()).output.snapshot();
        } finally {
          await lease.release();
        }
      },
      subscribe: (cb) => {
        const tracker = this.activityFor(key.conversationId);
        tracker.attach();
        let disposed = false;
        let unsubscribe: (() => void) | undefined;
        const lease = this.sessionsSource.acquire(key);
        void lease.ready().then((session) => {
          if (disposed) {
            void lease.release();
            return;
          }
          unsubscribe = session.output.subscribe(cb);
        });
        return () => {
          disposed = true;
          tracker.detach();
          this.syncSessionActivity(key.conversationId);
          unsubscribe?.();
          void lease.release();
        };
      },
    };
  }

  sessionsLiveHost(): TuiSessionsLiveHost {
    return this.sessionsHost;
  }

  notificationsLiveHost(): TuiNotificationsLiveHost {
    return this.notificationsHost;
  }

  async reconcile(): Promise<void> {
    const listed = await this.deps.intents.list();
    if (!listed.success) {
      this.deps.logger.warn('TuiAgentsRuntime: failed to load session intents', {
        error: listed.error,
      });
      return;
    }

    let tmuxActivity: Map<string, number>;
    try {
      tmuxActivity = await listTmuxSessionActivity(this.deps.exec);
    } catch (error) {
      this.deps.logger.warn('TuiAgentsRuntime: failed to reconcile tmux activity', {
        error: String(error),
      });
      return;
    }

    for (const intent of listed.data) {
      if (intent.status !== 'active') continue;
      const parsed = tuiAgentStartInputSchema.safeParse(intent.payload);
      if (!parsed.success) {
        this.persistSuspendedIntent(intent.conversationId, 'reconcile-failed');
        continue;
      }
      const input = parsed.data;
      if (!input.tmuxSessionName || !tmuxActivity.has(input.tmuxSessionName)) {
        this.persistSuspendedIntent(intent.conversationId, 'process-lost');
        continue;
      }
      const result = this.resumeSession(input);
      if (!result.success) {
        this.deps.logger.warn('TuiAgentsRuntime: failed to reconcile session intent', {
          conversationId: intent.conversationId,
          error: result.error,
        });
        this.persistSuspendedIntent(intent.conversationId, 'reconcile-failed');
      }
    }
  }

  async dispose(): Promise<void> {
    this.idleSweeper.dispose();
    await this.sessionsSource.dispose();
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
    const commandResult = await this.deps.agentHost.buildPromptCommand(config.input.providerId, {
      extraArgs: config.input.extraArgs,
      autoApprove: config.input.autoApprove ?? false,
      initialPrompt: isResuming ? undefined : config.input.initialPrompt,
      sessionId: config.input.conversationId,
      providerSessionId: config.input.sessionId ?? undefined,
      isResuming,
      model: config.input.model ?? '',
    });
    if (!commandResult.success) throw new Error(JSON.stringify(commandResult.error));
    const command = commandResult.data;

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

    const spawnSpec = this.spawnSpec(command, config.input);
    const pty = await this.registry.create(
      config.input.conversationId,
      {
        command: spawnSpec.command,
        args: spawnSpec.args,
        cwd: config.input.cwd,
        env: {
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
          TERM_PROGRAM: 'emdash',
          ...command.env,
          ...config.input.providerVars,
          ...this.hookEnv(config.input),
        },
        cols: config.input.cols,
        rows: config.input.rows,
      },
      {
        output: session.output,
        onData: () => {
          this.recordOutputActivity(config.input.conversationId);
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
          this.maybeRespawnAfterUnexpectedExit(session, config, info);
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

  private resolveProvider(providerId: string): Result<ResolvedTuiProvider, TuiStartSessionError> {
    const provider = this.deps.agentHost.resolveTuiProvider(providerId);
    if (provider) return ok(provider);
    return this.deps.agentHost.get(providerId)
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
    const activity = this.activity.get(state.conversationId)?.snapshot();
    const next: TuiSessionState = { ...state };
    if (activity?.lastInputAt !== null && activity?.lastInputAt !== undefined) {
      next.lastInputAt = activity.lastInputAt;
    }
    if (activity?.lastOutputAt !== null && activity?.lastOutputAt !== undefined) {
      next.lastOutputAt = activity.lastOutputAt;
    }
    this.sessionsList.states.list.produce((draft) => {
      draft[state.conversationId] = next;
    });
  }

  private syncSessionActivity(conversationId: string): void {
    const activity = this.activity.get(conversationId)?.snapshot();
    if (!activity) return;
    this.sessionsList.states.list.produce((draft) => {
      const current = draft[conversationId];
      if (!current) return;
      if (activity.lastInputAt !== null) current.lastInputAt = activity.lastInputAt;
      if (activity.lastOutputAt !== null) current.lastOutputAt = activity.lastOutputAt;
    });
  }

  private activityFor(conversationId: string): IoActivityTracker {
    let tracker = this.activity.get(conversationId);
    if (!tracker) {
      tracker = createIoActivityTracker(() => this.now());
      this.activity.set(conversationId, tracker);
    }
    return tracker;
  }

  private recordInputActivity(conversationId: string): void {
    this.activityFor(conversationId).recordInput();
    this.syncSessionActivity(conversationId);
  }

  private recordOutputActivity(conversationId: string): void {
    this.activityFor(conversationId).recordOutput();
    this.syncSessionActivity(conversationId);
  }

  private lifecycleSnapshot(conversationId: string): IoActivitySnapshot | null {
    const config = this.configs.get(conversationId);
    if (!config || config.intent === 'stopped') return null;
    const state = this.sessionsList.states.list.snapshot().data[conversationId];
    const activity = this.activityFor(conversationId).snapshot();
    const tmuxLastOutputAt = config.input.tmuxSessionName
      ? this.tmuxActivity.get(config.input.tmuxSessionName)
      : undefined;
    const lastOutputAt = maxNullable(activity.lastOutputAt, tmuxLastOutputAt);
    return {
      running: state?.status === 'running',
      busy: lastOutputAt !== null && this.now() - lastOutputAt < BUSY_OUTPUT_WINDOW_MS,
      attachedClients: activity.attachedClients,
      detachedAt: activity.detachedAt,
      lastInputAt: activity.lastInputAt,
      lastOutputAt,
    };
  }

  private isSessionBusy(conversationId: string): boolean {
    return this.lifecycleSnapshot(conversationId)?.busy ?? false;
  }

  private now(): number {
    return this.deps.clock?.now() ?? Date.now();
  }

  private persistActiveIntent(input: TuiAgentStartInput): void {
    const { initialPrompt: _initialPrompt, ...persisted } = input;
    const sessionId = this.currentProviderSessionId(input.conversationId, input.sessionId);
    void this.deps.intents
      .saveActive({
        conversationId: input.conversationId,
        sessionId,
        payload: { ...persisted, sessionId } as unknown as Serializable,
      })
      .then((result) => {
        if (!result.success) {
          this.deps.logger.warn('TuiAgentsRuntime: failed to persist active intent', {
            conversationId: input.conversationId,
            error: result.error,
          });
        }
      });
  }

  private persistSuspendedIntent(conversationId: string, cause: string): void {
    void this.deps.intents.markSuspended(conversationId, cause).then((result) => {
      if (!result.success) {
        this.deps.logger.warn('TuiAgentsRuntime: failed to persist suspended intent', {
          conversationId,
          error: result.error,
        });
      }
    });
  }

  private removePersistedIntent(conversationId: string): void {
    void this.deps.intents.remove(conversationId).then((result) => {
      if (!result.success) {
        this.deps.logger.warn('TuiAgentsRuntime: failed to remove session intent', {
          conversationId,
          error: result.error,
        });
      }
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

  private spawnSpec(
    command: AgentCommand,
    input: TuiAgentStartInput
  ): Pick<PtySpawnSpec, 'command' | 'args'> {
    if (!input.shellSetup && !input.tmuxSessionName) {
      return { command: command.command, args: command.args };
    }

    const commandLine = [command.command, ...command.args].map(quoteShellArg).join(' ');
    const fullCommandLine = input.shellSetup
      ? `${input.shellSetup} && ${commandLine}`
      : commandLine;
    return {
      command: '/bin/sh',
      args: [
        '-c',
        input.tmuxSessionName
          ? buildTmuxShellLine(input.tmuxSessionName, fullCommandLine)
          : fullCommandLine,
      ],
    };
  }

  private maybeRespawnAfterUnexpectedExit(
    session: TuiAgentSession,
    config: TuiSessionConfig,
    info: PtyExitInfo
  ): void {
    if (config.input.tmuxSessionName || config.intent === 'stopped') return;
    if (!this.isUnexpectedExit(info)) return;
    const current = this.configs.get(config.input.conversationId);
    if (!current || current.intent === 'stopped') return;

    const attempts = this.unexpectedRespawns.get(config.input.conversationId) ?? 0;
    if (attempts >= MAX_UNEXPECTED_RESPAWNS) return;
    this.unexpectedRespawns.set(config.input.conversationId, attempts + 1);
    setTimeout(() => {
      const active = this.sessionsSource.peek({ conversationId: config.input.conversationId });
      const latest = this.configs.get(config.input.conversationId);
      if (!active || active !== session || active.pty || !latest || latest.intent === 'stopped') {
        return;
      }
      void this.spawnInto(active, latest);
    }, RESPAWN_DELAY_MS);
  }

  private isUnexpectedExit(info: PtyExitInfo): boolean {
    return info.exitCode !== 0 || info.signal !== null;
  }

  private async killTmuxForConfig(config: TuiSessionConfig | undefined): Promise<void> {
    const sessionName = config?.input.tmuxSessionName;
    if (!sessionName) return;
    await killTmuxSession(this.deps.exec, sessionName, (error) => {
      this.deps.logger.debug('TuiAgentsRuntime: tmux session not found or already stopped', {
        sessionName,
        error: String(error),
      });
    });
  }
}

function maxNullable(a: number | null, b: number | null | undefined): number | null {
  if (a === null) return b ?? null;
  if (b === null || b === undefined) return a;
  return Math.max(a, b);
}
