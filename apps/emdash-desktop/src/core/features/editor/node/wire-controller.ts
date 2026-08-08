import type { HostAbsolutePath, PortableRelativePath } from '@emdash/core/primitives/path/api';
import { err, ok, type Result } from '@emdash/shared';
import type { LiveModelProvider, LiveSource } from '@emdash/wire/rpc';
import { createController, type CallMeta, type Controller } from '@emdash/wire/rpc';
import { hostPathFromNative, resolveRelativePath } from '@core/primitives/desktop-runtime/api';
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
        withFilesRuntime(options, input, (files, path) =>
          files.fs.exists({ path }, callOptions(meta))
        ),
      realPath: (input, meta) =>
        withFilesRuntime(options, input, (files, path) =>
          files.fs.realPath({ path }, callOptions(meta))
        ),
      readText: (input, meta) =>
        withFilesRuntime(options, input, (files, path) =>
          files.fs.readText({ path, options: input.options }, callOptions(meta))
        ),
      readBytes: async (input, meta) => {
        const acquiredResult = await acquireFilesRuntime(options, input.workspaceId);
        if (!acquiredResult.success) return acquiredResult;
        const acquired = acquiredResult.data;
        const result = await acquired.files.fs.readBytes(
          {
            path: workspaceAbsolutePath(acquired.identity, input.relative),
            options: input.options,
          },
          callOptions(meta)
        );
        if (!result.success) return result;
        return ok({ meta: result.data.meta, source: result.data.chunks() });
      },
      upload: (input, file, meta) =>
        withFilesRuntime(options, input, (files, path) =>
          files.fs.upload({ path, overwrite: input.overwrite }, file, callOptions(meta))
        ),
      createDirectory: (input, meta) =>
        withFilesRuntime(options, input, (files, path) =>
          files.fs.createDirectory({ path }, callOptions(meta))
        ),
      delete: (input, meta) =>
        withFilesRuntime(options, input, (files, path) =>
          files.fs.delete({ path, recursive: input.recursive }, callOptions(meta))
        ),
    },
    tree: {
      model: createTreeModelProvider(options),
    },
    content: createContentModelProvider(options),
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

/**
 * Resolves the workspace-relative key to the host-absolute path the files
 * runtime's `fs` surface is keyed by (spec §3.4).
 */
async function withFilesRuntime<R, E>(
  options: CreateEditorWireControllerOptions,
  input: { workspaceId: string; relative: PortableRelativePath },
  work: (files: HostRuntimesClient['files'], path: HostAbsolutePath) => Promise<Result<R, E>>
): Promise<Result<R, E | RuntimeResolveError>> {
  return withWorkspaceRuntime(options, input.workspaceId, (client, identity) =>
    work(client.files, workspaceAbsolutePath(identity, input.relative))
  );
}

function workspaceAbsolutePath(
  identity: WorkspaceIdentity,
  relative: PortableRelativePath
): HostAbsolutePath {
  return resolveRelativePath(hostPathFromNative(identity.path), relative);
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
