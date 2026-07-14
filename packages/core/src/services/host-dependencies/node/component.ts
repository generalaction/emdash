import { ok, err, type Result, type Serializable } from '@emdash/shared';
import {
  createController,
  createLiveModelHost,
  type LiveInstance,
  type LiveModelHost,
} from '@emdash/wire';
import { defineWireComponent } from '@emdash/wire/component';
import type { IExecutionContext } from '@primitives/exec/api';
import {
  hostDependencyDefinitionSchema,
  hostDependencySelectionSchema,
  type DependencyId,
  type HostDependencyDefinition,
  type HostDependencyError,
  type HostDependencyResolveResult,
  type HostDependencySelection,
  type HostDependencySnapshot,
  type HostDependencyView,
  type HostDependencyViewResult,
  type PathCandidate,
} from '@primitives/host-dependencies/api';
import type { KeyValueStore } from '@primitives/kv/api';
import { hostDependenciesContract } from '@services/host-dependencies/api';
import {
  resolveAllCommandPaths,
  resolveRealpath,
} from '@services/host-dependencies/api/runtime/probe';
import { z } from 'zod';

const STORE_KEY_PREFIX = 'host-dependencies';

export const hostDependenciesComponentConfigSchema = z.object({
  hostId: z.string().min(1),
  definitions: z.array(hostDependencyDefinitionSchema),
});

export type HostDependenciesComponentConfig = z.output<
  typeof hostDependenciesComponentConfigSchema
>;

export type CreateHostDependenciesComponentOptions = {
  store: KeyValueStore;
  exec: IExecutionContext;
};

type SelectionDocument = {
  version: 1;
  selections: Record<string, HostDependencySelection>;
};

const selectionDocumentSchema = z.object({
  version: z.literal(1),
  selections: z.record(z.string(), hostDependencySelectionSchema),
});

type HostDependenciesLiveHost = LiveModelHost<typeof hostDependenciesContract.snapshot>;
type HostDependenciesLiveModel = LiveInstance<typeof hostDependenciesContract.snapshot>;

export function createHostDependenciesComponent(options: CreateHostDependenciesComponentOptions) {
  return defineWireComponent({
    id: 'host-dependencies',
    contract: hostDependenciesContract,
    requirements: {},
    configSchema: hostDependenciesComponentConfigSchema,
    create: ({ config, instance, scope }) => {
      const exec = options.exec;
      scope.add(() => exec.dispose());
      const runtime = new HostDependenciesRuntime({
        hostId: config.hostId,
        definitions: config.definitions,
        store: options.store,
        exec,
      });
      scope.add(() => runtime.dispose());

      return instance({
        scope,
        controller: createHostDependenciesController(runtime),
      });
    },
  });
}

export function createHostDependenciesController(runtime: HostDependenciesRuntime) {
  return createController(hostDependenciesContract, {
    resolver: {
      resolve: ({ id }) => runtime.resolve(id),
    },
    snapshot: runtime.liveHost(),
    runUpdateCommand: {
      run: ({ id }, ctx) => runtime.runUpdateCommand(id, ctx),
      toError: (error) => ({
        type: 'command-failed' as const,
        message: error instanceof Error ? error.message : String(error),
        output: '',
      }),
    },
  });
}

type RuntimeDeps = {
  hostId: string;
  definitions: HostDependencyDefinition[];
  store: KeyValueStore;
  exec: IExecutionContext;
};

export class HostDependenciesRuntime {
  private readonly definitions: Map<string, HostDependencyDefinition>;
  private readonly host: HostDependenciesLiveHost;
  private readonly model: HostDependenciesLiveModel;
  private selections: Record<string, HostDependencySelection> | null = null;
  private generation = 0;
  private disposed = false;
  private refreshPromise: Promise<HostDependencySnapshot> | null = null;

  constructor(private readonly deps: RuntimeDeps) {
    this.definitions = new Map(deps.definitions.map((definition) => [definition.id, definition]));
    this.host = createLiveModelHost(hostDependenciesContract.snapshot, {
      mutations: {
        setSelection: (_ctx, input) => this.setSelection(input.id, input.selection),
        refresh: async (_ctx, input) => {
          const refreshed = await this.refresh(input?.id);
          return refreshed.success ? ok(refreshed.data) : err(refreshed.error);
        },
      },
    });
    this.model = this.host.create(undefined, {
      current: {
        hostId: deps.hostId,
        generation: 0,
        dependencies: {},
      },
    });
  }

  dispose(): void {
    this.disposed = true;
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
    if (this.refreshPromise && !id) return ok(await this.refreshPromise);
    const run = async () => {
      const snapshot = { ...this.snapshot(), generation: this.generation + 1 };
      if (id) {
        const view = await this.getView(id, { force: true });
        if (!view.success) throw view.error;
        snapshot.dependencies[id] = view.data;
      } else {
        const dependencies: Record<string, HostDependencyView> = {};
        for (const depId of this.definitions.keys()) {
          const view = await this.getView(depId, { force: true });
          if (view.success) dependencies[depId] = view.data;
        }
        snapshot.dependencies = dependencies;
      }
      this.generation = snapshot.generation;
      this.publish(snapshot);
      return snapshot;
    };
    try {
      const promise = run();
      if (!id) this.refreshPromise = promise;
      return ok(await promise);
    } catch (error) {
      return err(coerceHostDependencyError(error));
    } finally {
      if (!id) this.refreshPromise = null;
    }
  }

  async runUpdateCommand(
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
    let output = '';
    try {
      ctx.progress({ phase: 'running' });
      await this.deps.exec.execStreaming(
        resolved.data.path,
        definition.updateCommand.args,
        (chunk) => {
          output = `${output}${chunk}`.slice(-20_000);
          return true;
        },
        { signal: ctx.signal }
      );
      ctx.progress({ phase: 'refreshing' });
      return this.getView(id, { force: true });
    } catch (error) {
      return err({
        type: 'command-failed',
        message: error instanceof Error ? error.message : String(error),
        output,
      });
    }
  }

  private snapshot(): HostDependencySnapshot {
    return this.model.states.current.snapshot().data;
  }

  private publish(snapshot: HostDependencySnapshot): void {
    if (this.disposed) return;
    this.model.states.current.produce((draft) => Object.assign(draft, snapshot));
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
}

function resolveSelection(
  id: string,
  selection: HostDependencySelection,
  candidates: PathCandidate[]
): Result<NonNullable<HostDependencyView['resolved']>, HostDependencyError> {
  if (selection?.kind === 'path') {
    const candidate = candidates.find(
      (candidate) => candidate.path === selection.path || candidate.realpath === selection.path
    );
    if (!candidate) return err({ type: 'stale-selection', id, path: selection.path });
    return ok({
      id,
      command: candidate.command,
      path: candidate.path,
      realpath: candidate.realpath,
      source: { kind: 'path', path: selection.path },
    });
  }
  const first = candidates[0];
  if (!first) return err({ type: 'missing', id });
  return ok({
    id,
    command: first.command,
    path: first.path,
    realpath: first.realpath,
    source: { kind: 'auto' },
  });
}

function coerceHostDependencyError(error: unknown): HostDependencyError {
  if (isHostDependencyError(error)) return error;
  return { type: 'io', message: error instanceof Error ? error.message : String(error) };
}

function isHostDependencyError(error: unknown): error is HostDependencyError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    typeof (error as { type?: unknown }).type === 'string'
  );
}
