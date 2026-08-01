import { err, ok, type Result } from '@emdash/shared';
import { admit, admitBatch, type BatchMember } from '../api/admission';
import { mergeConflictPolicies, type ConflictPolicy } from '../api/conflict-policy';
import type { AnyOperationDefinition, ErrorOf, InputOf, ResultOf } from '../api/definition';
import { dispatchPass, RunningClaims, type DispatchPassReport } from '../api/dispatch';
import type { OperationHandler, OperationHandleLike, OperationFailure } from '../api/handler';
import type { OperationProgress, ProgressSink } from '../api/progress';
import { queryRecords, type OperationQueryFilter, type OperationQueryPage } from '../api/query';
import {
  isTerminalStatus,
  type AbortReason,
  type OperationInitiator,
  type OperationRecord,
  type PropagationPolicy,
} from '../api/record';
import type { OperationStore } from '../api/store';
import { runOperationAttempt, systemClock, type Clock } from './execution';
import { recoverOperationStore } from './recovery';

export interface OperationRegistry {
  definitions: readonly AnyOperationDefinition[];
  handlers: readonly OperationHandler<AnyOperationDefinition>[];
  conflictPolicies: readonly ConflictPolicy[];
}

export type AdmissionError =
  | { kind: 'conflict'; conflicts: OperationRecord[] }
  | { kind: 'missing-handler'; name: string }
  | { kind: 'unknown-definition'; name: string };

export interface BatchHandles {
  handles: OperationHandleLike<AnyOperationDefinition>[];
}

export interface OperationEngine {
  submit<D extends AnyOperationDefinition>(
    definition: D,
    input: InputOf<D>,
    opts: { initiator: OperationInitiator; parentId?: string; propagation?: PropagationPolicy }
  ): Promise<Result<OperationHandleLike<D>, AdmissionError>>;
  submitBatch(
    members: readonly BatchMember[],
    opts: { initiator: OperationInitiator; propagation?: PropagationPolicy }
  ): Promise<Result<BatchHandles, AdmissionError>>;
  cancel(id: string): Promise<void>;
  get(id: string): Promise<OperationRecord | undefined>;
  query(filter: OperationQueryFilter): Promise<OperationQueryPage>;
  lastDispatchReport(): DispatchPassReport;
  recover(): Promise<void>;
  shutdown(): Promise<void>;
}

export interface CreateOperationEngineDeps {
  store: OperationStore;
  registry: OperationRegistry;
  progress: ProgressSink;
  clock?: Clock;
  ids?: () => string;
  dispatchGate?: (record: OperationRecord) => boolean;
}

interface RunningOperation {
  controller: AbortController;
  reason?: AbortReason;
}

/**
 * Exactly one engine instance may dispatch from a store at a time. The
 * in-memory running set is authoritative for execution ownership.
 */
export function createOperationEngine(deps: CreateOperationEngineDeps): OperationEngine {
  const clock = deps.clock ?? systemClock;
  const ids = deps.ids ?? (() => crypto.randomUUID());
  const definitions = validateDefinitions(deps.registry.definitions);
  const handlers = validateHandlers(deps.registry.handlers, definitions);
  const policy = mergeConflictPolicies(deps.registry.conflictPolicies);
  const runningClaims = new RunningClaims();
  const running = new Map<string, RunningOperation>();
  const runningDone = new Map<string, Promise<void>>();
  const waiters = new Map<string, Array<(record: OperationRecord) => void>>();
  const latestProgress = new Map<string, OperationProgress>();
  const followers = new Map<string, Set<(progress: OperationProgress) => void>>();
  let lastReport: DispatchPassReport = { started: [], skipped: [], deferred: [] };
  let dispatching = false;
  let dispatchQueued = false;
  let dispatchPassPromise: Promise<void> | undefined;
  let stopped = false;

  const progress: ProgressSink = {
    publish(update) {
      latestProgress.set(update.operationId, update);
      deps.progress.publish(update);
      for (const follower of followers.get(update.operationId) ?? []) {
        follower(update);
      }
    },
    end(operationId) {
      const current = latestProgress.get(operationId);
      const done: OperationProgress = {
        operationId,
        stages: current?.stages ?? [],
        updatedAt: clock.now(),
        done: true,
      };
      latestProgress.delete(operationId);
      deps.progress.publish(done);
      for (const follower of followers.get(operationId) ?? []) {
        follower(done);
      }
      followers.delete(operationId);
      deps.progress.end(operationId);
    },
  };

  const engine: OperationEngine = {
    async submit(definition, input, opts) {
      if (!definitions.has(definition.name)) {
        return err({ kind: 'unknown-definition', name: definition.name });
      }
      if (!handlers.has(definition.name)) {
        return err({ kind: 'missing-handler', name: definition.name });
      }

      const key = definition.key(input);
      const claims = definition.claims(input);
      const createdAt = clock.now();
      const id = ids();
      const superseded: OperationRecord[] = [];
      const runningSupersedeIds: string[] = [];
      const decision = await deps.store.transaction((tx) => {
        const nonTerminal = tx.listNonTerminal();
        const result = admit(
          { definition, key, claims, parentId: opts.parentId },
          nonTerminal,
          policy,
          (recordId) => tx.get(recordId)
        );
        if (result.kind !== 'insert') {
          return result;
        }
        for (const incumbent of result.toSupersede) {
          if (incumbent.status === 'running') {
            runningSupersedeIds.push(incumbent.id);
          } else if (
            tx.transition(incumbent.id, incumbent.status, 'superseded', 'supersede', {
              updatedAt: clock.now(),
            })
          ) {
            const next = tx.get(incumbent.id);
            if (next) superseded.push(next);
          }
        }
        const record = tx.insert({
          id,
          name: definition.name,
          key,
          input,
          claims,
          status: 'pending',
          attempt: 0,
          parentId: opts.parentId,
          initiator: opts.initiator,
          propagation: opts.propagation,
          createdAt,
          updatedAt: createdAt,
        });
        return { kind: 'insert', toSupersede: result.toSupersede, record } as const;
      });

      for (const id of runningSupersedeIds) {
        abortRunning(id, 'supersede');
      }
      for (const record of superseded) {
        await onSettled(record);
      }

      if (decision.kind === 'dedupe') {
        return ok(handleFor(definition, decision.existing.id));
      }
      if (decision.kind === 'reject') {
        return err({ kind: 'conflict', conflicts: decision.conflicts });
      }

      pokeDispatch();
      return ok(handleFor(definition, decision.record.id));
    },

    async submitBatch(members, opts) {
      const idsByIndex = new Map<number, string>();
      const superseded: OperationRecord[] = [];
      const runningSupersedeIds: string[] = [];
      const handles: OperationHandleLike<AnyOperationDefinition>[] = [];
      const decision = await deps.store.transaction((tx) => {
        const result = admitBatch(members, tx.listNonTerminal(), policy);
        if (result.kind === 'reject') {
          return result;
        }

        for (const incumbent of result.toSupersede) {
          if (incumbent.status === 'running') {
            runningSupersedeIds.push(incumbent.id);
          } else if (
            tx.transition(incumbent.id, incumbent.status, 'superseded', 'supersede', {
              updatedAt: clock.now(),
            })
          ) {
            const next = tx.get(incumbent.id);
            if (next) superseded.push(next);
          }
        }

        for (const member of result.members) {
          if (member.dedupeOfIndex !== undefined) {
            const targetId = idsByIndex.get(member.dedupeOfIndex);
            if (!targetId) {
              throw new Error(
                `Batch member ${member.index} deduped to unresolved member ${member.dedupeOfIndex}`
              );
            }
            idsByIndex.set(member.index, targetId);
            handles.push(handleFor(member.definition, targetId));
            continue;
          }

          if (member.adopted) {
            idsByIndex.set(member.index, member.adopted.id);
            handles.push(handleFor(member.definition, member.adopted.id));
            continue;
          }

          const id = ids();
          idsByIndex.set(member.index, id);
          const now = clock.now();
          const parentId = member.parent === undefined ? undefined : idsByIndex.get(member.parent);
          if (member.parent !== undefined && parentId === undefined) {
            throw new Error(
              `Batch member ${member.index} references unresolved parent ${member.parent}`
            );
          }
          tx.insert({
            id,
            name: member.definition.name,
            key: member.key,
            input: member.input,
            claims: member.claims,
            status: 'pending',
            attempt: 0,
            parentId,
            initiator:
              parentId === undefined
                ? opts.initiator
                : { kind: 'operation', operationId: parentId },
            propagation: opts.propagation,
            createdAt: now,
            updatedAt: now,
          });
          handles.push(handleFor(member.definition, id));
        }

        for (const reparent of result.reparent) {
          const parentId = idsByIndex.get(reparent.parentIndex);
          if (parentId) {
            tx.reparent(reparent.id, parentId);
          }
        }

        return result;
      });

      for (const id of runningSupersedeIds) {
        abortRunning(id, 'supersede');
      }
      for (const record of superseded) {
        await onSettled(record);
      }

      if (decision.kind === 'reject') {
        return err({ kind: 'conflict', conflicts: decision.conflicts });
      }

      pokeDispatch();
      return ok({ handles });
    },

    async cancel(id) {
      const record = await deps.store.get(id);
      if (!record || isTerminalStatus(record.status)) {
        return;
      }
      await cascadeCancel(id);
      if (record.status === 'running') {
        abortRunning(id, 'cancel');
        return;
      }
      await deps.store.transaction((tx) => {
        if (record.status === 'pending') {
          tx.transition(id, 'pending', 'cancelled', 'cancel', { updatedAt: clock.now() });
        } else if (record.status === 'waiting-children') {
          tx.transition(id, 'waiting-children', 'cancelled', 'cancel', { updatedAt: clock.now() });
        }
      });
      const next = await deps.store.get(id);
      if (next && isTerminalStatus(next.status)) {
        await onSettled(next);
      }
    },

    get(id) {
      return deps.store.get(id);
    },

    async query(filter) {
      return queryRecords(await deps.store.listRecords(), filter);
    },

    lastDispatchReport() {
      return {
        started: [...lastReport.started],
        skipped: lastReport.skipped.map((entry) => ({
          id: entry.id,
          blockedBy: [...entry.blockedBy],
          barredOn: [...entry.barredOn],
        })),
        deferred: lastReport.deferred.map((entry) => ({ ...entry })),
      };
    },

    async recover() {
      await recoverOperationStore(deps.store, clock);
      pokeDispatch();
    },

    async shutdown() {
      stopped = true;
      await dispatchPassPromise;
      for (const id of running.keys()) {
        abortRunning(id, 'shutdown');
      }
      await Promise.all([...runningDone.values()]);
    },
  };

  return engine;

  function handleFor<D extends AnyOperationDefinition>(
    definition: D,
    id: string
  ): OperationHandleLike<D> {
    return {
      id,
      result: resultPromise(definition, id),
      follow(cb, opts) {
        const current = latestProgress.get(id);
        if (current) {
          cb(current);
        }
        const set = followers.get(id) ?? new Set<(progress: OperationProgress) => void>();
        set.add(cb);
        followers.set(id, set);
        opts.scope.add(() => {
          set.delete(cb);
          if (set.size === 0) {
            followers.delete(id);
          }
        });
      },
      cancel: () => engine.cancel(id),
    };
  }

  async function resultPromise<D extends AnyOperationDefinition>(
    definition: D,
    id: string
  ): Promise<Result<ResultOf<D>, OperationFailure<ErrorOf<D>>>> {
    return new Promise((resolve) => {
      const callback = (terminal: OperationRecord) =>
        resolve(resultFromTerminalRecord(definition, terminal));
      const callbacks = waiters.get(id) ?? [];
      callbacks.push(callback);
      waiters.set(id, callbacks);
      void deps.store.get(id).then((record) => {
        if (record && isTerminalStatus(record.status)) {
          removeWaiter(id, callback);
          resolve(resultFromTerminalRecord(definition, record));
        }
      });
    });
  }

  function resultFromTerminalRecord<D extends AnyOperationDefinition>(
    definition: D,
    record: OperationRecord
  ): Result<ResultOf<D>, OperationFailure<ErrorOf<D>>> {
    if (record.status === 'succeeded') {
      const parsed = definition.result.safeParse(record.result);
      if (parsed.success) {
        return ok(parsed.data as ResultOf<D>);
      }
      return err({
        kind: 'failed',
        error: { message: `Stored result for '${record.name}' no longer matches its schema` },
      });
    }
    if (record.status === 'rejected') {
      const parsed = definition.error.safeParse(record.rejectedError);
      return err({
        kind: 'rejected',
        error: (parsed.success ? parsed.data : record.rejectedError) as ErrorOf<D>,
      });
    }
    if (record.status === 'failed') {
      return err({ kind: 'failed', error: record.error ?? { message: 'Operation failed' } });
    }
    if (record.status === 'superseded') {
      return err({ kind: 'superseded' });
    }
    return err({ kind: 'cancelled' });
  }

  function pokeDispatch(): void {
    if (stopped) {
      return;
    }
    if (dispatching) {
      dispatchQueued = true;
      return;
    }
    dispatching = true;
    dispatchPassPromise = new Promise((resolve) => {
      queueMicrotask(() => {
        void runDispatchPass().finally(() => {
          resolve();
          dispatchPassPromise = undefined;
          dispatching = false;
          if (dispatchQueued) {
            dispatchQueued = false;
            pokeDispatch();
          }
        });
      });
    });
  }

  async function runDispatchPass(): Promise<void> {
    if (stopped) {
      return;
    }
    const pending = await deps.store.listPending();
    if (stopped) {
      return;
    }
    const now = clock.now();
    const deferred: DispatchPassReport['deferred'] = [];
    const eligible = pending.filter((record) => {
      if (record.notBefore !== undefined && record.notBefore > now) {
        deferred.push({ id: record.id, reason: 'not-before' });
        return false;
      }
      if (deps.dispatchGate?.(record) === false) {
        deferred.push({ id: record.id, reason: 'gated' });
        return false;
      }
      return true;
    });

    const report = dispatchPass(
      await Promise.all(
        eligible.map(async (record) => ({
          id: record.id,
          seq: record.seq,
          claims: record.claims,
          ancestors: await ancestorSet(record),
          start: () => {
            void startRecord(record.id);
          },
        }))
      ),
      runningClaims
    );
    lastReport = { ...report, deferred };
  }

  async function startRecord(id: string): Promise<void> {
    if (stopped) {
      runningClaims.release(id);
      return;
    }
    const record = await deps.store.get(id);
    if (!record || record.status !== 'pending') {
      runningClaims.release(id);
      return;
    }
    const definition = definitions.get(record.name);
    const handler = handlers.get(record.name);
    if (!definition || !handler) {
      await deps.store.transaction((tx) => {
        tx.transition(id, 'pending', 'running', 'dispatch', { updatedAt: clock.now() });
        tx.transition(id, 'running', 'failed', 'settle', {
          error: { message: `No handler registered for '${record.name}'` },
          updatedAt: clock.now(),
        });
      });
      runningClaims.release(id);
      const failed = await deps.store.get(id);
      if (failed && isTerminalStatus(failed.status)) {
        await onSettled(failed);
      }
      return;
    }

    const controller = new AbortController();
    running.set(id, { controller });
    const done = runOperationAttempt({
      store: deps.store,
      record,
      definition,
      handler,
      progress,
      clock,
      signal: controller.signal,
      abortReason: () => running.get(id)?.reason,
      shouldWaitChildren: async () =>
        (await deps.store.listByParent(id)).some((child) => !isTerminalStatus(child.status)),
      children: {
        run: async (childDefinition, input) => {
          const existing = await childByKey(id, childDefinition, input);
          if (existing) {
            const result = await awaitChildResult(
              handleFor(childDefinition, existing.id),
              controller.signal
            );
            throwIfParentAborted(controller.signal);
            return result;
          }
          const submitted = await engine.submit(childDefinition, input, {
            initiator: { kind: 'operation', operationId: id },
            parentId: id,
          });
          if (!submitted.success) {
            return err({
              kind: 'failed',
              error: { message: `Child operation admission failed: ${submitted.error.kind}` },
            });
          }
          const result = await awaitChildResult(submitted.data, controller.signal);
          throwIfParentAborted(controller.signal);
          return result;
        },
        spawn: async (childDefinition, input) => {
          const existing = await childByKey(id, childDefinition, input);
          if (existing) {
            return { id: existing.id };
          }
          const submitted = await engine.submit(childDefinition, input, {
            initiator: { kind: 'operation', operationId: id },
            parentId: id,
          });
          if (!submitted.success) {
            throw new Error(`Child operation admission failed: ${submitted.error.kind}`);
          }
          return { id: submitted.data.id };
        },
      },
      onBackoff: (_recordId, dueAt) => {
        clock.setTimeout(() => pokeDispatch(), Math.max(0, dueAt - clock.now()));
      },
    }).then(async (result) => {
      void result;
      running.delete(id);
      runningClaims.release(id);
      const latest = await deps.store.get(id);
      if (latest && isTerminalStatus(latest.status)) {
        await onSettled(latest);
      }
      if (latest?.status === 'pending') {
        pokeDispatch();
      }
      if (latest?.status === 'waiting-children') {
        await settleWaitingParents(latest.id);
      }
    });
    runningDone.set(id, done);
    await done.finally(() => {
      runningDone.delete(id);
    });
  }

  async function childByKey<D extends AnyOperationDefinition>(
    parentId: string,
    definition: D,
    input: InputOf<D>
  ): Promise<OperationRecord | undefined> {
    const key = definition.key(input);
    return (await deps.store.listByParent(parentId)).find(
      (record) => record.name === definition.name && record.key === key
    );
  }

  function throwIfParentAborted(signal: AbortSignal): void {
    if (signal.aborted) {
      throw new Error('Parent operation aborted while awaiting child');
    }
  }

  function awaitChildResult<D extends AnyOperationDefinition>(
    handle: OperationHandleLike<D>,
    signal: AbortSignal
  ): Promise<Result<ResultOf<D>, OperationFailure<ErrorOf<D>>>> {
    if (signal.aborted) {
      return Promise.reject(new Error('Parent operation aborted while awaiting child'));
    }
    return Promise.race([
      handle.result,
      new Promise<never>((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => reject(new Error('Parent operation aborted while awaiting child')),
          { once: true }
        );
      }),
    ]);
  }

  async function ancestorSet(record: OperationRecord): Promise<Set<string>> {
    const ancestors = new Set<string>();
    let current = record.parentId ? await deps.store.get(record.parentId) : undefined;
    while (current) {
      ancestors.add(current.id);
      current = current.parentId ? await deps.store.get(current.parentId) : undefined;
    }
    return ancestors;
  }

  function abortRunning(id: string, reason: AbortReason): void {
    const entry = running.get(id);
    if (!entry) {
      return;
    }
    entry.reason = reason;
    entry.controller.abort(reason);
  }

  async function cascadeCancel(parentId: string): Promise<void> {
    const children = await deps.store.listByParent(parentId);
    await Promise.all(
      children
        .filter((child) => !isTerminalStatus(child.status))
        .map((child) => engine.cancel(child.id))
    );
  }

  async function settleWaitingParents(parentId: string | undefined): Promise<void> {
    if (!parentId) {
      return;
    }
    const parent = await deps.store.get(parentId);
    if (!parent || parent.status !== 'waiting-children') {
      return;
    }
    const children = await deps.store.listByParent(parentId);
    if (children.some((child) => !isTerminalStatus(child.status))) {
      return;
    }
    const failed = children.some(
      (child) => child.status === 'failed' || child.status === 'rejected'
    );
    const cancelled = children.some((child) => child.status === 'cancelled');
    const terminal =
      parent.propagation === 'tolerate'
        ? 'succeeded'
        : failed
          ? 'failed'
          : cancelled
            ? 'cancelled'
            : 'succeeded';
    await deps.store.transaction((tx) => {
      tx.transition(parent.id, 'waiting-children', terminal, 'parent-settle', {
        error: failed
          ? { message: 'One or more child operations failed' }
          : cancelled
            ? { message: 'One or more child operations were cancelled' }
            : undefined,
        updatedAt: clock.now(),
      });
    });
    const settled = await deps.store.get(parent.id);
    if (settled && isTerminalStatus(settled.status)) {
      await onSettled(settled);
    }
  }

  async function onSettled(record: OperationRecord): Promise<void> {
    resolveWaiters(record);
    await settleWaitingParents(record.parentId);
    pokeDispatch();
  }

  function resolveWaiters(record: OperationRecord): void {
    const callbacks = waiters.get(record.id) ?? [];
    waiters.delete(record.id);
    for (const callback of callbacks) {
      callback(record);
    }
  }

  function removeWaiter(id: string, callback: (record: OperationRecord) => void): void {
    const callbacks = waiters.get(id);
    if (!callbacks) {
      return;
    }
    const next = callbacks.filter((candidate) => candidate !== callback);
    if (next.length > 0) {
      waiters.set(id, next);
    } else {
      waiters.delete(id);
    }
  }
}

function validateDefinitions(
  definitions: readonly AnyOperationDefinition[]
): Map<string, AnyOperationDefinition> {
  const byName = new Map<string, AnyOperationDefinition>();
  for (const definition of definitions) {
    if (byName.has(definition.name)) {
      throw new Error(`Duplicate operation definition '${definition.name}'`);
    }
    byName.set(definition.name, definition);
  }
  return byName;
}

function validateHandlers(
  handlers: readonly OperationHandler<AnyOperationDefinition>[],
  definitions: ReadonlyMap<string, AnyOperationDefinition>
): Map<string, OperationHandler<AnyOperationDefinition>> {
  const byName = new Map<string, OperationHandler<AnyOperationDefinition>>();
  for (const handler of handlers) {
    if (!definitions.has(handler.definition.name)) {
      throw new Error(`Handler registered for unknown operation '${handler.definition.name}'`);
    }
    if (byName.has(handler.definition.name)) {
      throw new Error(`Duplicate handler for operation '${handler.definition.name}'`);
    }
    byName.set(handler.definition.name, handler);
  }
  return byName;
}
