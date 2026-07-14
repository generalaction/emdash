import { spawn } from 'node:child_process';
import { err, ok, type Result } from '@emdash/shared';
import { createScope, type Scope } from '@emdash/shared/concurrency';
import {
  bindMachineToLiveState,
  createLiveModelHost,
  LiveLog,
  type LiveJobContext,
  type LiveModelHost,
  type LiveSource,
} from '@emdash/wire';
import {
  createWorkflow,
  type Workflow,
  type WorkflowError,
  type WorkflowNodeDefinition,
  type WorkflowState,
} from '@primitives/workflow/api';
import { resourceKeyFromFileRef, type HostFileRef } from '@primitives/path/api';
import {
  terminalsContract,
  type RunScriptWorkflowInput,
  type ScriptNode,
  type ScriptNodeState,
  type ScriptWorkflowProgress,
  type ScriptWorkflowResult,
  type ScriptWorkflowState,
  type StartTerminalInput,
  type StartTerminalSpec,
  type TerminalError,
  type TerminalExit,
  type TerminalKey,
  type TerminalSessionState,
} from '@runtimes/terminals/api';
import {
  buildTerminalEnv,
  isUnexpectedPtyExit,
  makeTmuxSessionName,
  resolveLocalPtySpawn,
  type PtyExitInfo,
  PtyRegistry,
  type PtySession,
  type PtySpawner,
} from '@services/pty/api';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const OUTPUT_TAIL_CAP = 16 * 1024;
const MAX_UNEXPECTED_RESPAWNS = 2;
const RESPAWN_DELAY_MS = 500;

type WorkflowCell = ReturnType<
  LiveModelHost<typeof terminalsContract.workflows>['create']
>['states']['state'];
type SessionsCell = ReturnType<
  LiveModelHost<typeof terminalsContract.sessions>['create']
>['states']['list'];

type ActiveWorkflow = {
  scopeKey: string;
  kind: string;
  workflowId: string;
  result: Promise<Result<ScriptWorkflowResult, TerminalError>>;
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

export type TerminalsRuntimeOptions = {
  spawner: PtySpawner;
  scope?: Scope;
  now?: () => number;
};

export class TerminalsRuntime {
  readonly workflowsHost = createLiveModelHost(terminalsContract.workflows);
  readonly sessionsHost = createLiveModelHost(terminalsContract.sessions);

  private readonly registry: PtyRegistry;
  private readonly scope: Scope;
  private readonly now: () => number;
  private readonly logs = new Map<string, LiveLog>();
  private readonly sessionsList: SessionsCell;
  private readonly activeWorkflows = new Map<string, ActiveWorkflow>();
  private readonly workflowBindings = new Map<string, { sync(): void; dispose(): void }>();
  private readonly workflowRuns = new Map<string, WorkflowRunContext>();
  private readonly sessionKeys = new Map<string, TerminalKey>();
  private readonly sessionKinds = new Map<string, SessionKind>();
  private readonly interactiveConfigs = new Map<string, InteractiveTerminalConfig>();
  private readonly outputTails = new Map<string, string>();
  private readonly startCounts = new Map<string, number>();
  private readonly intentionalStops = new Set<string>();
  private readonly unexpectedRespawns = new Map<string, number>();

  constructor(options: TerminalsRuntimeOptions) {
    this.registry = new PtyRegistry(options.spawner, {
      onSessionChanged: (key, session) => this.syncSession(key, session),
    });
    this.scope = options.scope ?? createScope({ label: 'terminals-runtime' });
    this.now = options.now ?? Date.now;
    this.sessionsList = this.sessionsHost.create(undefined, { list: {} }).states.list;
    this.scope.add(() => this.dispose());
  }

  async startTerminal(input: StartTerminalInput): Promise<Result<void, TerminalError>> {
    const sessionKey = sessionKeyFor(input.key);
    const existing = this.registry.get(sessionKey);
    if (existing && !existing.exited) return ok(undefined);

    this.sessionKeys.set(sessionKey, input.key);
    this.sessionKinds.set(sessionKey, 'terminal');
    this.interactiveConfigs.set(sessionKey, { key: input.key, spec: input.spec });
    this.intentionalStops.delete(sessionKey);

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

  async runWorkflow(
    input: RunScriptWorkflowInput,
    ctx: LiveJobContext<ScriptWorkflowProgress>
  ): Promise<Result<ScriptWorkflowResult, TerminalError>> {
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
    return this.logFor(key);
  }

  sendInput(key: TerminalKey, data: string): Result<void, TerminalError> {
    const sessionKey = sessionKeyFor(key);
    if (!this.registry.write(sessionKey, data)) {
      return err({ type: 'not-found', message: `Terminal session '${key.id}' is not running` });
    }
    return ok(undefined);
  }

  resize(key: TerminalKey, cols: number, rows: number): Result<void, TerminalError> {
    const sessionKey = sessionKeyFor(key);
    if (!this.registry.resize(sessionKey, cols, rows)) {
      return err({ type: 'not-found', message: `Terminal session '${key.id}' is not running` });
    }
    this.sessionsList.produce((draft) => {
      const session = draft[sessionKey];
      if (!session) return;
      session.cols = cols;
      session.rows = rows;
    });
    return ok(undefined);
  }

  async kill(key: TerminalKey): Promise<Result<void, TerminalError>> {
    const sessionKey = sessionKeyFor(key);
    this.intentionalStops.add(sessionKey);
    if (!this.registry.kill(sessionKey)) {
      return err({ type: 'not-found', message: `Terminal session '${key.id}' is not running` });
    }
    await this.killTmuxForSession(sessionKey);
    return ok(undefined);
  }

  async killScope(workspace: HostFileRef): Promise<Result<void, TerminalError>> {
    const prefix = `${scopeKeyFor(workspace)}:`;
    for (const [key] of Object.entries(this.sessionsList.snapshot().data)) {
      this.intentionalStops.add(key);
      if (key.startsWith(prefix)) this.registry.kill(key);
      if (key.startsWith(prefix)) await this.killTmuxForSession(key);
    }
    return ok(undefined);
  }

  detachScope(workspace: HostFileRef): Result<void, TerminalError> {
    const prefix = `${scopeKeyFor(workspace)}:`;
    for (const [key] of Object.entries(this.sessionsList.snapshot().data)) {
      if (!key.startsWith(prefix)) continue;
      this.intentionalStops.add(key);
      this.registry.kill(key);
    }
    return ok(undefined);
  }

  dispose(): void {
    for (const binding of this.workflowBindings.values()) binding.dispose();
    this.workflowBindings.clear();
    this.workflowRuns.clear();
    this.registry.killAll();
    this.logs.clear();
    this.workflowsHost.dispose();
    this.sessionsHost.dispose();
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

    const env = buildTerminalEnv({
      shellProfile: spec.shellProfile,
      overrides: spec.env,
    });
    const resolved = resolveLocalPtySpawn({
      intent: {
        kind: 'interactive-shell',
        cwd: spec.cwd,
        shellProfile: spec.shellProfile,
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
          this.outputTails.set(
            sessionKey,
            appendOutputTail(this.outputTails.get(sessionKey) ?? '', chunk)
          );
        },
        onExit: (info) => this.handleInteractiveExit(sessionKey, info),
      }
    );
  }

  private handleInteractiveExit(sessionKey: string, info: PtyExitInfo): void {
    if (this.intentionalStops.delete(sessionKey)) return;

    const config = this.interactiveConfigs.get(sessionKey);
    if (!config || config.spec.tmux || !isUnexpectedPtyExit(info)) {
      this.unexpectedRespawns.delete(sessionKey);
      return;
    }

    const respawns = this.unexpectedRespawns.get(sessionKey) ?? 0;
    if (respawns >= MAX_UNEXPECTED_RESPAWNS) return;
    this.unexpectedRespawns.set(sessionKey, respawns + 1);
    setTimeout(() => {
      const latest = this.interactiveConfigs.get(sessionKey);
      if (!latest || this.intentionalStops.has(sessionKey)) return;
      void this.spawnInteractiveTerminal(sessionKey, latest.key, latest.spec);
    }, RESPAWN_DELAY_MS);
  }

  private async killTmuxForSession(sessionKey: string): Promise<void> {
    const config = this.interactiveConfigs.get(sessionKey);
    if (!config?.spec.tmux || process.platform === 'win32') return;
    await killLocalTmuxSession(makeTmuxSessionName(sessionKey));
  }

  private startWorkflow(
    input: RunScriptWorkflowInput,
    ctx: LiveJobContext<ScriptWorkflowProgress>,
    scopeKey: string
  ): Promise<Result<ScriptWorkflowResult, TerminalError>> {
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
      onOutput: ({ nodeId, chunk }) => this.logFor({ workspace: input.workspace, id: nodeId }).append(chunk),
    });
    if (!workflow.success) {
      const error = workflowCompileErrorToTerminalError(workflow.error);
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
  ): Promise<Result<TerminalExit, TerminalError>> {
    const key = { workspace, id: node.id };
    const sessionKey = sessionKeyFor(key);
    const log = this.logFor(key);
    log.reseed();
    this.sessionKeys.set(sessionKey, key);
    this.sessionKinds.set(sessionKey, 'workflow');
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
        outputTail = appendOutputTail(outputTail, chunk);
        this.outputTails.set(sessionKey, outputTail);
      },
      onExit: (info) => {
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
  ): Promise<Result<ScriptWorkflowResult, TerminalError>> {
    try {
      const result = await workflow.run();
      run.finishedAt = this.now();
      this.bindingFor(ctx.jobId)?.sync();
      if (!result.success) return err(workflowErrorToTerminalError(result.error));
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
    const state = workflowStateFor(this.ensureWorkflowCell(workspace), workflow, run);
    this.ensureWorkflowCell(workspace).replace(state);
    const binding = bindMachineToLiveState({
      machine: workflow.machine,
      liveState: this.ensureWorkflowCell(workspace),
      project: (workflowState) => projectWorkflowState(workflowState, run),
    });
    this.workflowBindings.set(run.workflowId, binding);
  }

  private bindingFor(workflowId: string): { sync(): void; dispose(): void } | undefined {
    return this.workflowBindings.get(workflowId);
  }

  private ensureWorkflowCell(workspace: HostFileRef): WorkflowCell {
    const key = { workspace };
    return this.workflowsHost.get(key)?.states.state ?? this.workflowsHost.create(key, { state: null }).states.state;
  }

  private publishFailedWorkflow(
    input: RunScriptWorkflowInput,
    run: WorkflowRunContext,
    error: TerminalError
  ): void {
    run.finishedAt = this.now();
    this.ensureWorkflowCell(input.workspace).replace({
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

  private logFor(key: TerminalKey): LiveLog {
    const id = sessionKeyFor(key);
    let log = this.logs.get(id);
    if (!log) {
      log = new LiveLog();
      this.logs.set(id, log);
    }
    return log;
  }

  private syncSession(key: string, session: PtySession | null): void {
    this.sessionsList.produce((draft) => {
      if (!session) {
        const existing = draft[key];
        if (existing) {
          existing.status = 'exited';
          existing.exitedAt = existing.exitedAt ?? this.now();
        }
        return;
      }
      const terminalKey = this.sessionKeys.get(key);
      if (!terminalKey) return;
      const exit = session.exitStatus ?? undefined;
      const existing = draft[key];
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
        exit:
          exit !== undefined
            ? {
                exitCode: exit.exitCode,
                signal: exit.signal,
              }
            : undefined,
      };
      draft[key] = state;
    });
  }
}

function workflowStateFor(
  cell: WorkflowCell,
  workflow: Workflow,
  run: WorkflowRunContext
): ScriptWorkflowState {
  const current = cell.snapshot().data;
  return projectWorkflowState(workflow.machine.current(), {
    ...run,
    finishedAt: current?.finishedAt ?? run.finishedAt,
  });
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
          error: node.error ? workflowErrorToTerminalError(node.error) : undefined,
        };
        if (!projected.label && input?.label) projected.label = input.label;
        return [id, projected];
      })
    ),
    order: Object.keys(state.nodes),
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    error: state.error ? workflowErrorToTerminalError(state.error) : undefined,
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

function workflowCompileErrorToTerminalError(error: unknown): TerminalError {
  return {
    type: 'workflow-compile-failed',
    message: error instanceof Error ? error.message : JSON.stringify(error),
  };
}

function workflowErrorToTerminalError(error: WorkflowError): TerminalError {
  return {
    type: error.type,
    message: error.message,
    resolutions: error.resolutions,
  };
}

function killLocalTmuxSession(sessionName: string): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn('tmux', ['kill-session', '-t', sessionName], {
      stdio: 'ignore',
    });
    child.on('error', () => resolve());
    child.on('exit', () => resolve());
  });
}

export function terminalJobError(error: unknown): TerminalError {
  if (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { type?: unknown }).type === 'string' &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    return error as TerminalError;
  }
  return {
    type: 'terminal-runtime-error',
    message: error instanceof Error ? error.message : String(error),
  };
}
