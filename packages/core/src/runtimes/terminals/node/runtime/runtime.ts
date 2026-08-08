import { err, ok, type Result } from '@emdash/shared';
import { createScope, type Scope } from '@emdash/shared/concurrency';
import { noopLogger, type Logger } from '@emdash/shared/logger';
import type { Clock } from '@emdash/shared/scheduling';
import { LiveLogSource, type LiveJobContext } from '@emdash/wire/live';
import { type LeasedLiveModelProvider, type LiveSource } from '@emdash/wire/rpc';
import { cell, expose, family, peek, type Cell } from '@emdash/wire/state';
import type { IExecutionContext } from '#primitives/exec/api';
import {
  compileIdlePolicy,
  createIdleSweeper,
  createIoActivityTracker,
  type IdlePolicy,
  type IdlePolicyConfig,
  type IdleSweeper,
  type IoActivitySnapshot,
  type IoActivityTracker,
} from '#primitives/io-activity/api';
import { resourceKeyFromFileRef, type HostFileRef } from '#primitives/path/api';
import type {
  ResolvedShellProfile,
  TerminalShellAvailability,
  TerminalShellId,
  TerminalShellResolver,
} from '#primitives/terminal-shell/api';
import {
  createWorkflow,
  type Workflow,
  type WorkflowCompileError,
  type WorkflowError,
  type WorkflowNodeDefinition,
  type WorkflowState,
} from '#primitives/workflow/api';
import {
  terminalsContract,
  type KillTmuxSessionsInput,
  type ScriptNodeState,
  type ScriptWorkflowState,
  type ShellAvailabilityFailedError,
  type StartTerminalInput,
  type StartTerminalSpec,
  type TerminalDevServer,
  type TerminalKey,
  type TerminalNotFoundError,
  type TerminalRuntimeError,
  type TerminalSessionState,
  type TerminalStartFailedError,
} from '#runtimes/terminals/api';
import {
  wireTerminalUrlDetector,
  type DetectedPreviewUrl,
  type TerminalPortProbe,
} from '#runtimes/terminals/node/preview/url-detector';
import {
  buildTerminalEnv,
  killTmuxSession,
  makeTmuxSessionName,
  resolveLocalPtySpawn,
  PtyRegistry,
  type PtySession,
  type PtySpawner,
} from '#services/pty/api';
import {
  scriptWorkflowErrorSchema,
  type RunScriptWorkflowInput,
  type ScriptNode,
  type ScriptWorkflowError,
  type ScriptWorkflowProgress,
  type ScriptWorkflowResult,
  type TerminalExit,
} from '#services/script-workflows/api';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const OUTPUT_TAIL_CAP = 16 * 1024;

type WorkflowCell = Cell<ScriptWorkflowState | null>;
type SessionsCell = Cell<Record<string, TerminalSessionState>>;
type DevServersCell = Cell<Record<string, TerminalDevServer>>;

type ActiveWorkflow = {
  scopeKey: string;
  kind: string;
  workflowId: string;
  result: Promise<Result<ScriptWorkflowResult, ScriptWorkflowError>>;
};

type WorkflowRunContext = {
  workflowId: string;
  kind: string;
  workspace: HostFileRef;
  inputNodes: Map<string, ScriptNode>;
  nodeExits: Map<string, TerminalExit>;
  nodePids: Map<string, number>;
  startedAt: number;
  finishedAt?: number;
};

type SessionKind = 'workflow' | 'terminal';

type InteractiveTerminalConfig = {
  key: TerminalKey;
  spec: StartTerminalSpec;
};

type PreviewOutputSource = {
  emitData(chunk: string): void;
  emitExit(): void;
  dispose(): void;
};

export type TerminalsRuntimeOptions = {
  spawner: PtySpawner;
  exec?: IExecutionContext;
  scope?: Scope;
  now?: () => number;
  clock?: Clock;
  portProbe?: TerminalPortProbe;
  lifecycle?: TerminalsRuntimeLifecycleOptions;
  shellResolver?: TerminalShellResolver;
  logger?: Logger;
};

export type TerminalsRuntimeLifecycleOptions = {
  terminal?: IdlePolicyConfig;
  backgroundScript?: IdlePolicyConfig;
  sweepIntervalMs?: number;
};

export class TerminalsRuntime {
  private readonly workflowStates = family<{ workspace: HostFileRef }, WorkflowCell>(
    () => cell<ScriptWorkflowState | null>(null),
    { name: 'terminal-workflow-states' }
  );
  private readonly sessionsList: SessionsCell = cell({});
  private readonly devServersList: DevServersCell = cell({});
  readonly workflowsHost: LeasedLiveModelProvider<typeof terminalsContract.workflows> = expose(
    terminalsContract.workflows,
    {
      state: (key, scope) => {
        scope.add(this.workflowStates.retain(key));
        return this.workflowStates(key);
      },
    }
  );
  readonly sessionsHost: LeasedLiveModelProvider<typeof terminalsContract.sessions> = expose(
    terminalsContract.sessions,
    { list: this.sessionsList },
    { publish: { list: 'diff' } }
  );
  readonly devServersHost: LeasedLiveModelProvider<typeof terminalsContract.devServers> = expose(
    terminalsContract.devServers,
    { list: this.devServersList },
    { publish: { list: 'diff' } }
  );

  private readonly registry: PtyRegistry;
  private readonly exec: IExecutionContext | undefined;
  private readonly scope: Scope;
  private readonly now: () => number;
  private readonly clock: Clock | undefined;
  private readonly portProbe: TerminalPortProbe | undefined;
  private readonly shellResolver: TerminalShellResolver | undefined;
  private readonly logger: Logger;
  private readonly terminalIdlePolicy: IdlePolicy;
  private readonly backgroundScriptIdlePolicy: IdlePolicy;
  private readonly completableScriptIdlePolicy: IdlePolicy;
  private readonly idleSweeper: IdleSweeper;
  private readonly logs = new Map<string, LiveLogSource>();
  private readonly activity = new Map<string, IoActivityTracker>();
  private readonly activeWorkflows = new Map<string, ActiveWorkflow>();
  private readonly workflowBindings = new Map<string, { sync(): void; dispose(): void }>();
  private readonly workflowRuns = new Map<string, WorkflowRunContext>();
  private readonly sessionKeys = new Map<string, TerminalKey>();
  private readonly sessionKinds = new Map<string, SessionKind>();
  private readonly scriptNodeLifecycles = new Map<string, ScriptNode['lifecycle']>();
  private readonly interactiveConfigs = new Map<string, InteractiveTerminalConfig>();
  private readonly outputTails = new Map<string, string>();
  private readonly startCounts = new Map<string, number>();
  private readonly previewSources = new Map<string, PreviewOutputSource>();

  constructor(options: TerminalsRuntimeOptions) {
    this.registry = new PtyRegistry(options.spawner, {
      onSessionChanged: (key, session) => this.syncSession(key, session),
    });
    this.exec = options.exec;
    this.scope = options.scope ?? createScope({ label: 'terminals-runtime' });
    this.clock = options.clock;
    this.now = options.now ?? options.clock?.now.bind(options.clock) ?? Date.now;
    this.portProbe = options.portProbe;
    this.shellResolver = options.shellResolver;
    this.logger = options.logger ?? noopLogger;
    this.terminalIdlePolicy = compileIdlePolicy(options.lifecycle?.terminal ?? { kind: 'always' });
    this.backgroundScriptIdlePolicy = compileIdlePolicy(
      options.lifecycle?.backgroundScript ?? { kind: 'always' }
    );
    this.completableScriptIdlePolicy = compileIdlePolicy({ kind: 'until-complete' });
    this.idleSweeper = createIdleSweeper<string>({
      ...(this.clock ? { clock: this.clock } : {}),
      scope: this.scope,
      intervalMs: options.lifecycle?.sweepIntervalMs ?? 60_000,
      entries: () => Object.keys(peek(this.sessionsList)),
      snapshot: (sessionKey) => this.lifecycleSnapshot(sessionKey),
      policy: (sessionKey) => this.policyForSession(sessionKey),
      deactivate: async (sessionKey) => {
        const key = this.sessionKeys.get(sessionKey);
        if (!key) return;
        await this.kill(key);
      },
    });
    this.scope.add(() => this.dispose());
  }

  async start(input: StartTerminalInput): Promise<Result<void, TerminalStartFailedError>> {
    const sessionKey = sessionKeyFor(input.key);
    const existing = this.registry.get(sessionKey);
    if (existing && !existing.exited) return ok(undefined);

    this.sessionKeys.set(sessionKey, input.key);
    this.sessionKinds.set(sessionKey, 'terminal');
    this.interactiveConfigs.set(sessionKey, { key: input.key, spec: input.spec });

    try {
      await this.spawnInteractiveTerminal(sessionKey, input.key, input.spec);
      return ok(undefined);
    } catch (error) {
      return err({
        type: 'terminal-start-failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async getShellAvailability(): Promise<
    Result<TerminalShellAvailability[], ShellAvailabilityFailedError>
  > {
    if (!this.shellResolver) {
      return err({
        type: 'shell-availability-failed',
        message: 'No shell resolver is configured for this terminals runtime',
      });
    }
    try {
      return ok(await this.shellResolver.getAvailability());
    } catch (error) {
      return err({
        type: 'shell-availability-failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async runWorkflow(
    input: RunScriptWorkflowInput,
    ctx: LiveJobContext<ScriptWorkflowProgress>
  ): Promise<Result<ScriptWorkflowResult, ScriptWorkflowError>> {
    const scopeKey = scopeKeyFor(input.workspace);
    const active = this.activeWorkflows.get(scopeKey);
    if (active) {
      if (active.kind !== input.kind) {
        return err({
          type: 'workflow-in-flight',
          message: `Workflow '${active.kind}' is already running for this workspace`,
        });
      }
      return await active.result;
    }

    const result = this.startWorkflow(input, ctx, scopeKey);
    this.activeWorkflows.set(scopeKey, {
      scopeKey,
      kind: input.kind,
      workflowId: ctx.jobId,
      result,
    });
    try {
      return await result;
    } finally {
      const current = this.activeWorkflows.get(scopeKey);
      if (current?.workflowId === ctx.jobId) this.activeWorkflows.delete(scopeKey);
    }
  }

  outputLog(key: TerminalKey): LiveSource {
    const source = this.logFor(key);
    const tracker = this.activityFor(sessionKeyFor(key));
    return {
      snapshot: () => source.snapshot(),
      subscribe: (cb) => {
        tracker.attach();
        const unsubscribe = source.subscribe(cb);
        return () => {
          unsubscribe();
          tracker.detach();
        };
      },
    };
  }

  sendInput(key: TerminalKey, data: string): Result<void, TerminalNotFoundError> {
    const sessionKey = sessionKeyFor(key);
    if (!this.registry.write(sessionKey, data)) {
      return err({ type: 'not-found', message: `Terminal session '${key.id}' is not running` });
    }
    this.activityFor(sessionKey).recordInput();
    return ok(undefined);
  }

  resize(key: TerminalKey, cols: number, rows: number): Result<void, TerminalNotFoundError> {
    const sessionKey = sessionKeyFor(key);
    if (!this.registry.resize(sessionKey, cols, rows)) {
      return err({ type: 'not-found', message: `Terminal session '${key.id}' is not running` });
    }
    this.sessionsList.update((previous) => {
      const session = previous[sessionKey];
      if (!session) return previous;
      return {
        ...previous,
        [sessionKey]: { ...session, cols, rows },
      };
    });
    return ok(undefined);
  }

  async kill(key: TerminalKey): Promise<Result<void, TerminalNotFoundError>> {
    const sessionKey = sessionKeyFor(key);
    if (!this.registry.kill(sessionKey)) {
      return err({ type: 'not-found', message: `Terminal session '${key.id}' is not running` });
    }
    this.closePreviewSource(sessionKey);
    await this.killTmuxForSession(sessionKey);
    return ok(undefined);
  }

  async killTmuxSessions(
    input: KillTmuxSessionsInput
  ): Promise<Result<void, TerminalRuntimeError>> {
    if (process.platform === 'win32' || !this.exec) return ok(undefined);
    for (const name of input.sessionNames) {
      await killTmuxSession(this.exec, name);
    }
    return ok(undefined);
  }

  dispose(): void {
    this.idleSweeper.dispose();
    for (const binding of this.workflowBindings.values()) binding.dispose();
    this.workflowBindings.clear();
    this.workflowRuns.clear();
    this.registry.killAll();
    this.logs.clear();
    for (const source of this.previewSources.values()) source.dispose();
    this.previewSources.clear();
    void this.workflowsHost.dispose();
    void this.sessionsHost.dispose();
    void this.devServersHost.dispose();
    void this.workflowStates.dispose();
  }

  private async spawnInteractiveTerminal(
    sessionKey: string,
    key: TerminalKey,
    spec: StartTerminalSpec
  ): Promise<PtySession> {
    const log = this.logFor(key);
    const startCount = (this.startCounts.get(sessionKey) ?? 0) + 1;
    this.startCounts.set(sessionKey, startCount);
    this.sessionKeys.set(sessionKey, key);
    this.sessionKinds.set(sessionKey, 'terminal');

    const shellProfile = await this.resolveShellProfile(key, spec.shellIntent);
    const env = buildTerminalEnv({
      shellProfile,
      overrides: spec.env,
    });
    const resolved = resolveLocalPtySpawn({
      intent: {
        kind: 'interactive-shell',
        cwd: spec.cwd,
        shellProfile,
        shellSetup: spec.shellSetup,
        tmuxSessionName: spec.tmux ? makeTmuxSessionName(sessionKey) : undefined,
      },
      platform: process.platform,
      env,
    });

    return await this.registry.create(
      sessionKey,
      {
        command: resolved.command,
        args: resolved.args,
        cwd: resolved.cwd,
        env,
        cols: spec.cols ?? DEFAULT_COLS,
        rows: spec.rows ?? DEFAULT_ROWS,
      },
      {
        output: log,
        onData: (chunk) => {
          this.activityFor(sessionKey).recordOutput();
          this.outputTails.set(
            sessionKey,
            appendOutputTail(this.outputTails.get(sessionKey) ?? '', chunk)
          );
          this.previewSourceFor(sessionKey, key).emitData(chunk);
        },
        onExit: () => this.handleInteractiveExit(sessionKey),
      }
    );
  }

  private handleInteractiveExit(sessionKey: string): void {
    this.closePreviewSource(sessionKey);
  }

  private async resolveShellProfile(
    key: TerminalKey,
    intent: TerminalShellId | undefined
  ): Promise<ResolvedShellProfile | undefined> {
    if (!intent || !this.shellResolver) return undefined;
    return await this.shellResolver.resolveWithSystemFallback({
      intent,
      onFallback: (event) =>
        this.logger.warn('terminals: falling back to system shell', {
          terminalId: key.id,
          shell: event.shell,
          message: event.message,
        }),
    });
  }

  private async killTmuxForSession(sessionKey: string): Promise<void> {
    const config = this.interactiveConfigs.get(sessionKey);
    if (!config?.spec.tmux || process.platform === 'win32' || !this.exec) return;
    await killTmuxSession(this.exec, makeTmuxSessionName(sessionKey));
  }

  private startWorkflow(
    input: RunScriptWorkflowInput,
    ctx: LiveJobContext<ScriptWorkflowProgress>,
    scopeKey: string
  ): Promise<Result<ScriptWorkflowResult, ScriptWorkflowError>> {
    const runScope = this.scope.child(`workflow:${scopeKey}`);
    const inputNodes = new Map(input.nodes.map((node) => [node.id, node]));
    const run: WorkflowRunContext = {
      workflowId: ctx.jobId,
      kind: input.kind,
      workspace: input.workspace,
      inputNodes,
      nodeExits: new Map(),
      nodePids: new Map(),
      startedAt: this.now(),
    };
    this.workflowRuns.set(ctx.jobId, run);

    const workflow = createWorkflow({
      scope: runScope,
      signal: ctx.signal,
      nodes: input.nodes.map((node) => this.workflowNode(input, node, ctx, run)),
      onOutput: ({ nodeId, chunk }) =>
        this.logFor({ workspace: input.workspace, id: nodeId }).append(chunk),
    });
    if (!workflow.success) {
      const error = workflowCompileErrorToScriptWorkflowError(workflow.error);
      this.publishFailedWorkflow(input, run, error);
      return Promise.resolve(err(error));
    }

    this.bindWorkflow(input.workspace, workflow.data, run);
    return this.runAndFinalizeWorkflow(input, workflow.data, ctx, runScope, run);
  }

  private workflowNode(
    input: RunScriptWorkflowInput,
    node: ScriptNode,
    ctx: LiveJobContext<ScriptWorkflowProgress>,
    run: WorkflowRunContext
  ): WorkflowNodeDefinition {
    return {
      id: node.id,
      label: node.label,
      dependsOn: node.dependsOn,
      run: async (workflowCtx) => {
        workflowCtx.report({ message: node.label ?? node.id });
        ctx.progress({
          workflowId: ctx.jobId,
          kind: input.kind,
          runningNodeId: node.id,
          message: node.label ?? node.id,
        });
        const result = await this.runScriptNode(input.workspace, node, input, ctx.signal, run);
        if (!result.success) {
          return { status: 'failed', failure: 'permanent', error: result.error };
        }
        return { status: 'done', facts: { exit: result.data } };
      },
      fatal: true,
    };
  }

  private async runScriptNode(
    workspace: HostFileRef,
    node: ScriptNode,
    input: RunScriptWorkflowInput,
    signal: AbortSignal | undefined,
    run: WorkflowRunContext
  ): Promise<Result<TerminalExit, ScriptWorkflowError>> {
    const key = { workspace, id: node.id };
    const sessionKey = sessionKeyFor(key);
    const log = this.logFor(key);
    log.reseed();
    this.sessionKeys.set(sessionKey, key);
    this.sessionKinds.set(sessionKey, 'workflow');
    this.scriptNodeLifecycles.set(sessionKey, node.lifecycle ?? 'completable');
    this.startCounts.set(sessionKey, 1);
    let outputTail = '';
    let resolveExit: (exit: TerminalExit) => void;
    const exitPromise = new Promise<TerminalExit>((resolve) => {
      resolveExit = resolve;
    });

    const session = await this.registry.create(sessionKey, spawnSpecFor(node, input), {
      output: log,
      onProcess: (process) => {
        const pid = process.getPid?.();
        if (pid !== undefined) run.nodePids.set(node.id, pid);
      },
      onData: (chunk) => {
        this.activityFor(sessionKey).recordOutput();
        outputTail = appendOutputTail(outputTail, chunk);
        this.outputTails.set(sessionKey, outputTail);
        this.previewSourceFor(sessionKey, key).emitData(chunk);
      },
      onExit: (info) => {
        this.closePreviewSource(sessionKey);
        resolveExit({
          exitCode: info.exitCode,
          signal: info.signal,
          outputTail,
        });
      },
    });
    const abort = () => session.kill();
    signal?.addEventListener('abort', abort, { once: true });

    try {
      const exit = await exitPromise;
      run.nodeExits.set(node.id, exit);
      if (exit.exitCode === 0 && exit.signal === null) return ok(exit);
      return err({
        type: 'script-failed',
        nodeId: node.id,
        message:
          exit.signal !== null
            ? `${node.label ?? node.id} exited with signal ${exit.signal}`
            : `${node.label ?? node.id} exited with code ${exit.exitCode ?? 'unknown'}`,
      });
    } catch (error) {
      return err({
        type: 'script-failed',
        nodeId: node.id,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) session.kill();
    }
  }

  private async runAndFinalizeWorkflow(
    input: RunScriptWorkflowInput,
    workflow: Workflow,
    ctx: LiveJobContext<ScriptWorkflowProgress>,
    runScope: Scope,
    run: WorkflowRunContext
  ): Promise<Result<ScriptWorkflowResult, ScriptWorkflowError>> {
    try {
      const result = await workflow.run();
      run.finishedAt = this.now();
      this.bindingFor(ctx.jobId)?.sync();
      if (!result.success) return err(workflowErrorToScriptWorkflowError(result.error));
      return ok({
        workflowId: ctx.jobId,
        kind: input.kind,
        completedNodes: Object.keys(result.data.facts),
      });
    } finally {
      this.bindingFor(ctx.jobId)?.sync();
      this.bindingFor(ctx.jobId)?.dispose();
      this.workflowBindings.delete(ctx.jobId);
      this.workflowRuns.delete(ctx.jobId);
      workflow.dispose();
      void runScope.dispose();
    }
  }

  private bindWorkflow(workspace: HostFileRef, workflow: Workflow, run: WorkflowRunContext): void {
    const workflowCell = this.ensureWorkflowCell(workspace);
    const sync = () => workflowCell.set(projectWorkflowState(workflow.machine.current(), run));
    sync();
    const unsubscribe = workflow.machine.subscribe(() => sync());
    const binding = {
      sync,
      dispose: unsubscribe,
    };
    this.workflowBindings.set(run.workflowId, binding);
  }

  private bindingFor(workflowId: string): { sync(): void; dispose(): void } | undefined {
    return this.workflowBindings.get(workflowId);
  }

  private ensureWorkflowCell(workspace: HostFileRef): WorkflowCell {
    const key = { workspace };
    return this.workflowStates(key);
  }

  private publishFailedWorkflow(
    input: RunScriptWorkflowInput,
    run: WorkflowRunContext,
    error: ScriptWorkflowError
  ): void {
    run.finishedAt = this.now();
    this.ensureWorkflowCell(input.workspace).set({
      workflowId: run.workflowId,
      kind: input.kind,
      phase: 'failed',
      nodes: Object.fromEntries(
        input.nodes.map((node) => [
          node.id,
          {
            id: node.id,
            label: node.label,
            status: 'failed' as const,
            awaitingOn: [],
            error,
          },
        ])
      ),
      order: input.nodes.map((node) => node.id),
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      error,
    });
  }

  private logFor(key: TerminalKey): LiveLogSource {
    const id = sessionKeyFor(key);
    let log = this.logs.get(id);
    if (!log) {
      log = new LiveLogSource();
      this.logs.set(id, log);
    }
    return log;
  }

  private syncSession(key: string, session: PtySession | null): void {
    this.sessionsList.update((previous) => {
      if (!session) {
        this.closePreviewSource(key);
        const existing = previous[key];
        if (!existing) return previous;
        return {
          ...previous,
          [key]: {
            ...existing,
            status: 'exited',
            exitedAt: existing.exitedAt ?? this.now(),
          },
        };
      }
      const terminalKey = this.sessionKeys.get(key);
      if (!terminalKey) return previous;
      const exit = session.exitStatus ?? undefined;
      const existing = previous[key];
      const activity = this.activity.get(key)?.snapshot();
      const state: TerminalSessionState = {
        key: terminalKey,
        status: session.exited ? 'exited' : 'running',
        kind: this.sessionKinds.get(key) ?? 'workflow',
        startCount: this.startCounts.get(key) ?? existing?.startCount ?? 1,
        tmux: this.interactiveConfigs.get(key)?.spec.tmux,
        pid: session.getPid(),
        cols: session.spec.cols,
        rows: session.spec.rows,
        startedAt: session.startedAt,
        exitedAt: session.exited ? (existing?.exitedAt ?? this.now()) : undefined,
        lastInputAt: activity?.lastInputAt ?? existing?.lastInputAt,
        lastOutputAt: activity?.lastOutputAt ?? existing?.lastOutputAt,
        exit:
          exit !== undefined
            ? {
                exitCode: exit.exitCode,
                signal: exit.signal,
              }
            : undefined,
      };
      return {
        ...previous,
        [key]: state,
      };
    });
  }

  private activityFor(sessionKey: string): IoActivityTracker {
    let tracker = this.activity.get(sessionKey);
    if (!tracker) {
      tracker = createIoActivityTracker(this.now);
      this.activity.set(sessionKey, tracker);
    }
    return tracker;
  }

  private lifecycleSnapshot(sessionKey: string): IoActivitySnapshot | null {
    const session = peek(this.sessionsList)[sessionKey];
    if (!session || session.status !== 'running') return null;
    return {
      running: session.status === 'running',
      busy: false,
      ...this.activityFor(sessionKey).snapshot(),
    };
  }

  private policyForSession(sessionKey: string): IdlePolicy {
    if (this.sessionKinds.get(sessionKey) === 'terminal') {
      return this.terminalIdlePolicy;
    }
    return this.scriptNodeLifecycles.get(sessionKey) === 'background'
      ? this.backgroundScriptIdlePolicy
      : this.completableScriptIdlePolicy;
  }

  private previewSourceFor(sessionKey: string, key: TerminalKey): PreviewOutputSource {
    const existing = this.previewSources.get(sessionKey);
    if (existing) return existing;

    const dataHandlers: Array<(chunk: string) => void> = [];
    const exitHandlers: Array<() => void> = [];
    const stopDetector = wireTerminalUrlDetector({
      pty: {
        onData(handler) {
          dataHandlers.push(handler);
        },
        onExit(handler) {
          exitHandlers.push(handler);
        },
      },
      ...(this.portProbe ? { portProbe: this.portProbe } : {}),
      onDetected: (server) => this.upsertDevServer(sessionKey, key, server),
      onSourceClosed: (event) => {
        if (event.reason === 'local-probe-failed') {
          this.removeDevServer(sessionKey, event.server);
        } else {
          this.pruneDevServersForSession(sessionKey);
        }
      },
    });

    const source: PreviewOutputSource = {
      emitData(chunk) {
        for (const handler of dataHandlers) handler(chunk);
      },
      emitExit() {
        for (const handler of exitHandlers) handler();
      },
      dispose: stopDetector,
    };
    this.previewSources.set(sessionKey, source);
    return source;
  }

  private closePreviewSource(sessionKey: string): void {
    const source = this.previewSources.get(sessionKey);
    if (source) {
      source.emitExit();
      source.dispose();
      this.previewSources.delete(sessionKey);
    }
    this.pruneDevServersForSession(sessionKey);
  }

  private upsertDevServer(sessionKey: string, key: TerminalKey, server: DetectedPreviewUrl): void {
    const id = devServerKeyFor(sessionKey, server);
    const record: TerminalDevServer = {
      key,
      protocol: server.protocol,
      host: server.host,
      port: server.port,
      urlPath: server.urlPath,
      detectedAt: this.now(),
    };
    this.devServersList.update((previous) => ({
      ...previous,
      [id]: record,
    }));
  }

  private removeDevServer(sessionKey: string, server: DetectedPreviewUrl): void {
    const id = devServerKeyFor(sessionKey, server);
    this.devServersList.update((previous) => omitKey(previous, id));
  }

  private pruneDevServersForSession(sessionKey: string): void {
    const prefix = `${sessionKey}:`;
    this.devServersList.update((previous) =>
      Object.fromEntries(Object.entries(previous).filter(([id]) => !id.startsWith(prefix)))
    );
  }
}

function projectWorkflowState(state: WorkflowState, run: WorkflowRunContext): ScriptWorkflowState {
  return {
    workflowId: run.workflowId,
    kind: run.kind,
    phase: state.phase,
    nodes: Object.fromEntries(
      Object.entries(state.nodes).map(([id, node]) => {
        const input = run.inputNodes.get(id);
        const projected: ScriptNodeState = {
          id,
          label: node.label,
          status: node.status,
          awaitingOn: awaitingOn(id, state, run),
          attempt: node.attempt,
          pid: run.nodePids.get(id),
          progress: node.progress,
          exit: exitWithoutTail(run.nodeExits.get(id)),
          error: node.error ? workflowErrorToScriptWorkflowError(node.error) : undefined,
        };
        if (!projected.label && input?.label) projected.label = input.label;
        return [id, projected];
      })
    ),
    order: Object.keys(state.nodes),
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    error: state.error ? workflowErrorToScriptWorkflowError(state.error) : undefined,
  };
}

function awaitingOn(id: string, state: WorkflowState, run: WorkflowRunContext): string[] {
  if (state.nodes[id]?.status !== 'pending') return [];
  return (run.inputNodes.get(id)?.dependsOn ?? []).filter((dependency) => {
    return state.nodes[dependency]?.status !== 'done';
  });
}

function spawnSpecFor(node: ScriptNode, input: RunScriptWorkflowInput) {
  const command = fullCommand(node);
  if (process.platform === 'win32') {
    return {
      command: process.env.ComSpec ?? 'cmd.exe',
      args: ['/d', '/s', '/c', command],
      cwd: node.cwd,
      env: node.env,
      cols: input.cols ?? DEFAULT_COLS,
      rows: input.rows ?? DEFAULT_ROWS,
    };
  }
  return {
    command: process.env.SHELL ?? '/bin/sh',
    args: ['-lc', command],
    cwd: node.cwd,
    env: node.env,
    cols: input.cols ?? DEFAULT_COLS,
    rows: input.rows ?? DEFAULT_ROWS,
  };
}

function fullCommand(node: ScriptNode): string {
  return node.shellSetup ? `${node.shellSetup}\n${node.command}` : node.command;
}

function scopeKeyFor(workspace: HostFileRef): string {
  return resourceKeyFromFileRef(workspace);
}

function sessionKeyFor(key: TerminalKey): string {
  return `${scopeKeyFor(key.workspace)}:${key.id}`;
}

function devServerKeyFor(sessionKey: string, server: DetectedPreviewUrl): string {
  return `${sessionKey}:${server.protocol}:${server.port}`;
}

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const { [key]: _removed, ...rest } = record;
  return rest;
}

function exitWithoutTail(exit: TerminalExit | undefined): TerminalSessionState['exit'] {
  if (!exit) return undefined;
  return {
    exitCode: exit.exitCode,
    signal: exit.signal,
  };
}

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

function workflowCompileErrorToScriptWorkflowError(
  error: WorkflowCompileError
): ScriptWorkflowError {
  return {
    type: 'workflow-compile-failed',
    message: error.message,
  };
}

/**
 * Maps the workflow primitive's open error `type` into the closed wire union: node
 * failures produced by this runtime are always 'script-failed', cancellation is
 * 'cancelled', and everything else (unexpected node throws, illegal machine
 * transitions) lands in the 'workflow-runtime-error' passthrough variant with the
 * original discriminant preserved.
 */
function workflowErrorToScriptWorkflowError(error: WorkflowError): ScriptWorkflowError {
  if (error.type === 'script-failed') {
    const nodeId = (error as { nodeId?: unknown }).nodeId;
    return {
      type: 'script-failed',
      message: error.message,
      ...(typeof nodeId === 'string' ? { nodeId } : {}),
    };
  }
  if (error.type === 'cancelled') {
    return { type: 'cancelled', message: error.message };
  }
  return {
    type: 'workflow-runtime-error',
    workflowErrorType: error.type,
    message: error.message,
    ...(error.resolutions ? { resolutions: error.resolutions } : {}),
  };
}

export function scriptWorkflowJobError(error: unknown): ScriptWorkflowError {
  const parsed = scriptWorkflowErrorSchema.safeParse(error);
  if (parsed.success) return parsed.data;
  return {
    type: 'workflow-runtime-error',
    message: error instanceof Error ? error.message : String(error),
  };
}
