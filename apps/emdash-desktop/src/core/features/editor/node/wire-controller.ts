import { err, ok, type PendingLease, type Result } from '@emdash/shared';
import type { GroupMutationEnvelope, LeasedLiveModelProvider, LiveSource } from '@emdash/wire';
import { createController, type CallMeta, type Controller } from '@emdash/wire/api';
import { hostPathFromNative } from '@core/primitives/desktop-runtime/api';
import { editorContract } from '../api';
import {
  editorFilesRuntimeContract as filesContract,
  throwEditorRuntimeResolveError,
  type EditorHostRuntimesClient as HostRuntimesClient,
  type EditorRuntimeBroker,
  type EditorRuntimeResolveError as RuntimeResolveError,
  type EditorWorkspaceIdentity as WorkspaceIdentity,
  type EditorWorkspaceIdentityResolver,
} from '../api/runtime-adapter';
import type { EditorBufferService } from './editor-buffer-service';

export type CreateEditorWireControllerOptions = Readonly<{
  editorBuffer: EditorBufferService;
  runtimes: EditorRuntimeBroker;
  workspaceIdentity: EditorWorkspaceIdentityResolver;
}>;

export function createEditorWireController(options: CreateEditorWireControllerOptions): Controller {
  return createController(editorContract, {
    fs: {
      exists: (input, meta) =>
        withFilesRuntime(options, input, (files, mapped) =>
          files.fs.exists(mapped, callOptions(meta))
        ),
      realPath: (input, meta) =>
        withFilesRuntime(options, input, (files, mapped) =>
          files.fs.realPath(mapped, callOptions(meta))
        ),
      readText: (input, meta) =>
        withFilesRuntime(options, input, (files, mapped) =>
          files.fs.readText(mapped, callOptions(meta))
        ),
      readBytes: async (input, meta) => {
        const acquiredResult = await acquireFilesRuntime(options, input.workspaceId);
        if (!acquiredResult.success) return acquiredResult;
        const acquired = acquiredResult.data;
        const { workspaceId: _, ...rest } = input;
        try {
          const result = await acquired.files.fs.readBytes(
            { ...rest, root: hostPathFromNative(acquired.identity.path) },
            callOptions(meta)
          );
          if (!result.success) {
            await acquired.release();
            return result;
          }
          return ok({
            meta: result.data.meta,
            source: releaseAfter(result.data.chunks(), acquired.release),
          });
        } catch (error) {
          await acquired.release();
          throw error;
        }
      },
      upload: (input, file, meta) =>
        withFilesRuntime(options, input, (files, mapped) =>
          files.fs.upload(mapped, file, callOptions(meta))
        ),
    },
    tree: {
      model: createTreeModelProvider(options),
    },
    content: createContentModelProvider(options),
    mutations: {
      createFile: (input, meta) =>
        withFilesRuntime(options, input, (files, mapped) =>
          files.mutations.createFile(mapped, callOptions(meta))
        ),
      createDirectory: (input, meta) =>
        withFilesRuntime(options, input, (files, mapped) =>
          files.mutations.createDirectory(mapped, callOptions(meta))
        ),
      rename: (input, meta) =>
        withFilesRuntime(options, input, (files, mapped) =>
          files.mutations.rename(mapped, callOptions(meta))
        ),
      move: (input, meta) =>
        withFilesRuntime(options, input, (files, mapped) =>
          files.mutations.move(mapped, callOptions(meta))
        ),
      delete: (input, meta) =>
        withFilesRuntime(options, input, (files, mapped) =>
          files.mutations.delete(mapped, callOptions(meta))
        ),
    },
    saveBuffer: ({ projectId, workspaceId, filePath, content }) =>
      options.editorBuffer.saveBuffer(projectId, workspaceId, filePath, content),
    clearBuffer: ({ projectId, workspaceId, filePath }) =>
      options.editorBuffer.clearBuffer(projectId, workspaceId, filePath),
    listBuffers: ({ projectId, workspaceId }) =>
      options.editorBuffer.listBuffers(projectId, workspaceId),
  });
}

function createTreeModelProvider(
  options: CreateEditorWireControllerOptions
): LeasedLiveModelProvider<typeof editorContract.tree.model> {
  const contract = editorContract.tree.model;
  return {
    kind: 'leasedLiveModelProvider' as const,
    contract,
    acquireState: (key, name) =>
      acquireRuntimeSource(options, key.workspaceId, (client, identity) =>
        client.files.tree.model
          .state(
            {
              root: hostPathFromNative(identity.path),
              sessionId: key.sessionId,
            },
            name
          )
          .asLiveSource()
      ),
    async runMutation(name, envelope) {
      return withWorkspaceRuntime(options, envelope.key.workspaceId, async (client, identity) => {
        // The facade changes only the error schema; mutation inputs remain identical.
        const result = await client.files.tree.model.mutate(name, {
          ...envelope,
          key: {
            root: hostPathFromNative(identity.path),
            sessionId: envelope.key.sessionId,
          },
        } as unknown as GroupMutationEnvelope<typeof filesContract.tree.model, typeof name>);
        return rebindMutationCursors(
          result,
          filesContract.tree.model,
          editorContract.tree.model,
          envelope.key
        );
      }) as ReturnType<LeasedLiveModelProvider<typeof contract>['runMutation']>;
    },
    async dispose() {},
  };
}

function createContentModelProvider(
  options: CreateEditorWireControllerOptions
): LeasedLiveModelProvider<typeof editorContract.content> {
  const contract = editorContract.content;
  return {
    kind: 'leasedLiveModelProvider' as const,
    contract,
    acquireState: (key, name) =>
      acquireRuntimeSource(options, key.workspaceId, (client, identity) =>
        client.files.content
          .state(
            {
              root: hostPathFromNative(identity.path),
              relative: key.relative,
            },
            name
          )
          .asLiveSource()
      ),
    async runMutation(name, envelope) {
      return withWorkspaceRuntime(options, envelope.key.workspaceId, async (client, identity) => {
        // The facade changes only the error schema; mutation inputs remain identical.
        const result = await client.files.content.mutate(name, {
          ...envelope,
          key: {
            root: hostPathFromNative(identity.path),
            relative: envelope.key.relative,
          },
        } as unknown as GroupMutationEnvelope<typeof filesContract.content, typeof name>);
        return rebindMutationCursors(
          result,
          filesContract.content,
          editorContract.content,
          envelope.key
        );
      }) as ReturnType<LeasedLiveModelProvider<typeof contract>['runMutation']>;
    },
    async dispose() {},
  };
}

async function withFilesRuntime<T extends { workspaceId: string }, R, E>(
  options: CreateEditorWireControllerOptions,
  input: T,
  work: (
    files: HostRuntimesClient['files'],
    mapped: Omit<T, 'workspaceId'> & { root: ReturnType<typeof hostPathFromNative> }
  ) => Promise<Result<R, E>>
): Promise<Result<R, E | RuntimeResolveError>> {
  const { workspaceId, ...rest } = input;
  return withWorkspaceRuntime(options, workspaceId, (client, identity) =>
    work(client.files, {
      ...rest,
      root: hostPathFromNative(identity.path),
    })
  );
}

async function withWorkspaceRuntime<T, E>(
  options: CreateEditorWireControllerOptions,
  workspaceId: string,
  work: (client: HostRuntimesClient, identity: WorkspaceIdentity) => Promise<Result<T, E>>
): Promise<Result<T, E | RuntimeResolveError>> {
  const acquiredResult = await acquireRuntimeResult(options, workspaceId);
  if (!acquiredResult.success) return acquiredResult;
  const acquired = acquiredResult.data;
  try {
    return await work(acquired.client, acquired.identity);
  } finally {
    await acquired.release();
  }
}

async function acquireFilesRuntime(
  options: CreateEditorWireControllerOptions,
  workspaceId: string
) {
  const acquired = await acquireRuntimeResult(options, workspaceId);
  if (!acquired.success) return acquired;
  return ok({
    identity: acquired.data.identity,
    files: acquired.data.client.files,
    release: acquired.data.release,
  });
}

async function acquireRuntimeResult(
  options: CreateEditorWireControllerOptions,
  workspaceId: string
) {
  const identity = await requireIdentity(options.workspaceIdentity.resolve(workspaceId));
  const lease = options.runtimes.session(identity.host);
  const runtime = await lease.ready().catch(async (error: unknown) => {
    await lease.release();
    throw error;
  });
  if (!runtime.success) {
    await lease.release();
    return err(runtime.error);
  }
  return ok({
    identity,
    client: runtime.data,
    release: () => lease.release(),
  });
}

async function acquireRuntime(options: CreateEditorWireControllerOptions, workspaceId: string) {
  const result = await acquireRuntimeResult(options, workspaceId);
  if (!result.success) throwEditorRuntimeResolveError(result.error);
  return result.data;
}

function acquireRuntimeSource(
  options: CreateEditorWireControllerOptions,
  workspaceId: string,
  source: (client: HostRuntimesClient, identity: WorkspaceIdentity) => LiveSource
): PendingLease<LiveSource> {
  const acquired = acquireRuntime(options, workspaceId);
  return {
    async ready() {
      const runtime = await acquired;
      return source(runtime.client, runtime.identity);
    },
    async release() {
      // If acquisition failed there is nothing to release; the failure already
      // surfaced through ready() and must not reject again here (an unhandled
      // rejection in the main process is fatal).
      const runtime = await acquired.catch(() => null);
      if (runtime) await runtime.release();
    },
  };
}

async function requireIdentity(
  identityPromise: Promise<WorkspaceIdentity | null>
): Promise<WorkspaceIdentity> {
  const identity = await identityPromise;
  if (!identity) throw new Error('Editor workspace identity was not found');
  return identity;
}

async function* releaseAfter(
  source: AsyncIterable<Uint8Array>,
  release: () => Promise<void>
): AsyncIterable<Uint8Array> {
  try {
    yield* source;
  } finally {
    await release();
  }
}

function callOptions(meta: CallMeta): { signal?: AbortSignal } {
  return meta.signal ? { signal: meta.signal } : {};
}

function rebindMutationCursors<
  ResultType extends Result<{ data: unknown; cursors: readonly { model: string }[] }, unknown>,
>(
  result: ResultType,
  source: { states: Record<string, { id: string }> },
  target: { states: Record<string, { id: string }> },
  key: unknown
): ResultType {
  if (!result.success) return result;
  const ids = new Map(
    Object.entries(source.states).flatMap(([name, state]) => {
      const targetState = target.states[name];
      return targetState ? [[state.id, targetState.id] as const] : [];
    })
  );
  return ok({
    ...result.data,
    cursors: result.data.cursors.map((cursor) => ({
      ...cursor,
      model: ids.get(cursor.model) ?? cursor.model,
      key,
    })),
  }) as unknown as ResultType;
}
