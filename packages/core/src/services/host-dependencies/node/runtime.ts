import { err, ok, type Result, type Serializable } from '@emdash/shared';
import type { Logger } from '@emdash/shared/logger';
import {
  cell,
  expose,
  peek,
  publishStructural,
  revisionOf,
  type Cell,
  type LeasedLiveModelProvider,
} from '@emdash/wire';
import type { IExecutionContext } from '@primitives/exec/api';
import {
  hostDependencySelectionSchema,
  type DependencyId,
  type HostDependencyDefinition,
  type HostDependencyError,
  type HostDependencyResolveResult,
  type HostDependencySelection,
  type HostDependencySnapshot,
  type HostDependencyView,
  type HostDependencyViewResult,
  type InstallMethod,
  type PathCandidate,
} from '@primitives/host-dependencies/api';
import type { KeyValueStore } from '@primitives/kv/api';
import { hostDependenciesContract } from '@services/host-dependencies/api';
import {
  probeHostElevation,
  resolveAllCommandPaths,
  resolveRealpath,
} from '@services/host-dependencies/api/runtime/probe';
import { z } from 'zod';
import {
  buildInstallCommandInvocation,
  installOptionsForPlatform,
  isPermissionDeniedOutput,
  permissionDeniedError,
  resolveElevationDecision,
  resolveInstallerTool,
  resolveSelection,
  selectInstallOption,
  type InstallCommandKind,
} from './install-execution';

const STORE_KEY_PREFIX = 'host-dependencies';
const OUTPUT_TAIL_LIMIT = 20_000;

type SelectionDocument = {
  version: 1;
  selections: Record<string, HostDependencySelection>;
};

const selectionDocumentSchema = z.object({
  version: z.literal(1),
  selections: z.record(z.string(), hostDependencySelectionSchema),
});

type HostDependenciesLiveHost = LeasedLiveModelProvider<typeof hostDependenciesContract.snapshot>;

export type HostDependenciesRuntimeDeps = {
  hostId: string;
  definitions: HostDependencyDefinition[];
  store: KeyValueStore;
  exec: IExecutionContext;
  logger?: Logger;
};

export class HostDependenciesRuntime {
  private readonly definitions: Map<string, HostDependencyDefinition>;
  private readonly host: HostDependenciesLiveHost;
  private readonly current: Cell<HostDependencySnapshot>;
  private selections: Record<string, HostDependencySelection> | null = null;
  private generation = 0;
  private disposed = false;
  private refreshPromise: Promise<Result<HostDependencySnapshot, HostDependencyError>> | null =
    null;

  constructor(private readonly deps: HostDependenciesRuntimeDeps) {
    this.definitions = new Map(deps.definitions.map((definition) => [definition.id, definition]));
    this.current = cell<HostDependencySnapshot>({
      hostId: deps.hostId,
      generation: 0,
      hostElevation: null,
      dependencies: {},
    });
    this.host = expose(
      hostDependenciesContract.snapshot,
      { current: this.current },
      {
        mutations: {
          setSelection: async (context) => {
            const result = await this.setSelection(context.input.id, context.input.selection);
            if (result.success) await context.observed('current', revisionOf(this.current));
            return result;
          },
          refresh: async (context) => {
            const refreshed = await this.refresh(context.input?.id);
            if (refreshed.success) await context.observed('current', revisionOf(this.current));
            return refreshed;
          },
        },
      }
    );
  }

  dispose(): void {
    this.disposed = true;
    void this.host.dispose();
  }

  liveHost(): HostDependenciesLiveHost {
    return this.host;
  }

  async resolve(id: DependencyId): Promise<HostDependencyResolveResult> {
    const view = await this.getView(id);
    if (!view.success) return view;
    if (!view.data.resolved) return err({ type: 'missing', id });
    return ok(view.data.resolved);
  }

  async setSelection(
    id: DependencyId,
    selection: HostDependencySelection
  ): Promise<HostDependencyViewResult> {
    if (!this.definitions.has(id)) return err({ type: 'unknown-dependency', id });
    const selections = await this.loadSelections();
    if (!selections.success) return err(selections.error);
    if (selection === null) delete selections.data[id];
    else selections.data[id] = selection;
    const saved = await this.saveSelections(selections.data);
    if (!saved.success) return err(saved.error);
    this.selections = selections.data;
    return this.getView(id, { force: true });
  }

  async refresh(id?: DependencyId): Promise<Result<HostDependencySnapshot, HostDependencyError>> {
    if (id && !this.definitions.has(id)) return err({ type: 'unknown-dependency', id });
    if (this.refreshPromise && !id) return this.refreshPromise;

    const run = async (): Promise<Result<HostDependencySnapshot, HostDependencyError>> => {
      try {
        const snapshot = { ...this.snapshot(), generation: this.generation + 1 };
        if (id) {
          const view = await this.getView(id, { force: true });
          if (!view.success) return view;
          snapshot.dependencies[id] = view.data;
        } else {
          snapshot.hostElevation = await probeHostElevation(this.deps.exec);
          const dependencies: Record<string, HostDependencyView> = {};
          for (const depId of this.definitions.keys()) {
            const view = await this.getView(depId, { force: true });
            if (view.success) dependencies[depId] = view.data;
          }
          snapshot.dependencies = dependencies;
        }
        this.generation = snapshot.generation;
        this.publish(snapshot);
        return ok(snapshot);
      } catch (error) {
        return err({
          type: 'io',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    };

    const promise = run();
    if (!id) this.refreshPromise = promise;
    try {
      return await promise;
    } finally {
      if (!id) this.refreshPromise = null;
    }
  }

  async runSelfUpdateCommand(
    id: DependencyId,
    ctx: {
      signal: AbortSignal;
      progress: (progress: { phase: 'resolving' | 'running' | 'refreshing' }) => void;
    }
  ): Promise<HostDependencyViewResult> {
    const definition = this.definitions.get(id);
    if (!definition) return err({ type: 'unknown-dependency', id });
    if (!definition.updateCommand) return err({ type: 'no-update-command', id });
    ctx.progress({ phase: 'resolving' });
    const resolved = await this.resolve(id);
    if (!resolved.success) return err(resolved.error);
    const output = captureTail();
    try {
      ctx.progress({ phase: 'running' });
      await this.deps.exec.execStreaming(
        resolved.data.path,
        definition.updateCommand.args,
        output.onChunk,
        { signal: ctx.signal }
      );
      ctx.progress({ phase: 'refreshing' });
      return this.getView(id, { force: true });
    } catch (error) {
      return err({
        type: 'command-failed',
        message: error instanceof Error ? error.message : String(error),
        output: output.read(),
      });
    }
  }

  async runInstallCommand(
    id: DependencyId,
    method: InstallMethod | undefined,
    ctx: {
      signal: AbortSignal;
      progress: (progress: { phase: 'resolving' | 'running' | 'refreshing' }) => void;
    },
    options: { elevate?: boolean; commandKind?: InstallCommandKind } = {}
  ): Promise<HostDependencyViewResult> {
    const definition = this.definitions.get(id);
    if (!definition) return err({ type: 'unknown-dependency', id });

    ctx.progress({ phase: 'resolving' });
    const option = selectInstallOption(installOptionsForPlatform(definition), method);
    if (!option) return err({ type: 'no-install-command', id });
    const commandKind = options.commandKind ?? 'install';
    const command =
      commandKind === 'update' ? (option.updateCommand ?? option.command) : option.command;
    const elevation = option.elevation ?? 'never';
    const elevationDecision = await resolveElevationDecision(
      elevation,
      options.elevate === true,
      this.deps.exec
    );
    if (!elevationDecision.success) {
      return err(
        permissionDeniedError({
          id,
          command,
          commandKind,
          message: elevationDecision.message,
          hostElevation: elevationDecision.hostElevation,
        })
      );
    }
    const installerProbe = await resolveInstallerTool(option.method, this.deps.exec);
    if (installerProbe && !installerProbe.found) {
      return err({
        type: 'installer-missing',
        id,
        tool: installerProbe.label,
        method: option.method,
      });
    }

    const output = captureTail();
    try {
      ctx.progress({ phase: 'running' });
      const shell = buildInstallCommandInvocation(
        command,
        elevationDecision.elevated ? 'sudo' : 'plain'
      );
      const result = await this.deps.exec.execStreaming(shell.command, shell.args, output.onChunk, {
        signal: ctx.signal,
      });
      if (result.exitCode !== 0) {
        if (
          elevation === 'on-failure' &&
          !elevationDecision.elevated &&
          // `null` denotes Windows, where sudo classification and guidance are intentionally off.
          elevationDecision.hostElevation !== null &&
          isPermissionDeniedOutput(output.read())
        ) {
          return err(
            permissionDeniedError({
              id,
              command,
              commandKind,
              output: output.read(),
              exitCode: result.exitCode,
              hostElevation: elevationDecision.hostElevation,
            })
          );
        }
        return err(
          this.commandFailedError(id, command, commandKind, result.exitCode, output.read())
        );
      }
    } catch (error) {
      return err(
        this.commandFailedError(
          id,
          command,
          commandKind,
          null,
          output.read(),
          error instanceof Error ? error.message : String(error)
        )
      );
    }

    try {
      ctx.progress({ phase: 'refreshing' });
      await this.deps.exec.refreshShellEnv?.();
      const view = await this.getView(id, { force: true });
      if (!view.success) return view;
      if (view.data.status !== 'available') {
        return err({ type: 'not-detected-after-install', id, output: output.read() });
      }
      return view;
    } catch (error) {
      return err({ type: 'io', message: error instanceof Error ? error.message : String(error) });
    }
  }

  private snapshot(): HostDependencySnapshot {
    return peek(this.current);
  }

  private publish(snapshot: HostDependencySnapshot): void {
    if (this.disposed) return;
    publishStructural(this.current, snapshot);
  }

  private async getView(
    id: DependencyId,
    _options: { force?: boolean } = {}
  ): Promise<HostDependencyViewResult> {
    const definition = this.definitions.get(id);
    if (!definition) return err({ type: 'unknown-dependency', id });
    const selections = await this.loadSelections();
    if (!selections.success) return err(selections.error);
    const candidates = await this.enumerate(definition);
    const selection = selections.data[id] ?? null;
    const resolved = resolveSelection(definition.id, selection, candidates);
    const view: HostDependencyView = {
      hostId: this.deps.hostId,
      definition,
      installOptions: installOptionsForPlatform(definition),
      selection,
      candidates,
      resolved: resolved.success ? resolved.data : null,
      status: resolved.success
        ? 'available'
        : resolved.error.type === 'missing'
          ? 'missing'
          : 'error',
      checkedAt: Date.now(),
      ...(resolved.success ? {} : { error: resolved.error }),
    };
    const snapshot = this.snapshot();
    this.publish({
      ...snapshot,
      dependencies: { ...snapshot.dependencies, [id]: view },
    });
    return ok(view);
  }

  private async enumerate(definition: HostDependencyDefinition): Promise<PathCandidate[]> {
    const candidates: PathCandidate[] = [];
    const seen = new Set<string>();
    for (const command of definition.binaryNames) {
      const paths = await resolveAllCommandPaths(command, this.deps.exec);
      for (const path of paths) {
        const realpath = await resolveRealpath(path, this.deps.exec);
        if (seen.has(realpath)) continue;
        seen.add(realpath);
        candidates.push({
          command,
          path,
          realpath,
          isPathDefault: candidates.length === 0,
        });
      }
    }
    return candidates;
  }

  private async loadSelections(): Promise<
    Result<Record<string, HostDependencySelection>, HostDependencyError>
  > {
    if (this.selections) return ok(this.selections);
    const loaded = await this.deps.store.get(this.storeKey());
    if (!loaded.success) return err({ type: 'io', message: loaded.error.message });
    if (loaded.data === null) {
      this.selections = {};
      return ok(this.selections);
    }
    const parsed = selectionDocumentSchema.safeParse(loaded.data);
    if (!parsed.success) return err({ type: 'io', message: z.prettifyError(parsed.error) });
    this.selections = parsed.data.selections;
    return ok(this.selections);
  }

  private async saveSelections(
    selections: Record<string, HostDependencySelection>
  ): Promise<Result<void, HostDependencyError>> {
    const doc: SelectionDocument = { version: 1, selections };
    const saved = await this.deps.store.set(this.storeKey(), doc as unknown as Serializable);
    if (!saved.success) return err({ type: 'io', message: saved.error.message });
    return ok();
  }

  private storeKey(): string {
    return `${STORE_KEY_PREFIX}:${this.deps.hostId}:selections`;
  }

  private commandFailedError(
    id: DependencyId,
    command: string,
    commandKind: InstallCommandKind,
    exitCode: number | null | undefined,
    output: string,
    message?: string
  ): HostDependencyError {
    this.deps.logger?.error(`Host dependency ${commandKind} command failed`, {
      id,
      command,
      exitCode: exitCode ?? null,
      output,
    });
    return {
      type: 'command-failed',
      message:
        message ??
        `${commandKind === 'update' ? 'Update' : 'Install'} command exited with code ${exitCode ?? 'unknown'}`,
      output,
      exitCode: exitCode ?? null,
    };
  }
}

function captureTail(limit = OUTPUT_TAIL_LIMIT) {
  let output = '';
  return {
    onChunk: (chunk: string) => {
      output = `${output}${chunk}`.slice(-limit);
      return true;
    },
    read: () => output,
  };
}
