import { err, ok, type Result, type Serializable } from '@emdash/shared';
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
import { KeyedMutex } from '@primitives/lib/api/keyed-mutex';
import type {
  TuiAgentStartInput,
  TuiInputError,
  TuiResumeOutcome,
  TuiResumeSessionError,
  TuiSessionControlError,
  TuiSessionState,
  TuiStartOutcome,
  TuiStartSessionError,
} from '@runtimes/tui-agents/api';
import { persistedTuiAgentStartInputSchema } from '@runtimes/tui-agents/api';
import { TuiHookInstaller } from '@runtimes/tui-agents/node/hooks/hook-installer';
import { TuiHookPipeline } from '@runtimes/tui-agents/node/hooks/hook-pipeline';
import { TuiHookServer } from '@runtimes/tui-agents/node/hooks/hook-server';
import {
  createTuiAgentStatesLiveHost,
  createTuiAgentStatesListModel,
  createTuiSessionsLiveHost,
  createTuiSessionsListModel,
  type TuiAgentStatesLiveHost,
  type TuiAgentStatesListModel,
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
import { TuiAgentStates } from './agent-state';
import type { TuiAgentsRuntimeDeps, TuiSessionConfig } from './types';

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
  private readonly launchMutex = new KeyedMutex();
  private readonly sessions = new Map<string, TuiAgentSession>();
  private readonly logs = new Map<string, LiveLog>();
  private readonly configs = new Map<string, TuiSessionConfig>();
  private readonly generations = new Map<string, number>();
  private readonly sessionsHost: TuiSessionsLiveHost;
  private readonly agentStatesHost: TuiAgentStatesLiveHost;
  private readonly sessionsList: TuiSessionsListModel;
  private readonly agentStatesList: TuiAgentStatesListModel;
  private readonly agentStates: TuiAgentStates;
  private readonly hookInstaller: TuiHookInstaller;
  private readonly hookServer: TuiHookServer;
  private readonly hookPipeline: TuiHookPipeline;
  private readonly sessionIdlePolicy: IdlePolicy;
  private readonly idleSweeper: IdleSweeper;
  private readonly activity = new Map<string, IoActivityTracker>();
  private tmuxActivity = new Map<string, number>();
  private readonly unexpectedRespawns = new Map<string, number>();

  constructor(private readonly deps: TuiAgentsRuntimeDeps) {
    this.registry = new PtyRegistry(deps.spawner);
    this.sessionsHost = createTuiSessionsLiveHost();
    this.agentStatesHost = createTuiAgentStatesLiveHost();
    this.sessionsList = createTuiSessionsListModel(this.sessionsHost);
    this.agentStatesList = createTuiAgentStatesListModel(this.agentStatesHost);
    this.agentStates = new TuiAgentStates(
      this.sessionsList,
      this.agentStatesList,
      (conversationId) => {
        const config = this.configs.get(conversationId);
        if (config) this.persistActiveIntent(config.input);
      },
      (conversationId) => {
        const config = this.configs.get(conversationId);
        if (config) this.persistActiveIntent(config.input);
      }
    );
    this.hookInstaller = new TuiHookInstaller({ agentHost: deps.agentHost, logger: deps.logger });
    this.hookPipeline = new TuiHookPipeline({
      getConversationConfig: (conversationId) => {
        const config = this.configs.get(conversationId);
        if (!config) return null;
        return {
          conversationId,
          providerId: config.input.providerId,
        };
      },
      getProvider: (providerId) => this.deps.agentHost.resolveTuiProvider(providerId),
      applyCanonicalEvent: (conversationId, providerId, event) =>
        this.agentStates.applyCanonicalEvent(conversationId, providerId, event),
      logger: deps.logger,
    });
    this.hookServer = new TuiHookServer((raw) => this.hookPipeline.handle(raw), deps.logger);
    this.sessionIdlePolicy = compileIdlePolicy(
      deps.lifecycle?.session ?? { kind: 'idle-after', outputMs: DEFAULT_SESSION_IDLE_MS }
    );
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

  async startSession(
    input: TuiAgentStartInput
  ): Promise<Result<{ outcome: TuiStartOutcome }, TuiStartSessionError>> {
    const provider = this.resolveProvider(input.providerId);
    if (!provider.success) return err(provider.error);

    return this.launchMutex.runExclusive(input.conversationId, async () => {
      const active = this.sessions.get(input.conversationId);
      if (active?.pty) return ok({ outcome: 'attached' });

      const config: TuiSessionConfig = { input, intent: 'fresh' };
      this.configs.set(input.conversationId, config);
      this.recordInputActivity(input.conversationId);
      this.unexpectedRespawns.delete(input.conversationId);

      const generation = this.bumpGeneration(input.conversationId);
      const result = await this.spawnInto(
        this.sessionFor(input.conversationId),
        config,
        generation
      );
      if (!result.success) return result;

      this.persistActiveIntent(input);
      return ok({ outcome: 'started' });
    });
  }

  async resumeSession(
    input: TuiAgentStartInput
  ): Promise<Result<{ outcome: TuiResumeOutcome }, TuiResumeSessionError>> {
    const provider = this.resolveProvider(input.providerId);
    if (!provider.success) return err(provider.error);

    return this.launchMutex.runExclusive(input.conversationId, async () => {
      const active = this.sessions.get(input.conversationId);
      if (active?.pty) return ok({ outcome: 'attached' });

      const intent = input.sessionId ? 'resume' : 'fresh';
      const config: TuiSessionConfig = { input, intent };
      this.configs.set(input.conversationId, config);
      this.recordInputActivity(input.conversationId);
      this.unexpectedRespawns.delete(input.conversationId);
      this.setResumeState(input.conversationId, {
        requested: true,
        outcome: input.sessionId ? 'pending' : 'fresh-fallback',
        reason: input.sessionId ? undefined : 'missing-provider-session-id',
      });

      const generation = this.bumpGeneration(input.conversationId);
      const result = await this.spawnInto(
        this.sessionFor(input.conversationId),
        config,
        generation
      );
      if (!result.success) return result;

      this.persistActiveIntent(input);
      return ok({ outcome: input.sessionId ? 'resumed' : 'fresh-fallback' });
    });
  }

  stopSession(conversationId: string): Result<void, TuiSessionControlError> {
    this.bumpGeneration(conversationId);
    const config = this.configs.get(conversationId);
    if (config) this.configs.set(conversationId, { ...config, intent: 'stopped' });
    this.unexpectedRespawns.delete(conversationId);
    void this.killTmuxForConfig(config);
    this.registry.dispose(conversationId);
    const active = this.sessions.get(conversationId);
    if (active) active.pty = null;
    this.markExited(conversationId, null);
    this.agentStates.resetToIdle(conversationId);
    this.persistSuspendedIntent(conversationId, 'user');
    return ok(undefined);
  }

  deleteSession(conversationId: string): Result<void, TuiSessionControlError> {
    this.bumpGeneration(conversationId);
    const config = this.configs.get(conversationId);
    this.unexpectedRespawns.delete(conversationId);
    void this.killTmuxForConfig(config);
    this.registry.dispose(conversationId);
    this.configs.delete(conversationId);
    this.logs.delete(conversationId);
    const active = this.sessions.get(conversationId);
    active?.output.reseed();
    this.sessions.delete(conversationId);
    this.sessionsList.states.list.produce((draft) => {
      delete draft[conversationId];
    });
    this.agentStates.clear(conversationId);
    this.removePersistedIntent(conversationId);
    return ok(undefined);
  }

  deactivateSession(conversationId: string, cause: string): Result<void, TuiSessionControlError> {
    const config = this.configs.get(conversationId);
    if (!config || config.intent === 'stopped') return ok(undefined);
    if (cause === 'idle' && this.isSessionBusy(conversationId)) return ok(undefined);
    this.bumpGeneration(conversationId);
    this.unexpectedRespawns.delete(conversationId);
    void this.killTmuxForConfig(config);
    this.registry.dispose(conversationId);
    this.configs.delete(conversationId);
    this.logs.delete(conversationId);
    this.activity.delete(conversationId);
    const active = this.sessions.get(conversationId);
    active?.output.reseed();
    this.sessions.delete(conversationId);
    this.sessionsList.states.list.produce((draft) => {
      delete draft[conversationId];
    });
    this.agentStates.clear(conversationId);
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
    const active = this.sessions.get(conversationId);
    if (!active?.pty) return err({ type: 'not-found', conversationId });
    active.pty.write(data);
    this.recordInputActivity(conversationId);
    this.agentStates.markInputSubmitted(conversationId, active.provider, data);
    return ok(undefined);
  }

  resize(conversationId: string, cols: number, rows: number): Result<void, TuiInputError> {
    const active = this.sessions.get(conversationId);
    if (!active?.pty) return err({ type: 'not-found', conversationId });
    active.pty.resize(cols, rows);
    this.updateSessionSize(conversationId, cols, rows);
    return ok(undefined);
  }

  outputLog(key: { conversationId: string }): LiveSource {
    return {
      snapshot: async () => this.logFor(key.conversationId).snapshot(),
      subscribe: (cb) => {
        const tracker = this.activityFor(key.conversationId);
        tracker.attach();
        const unsubscribe = this.logFor(key.conversationId).subscribe(cb);
        return () => {
          tracker.detach();
          this.syncSessionActivity(key.conversationId);
          unsubscribe();
        };
      },
    };
  }

  sessionsLiveHost(): TuiSessionsLiveHost {
    return this.sessionsHost;
  }

  agentStatesLiveHost(): TuiAgentStatesLiveHost {
    return this.agentStatesHost;
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
      const parsed = persistedTuiAgentStartInputSchema.safeParse(intent.payload);
      if (!parsed.success) {
        this.persistSuspendedIntent(intent.conversationId, 'reconcile-failed');
        continue;
      }
      const input = parsed.data;
      if (input.lastAgentState) {
        this.agentStates.restore(input.lastAgentState);
      }
      if (!input.tmuxSessionName || !tmuxActivity.has(input.tmuxSessionName)) {
        this.persistSuspendedIntent(intent.conversationId, 'process-lost');
        continue;
      }
      const result = await this.resumeSession(input);
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
    for (const conversationId of this.sessions.keys()) {
      this.bumpGeneration(conversationId);
    }
    this.registry.killAll();
    this.hookServer.stop();
    this.sessions.clear();
    this.logs.clear();
    this.configs.clear();
  }

  private async spawnInto(
    session: TuiAgentSession,
    config: TuiSessionConfig,
    generation: number
  ): Promise<Result<void, TuiStartSessionError>> {
    const providerResult = this.resolveProvider(config.input.providerId);
    if (!providerResult.success) return err(providerResult.error);

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

    const commandResult = await this.deps.agentHost.buildPromptCommand(config.input.providerId, {
      extraArgs: config.input.extraArgs,
      autoApprove: config.input.autoApprove ?? false,
      initialPrompt: isResuming ? undefined : config.input.initialPrompt,
      sessionId: config.input.conversationId,
      providerSessionId: config.input.sessionId ?? undefined,
      isResuming,
      model: config.input.model ?? '',
    });
    if (!this.isCurrentGeneration(config.input.conversationId, generation)) {
      return this.cancelledSpawn(config.input.conversationId);
    }
    if (!commandResult.success) {
      const message = JSON.stringify(commandResult.error);
      this.markSpawnFailed(config, resumeState, startedAt, message);
      return err({ type: 'spawn-failed', conversationId: config.input.conversationId, message });
    }
    const command = commandResult.data;
    const hookEnv = await this.prepareHookEnv(config.input);
    if (!this.isCurrentGeneration(config.input.conversationId, generation)) {
      return this.cancelledSpawn(config.input.conversationId);
    }

    const spawnSpec = this.spawnSpec(command, config.input);
    let pty: PtySession;
    try {
      pty = await this.registry.create(
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
            ...hookEnv,
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
            if (!this.isCurrentGeneration(config.input.conversationId, generation)) return;
            if (session.pty === pty) session.pty = null;
            if (isResuming && Date.now() - startedAt <= RESUME_FALLBACK_WINDOW_MS) {
              this.setResumeState(config.input.conversationId, {
                requested: true,
                outcome: 'fresh-fallback',
                reason: 'resume-process-exited-early',
              });
              const nextConfig: TuiSessionConfig = { input: config.input, intent: 'fresh' };
              this.configs.set(config.input.conversationId, nextConfig);
              void this.launchCurrentConfig(config.input.conversationId);
              return;
            }
            this.markExited(config.input.conversationId, info);
            this.agentStates.resetToIdle(config.input.conversationId);
            if (!this.maybeRespawnAfterUnexpectedExit(session, config, generation, info)) {
              this.persistSuspendedIntent(config.input.conversationId, 'process-exited');
            }
          },
          onStateChange: () => {
            if (!this.isCurrentGeneration(config.input.conversationId, generation)) return;
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
    } catch (error) {
      const message = String(error);
      this.markSpawnFailed(config, resumeState, startedAt, message);
      return err({ type: 'spawn-failed', conversationId: config.input.conversationId, message });
    }

    if (!this.isCurrentGeneration(config.input.conversationId, generation)) {
      pty.kill();
      return this.cancelledSpawn(config.input.conversationId);
    }

    session.pty = pty;
    if (!isResuming) {
      this.agentStates.markInitialPromptSubmitted(
        config.input.conversationId,
        config.input.providerId,
        provider,
        config.input.initialPrompt
      );
    }
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
    return ok(undefined);
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

  private sessionFor(conversationId: string): TuiAgentSession {
    let session = this.sessions.get(conversationId);
    if (!session) {
      session = this.createRetainedSession(conversationId);
      this.sessions.set(conversationId, session);
    }
    return session;
  }

  private bumpGeneration(conversationId: string): number {
    const next = (this.generations.get(conversationId) ?? 0) + 1;
    this.generations.set(conversationId, next);
    return next;
  }

  private isCurrentGeneration(conversationId: string, generation: number): boolean {
    return this.generations.get(conversationId) === generation;
  }

  private cancelledSpawn(conversationId: string): Result<void, TuiStartSessionError> {
    return err({
      type: 'spawn-failed',
      conversationId,
      message: 'Launch was cancelled by a newer session operation',
    });
  }

  private markSpawnFailed(
    config: TuiSessionConfig,
    resume: TuiSessionState['resume'],
    startedAt: number,
    message: string
  ): void {
    this.syncSessionState({
      conversationId: config.input.conversationId,
      providerId: config.input.providerId,
      sessionId: config.input.sessionId,
      status: 'exited',
      cols: config.input.cols,
      rows: config.input.rows,
      resume,
      startedAt,
      exit: { exitCode: null, signal: 'spawn-failed' },
    });
    this.deps.logger.warn('TuiAgentsRuntime: failed to spawn session', {
      conversationId: config.input.conversationId,
      providerId: config.input.providerId,
      message,
    });
  }

  private async launchCurrentConfig(conversationId: string): Promise<void> {
    await this.launchMutex.runExclusive(conversationId, async () => {
      const session = this.sessions.get(conversationId);
      const config = this.configs.get(conversationId);
      if (!session || session.pty || !config || config.intent === 'stopped') return;

      const generation = this.bumpGeneration(conversationId);
      const result = await this.spawnInto(session, config, generation);
      if (result.success) {
        this.persistActiveIntent(config.input);
        return;
      }

      this.persistSuspendedIntent(conversationId, 'spawn-failed');
      this.deps.logger.warn('TuiAgentsRuntime: respawn/fallback failed', {
        conversationId,
        error: result.error,
      });
    });
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

  private async prepareHookEnv(input: TuiAgentStartInput): Promise<Record<string, string>> {
    const hooksAvailable = await this.hookInstaller.ensureHooksInstalled({
      providerId: input.providerId,
      workspacePath: input.cwd,
      policy: input.hookInstall ?? this.deps.hookInstall,
    });
    if (!hooksAvailable) return {};

    let hook;
    try {
      hook = await this.hookServer.ensureStarted();
    } catch (error) {
      this.deps.logger.warn('TuiAgentsRuntime: hook server unavailable; spawning without hooks', {
        conversationId: input.conversationId,
        providerId: input.providerId,
        error: String(error),
      });
      return {};
    }

    return {
      EMDASH_HOOK_PORT: String(hook.port),
      EMDASH_PTY_ID: input.conversationId,
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
    const lastAgentState = this.agentStates.current(input.conversationId);
    void this.deps.intents
      .saveActive({
        conversationId: input.conversationId,
        sessionId,
        payload: { ...persisted, sessionId, lastAgentState } as unknown as Serializable,
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
    generation: number,
    info: PtyExitInfo
  ): boolean {
    if (config.input.tmuxSessionName || config.intent === 'stopped') return false;
    if (!this.isUnexpectedExit(info)) return false;
    const current = this.configs.get(config.input.conversationId);
    if (!current || current.intent === 'stopped') return false;

    const attempts = this.unexpectedRespawns.get(config.input.conversationId) ?? 0;
    if (attempts >= MAX_UNEXPECTED_RESPAWNS) return false;
    this.unexpectedRespawns.set(config.input.conversationId, attempts + 1);
    setTimeout(() => {
      if (!this.isCurrentGeneration(config.input.conversationId, generation)) return;
      const active = this.sessions.get(config.input.conversationId);
      const latest = this.configs.get(config.input.conversationId);
      if (!active || active !== session || active.pty || !latest || latest.intent === 'stopped') {
        return;
      }
      void this.launchCurrentConfig(config.input.conversationId);
    }, RESPAWN_DELAY_MS);
    return true;
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
