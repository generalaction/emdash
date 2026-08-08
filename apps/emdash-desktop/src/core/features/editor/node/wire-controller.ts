import { err, ok, type Result } from '@emdash/shared';
import type { LiveModelProvider, LiveSource } from '@emdash/wire/rpc';
import { createController, type CallMeta, type Controller } from '@emdash/wire/rpc';
import { hostPathFromNative } from '@core/primitives/desktop-runtime/api';
import { forwardModelMutation } from '@core/services/runtime-clients/node/forward-live-model';
import { editorContract } from '../api';
import {
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
        const result = await acquired.files.fs.readBytes(
          { ...rest, root: hostPathFromNative(acquired.identity.path) },
          callOptions(meta)
        );
        if (!result.success) return result;
        return ok({ meta: result.data.meta, source: result.data.chunks() });
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
    saveBuffer: ({ uri, content }) => options.editorBuffer.saveBuffer(uri, content),
    clearBuffer: ({ uri }) => options.editorBuffer.clearBuffer(uri),
    listBuffers: ({ root }) => options.editorBuffer.listBuffers(root),
  });
}

function createTreeModelProvider(
  options: CreateEditorWireControllerOptions
): LiveModelProvider<typeof editorContract.tree.model> {
  const contract = editorContract.tree.model;
  return {
    kind: 'liveModelProvider' as const,
    contract,
    resolveState: (key, name) =>
      resolveRuntimeSource(options, key.workspaceId, (client, identity) =>
        client.files.tree.model
          .state(
            {
              root: hostPathFromNative(identity.path),
              sessionId: key.sessionId,
              exclusions: key.exclusions,
            },
            name
          )
          .asLiveSource()
      ),
    async runMutation(name, envelope) {
      return withWorkspaceRuntime(options, envelope.key.workspaceId, (client, identity) =>
        forwardModelMutation(client.files.tree.model, editorContract.tree.model, name, envelope, {
          root: hostPathFromNative(identity.path),
          sessionId: envelope.key.sessionId,
          exclusions: envelope.key.exclusions,
        })
      ) as ReturnType<LiveModelProvider<typeof contract>['runMutation']>;
    },
  };
}

function createContentModelProvider(
  options: CreateEditorWireControllerOptions
): LiveModelProvider<typeof editorContract.content> {
  const contract = editorContract.content;
  return {
    kind: 'liveModelProvider' as const,
    contract,
    resolveState: (key, name) =>
      resolveRuntimeSource(options, key.workspaceId, (client, identity) =>
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
      return withWorkspaceRuntime(options, envelope.key.workspaceId, (client, identity) =>
        forwardModelMutation(client.files.content, editorContract.content, name, envelope, {
          root: hostPathFromNative(identity.path),
          relative: envelope.key.relative,
        })
      ) as ReturnType<LiveModelProvider<typeof contract>['runMutation']>;
    },
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
  return await work(acquired.client, acquired.identity);
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
  });
}

async function acquireRuntimeResult(
  options: CreateEditorWireControllerOptions,
  workspaceId: string
) {
  const identity = await requireIdentity(options.workspaceIdentity.resolve(workspaceId));
  const runtime = await options.runtimes.client(identity.host);
  if (!runtime.success) return err(runtime.error);
  return ok({
    identity,
    client: runtime.data,
  });
}

async function acquireRuntime(options: CreateEditorWireControllerOptions, workspaceId: string) {
  const result = await acquireRuntimeResult(options, workspaceId);
  if (!result.success) throwEditorRuntimeResolveError(result.error);
  return result.data;
}

async function resolveRuntimeSource(
  options: CreateEditorWireControllerOptions,
  workspaceId: string,
  source: (client: HostRuntimesClient, identity: WorkspaceIdentity) => LiveSource
): Promise<LiveSource> {
  const runtime = await acquireRuntime(options, workspaceId);
  return source(runtime.client, runtime.identity);
}

async function requireIdentity(
  identityPromise: Promise<WorkspaceIdentity | null>
): Promise<WorkspaceIdentity> {
  const identity = await identityPromise;
  if (!identity) throw new Error('Editor workspace identity was not found');
  return identity;
}

function callOptions(meta: CallMeta): { signal?: AbortSignal } {
  return meta.signal ? { signal: meta.signal } : {};
}
