import { hostRefEquals, type HostRef } from '@emdash/core/primitives/host/api';
import {
  decodeResourceUri,
  formatAbsolute,
  type HostFileRef,
  type ResourceUri,
} from '@emdash/core/primitives/path/api';
import {
  runtimeResolveErrorAsError,
  type HostRuntimesClient,
  type RuntimeBroker,
  type RuntimeResolveError,
} from '@emdash/core/services/runtime-broker/api';
import { err, ok, type Result } from '@emdash/shared';
import type { LiveModelProvider, LiveSource } from '@emdash/wire/rpc';
import { createController, type CallMeta, type Controller } from '@emdash/wire/rpc';
import { forwardModelMutation } from '@core/services/runtime-clients/node/forward-live-model';
import { filesWireContract } from '../api';

export type FilesRuntimeBroker = Pick<RuntimeBroker, 'client'>;

export type CreateFilesWireControllerOptions = Readonly<{
  runtimes: FilesRuntimeBroker;
}>;

/**
 * Serves the ResourceUri-keyed `files` wire domain: every key decodes to a
 * HostFileRef, the broker resolves the runtimes client for that host, and the
 * absolute path is forwarded to the host's files runtime. No workspaceId→root
 * resolution happens anywhere on this path (spec §2/§8).
 */
export function createFilesWireController(options: CreateFilesWireControllerOptions): Controller {
  return createController(filesWireContract, {
    fs: {
      exists: (input, meta) =>
        withFileRuntime(options, input.uri, (files, ref) =>
          files.fs.exists({ path: ref.path }, callOptions(meta))
        ),
      realPath: (input, meta) =>
        withFileRuntime(options, input.uri, (files, ref) =>
          files.fs.realPath({ path: ref.path }, callOptions(meta))
        ),
      readText: (input, meta) =>
        withFileRuntime(options, input.uri, (files, ref) =>
          files.fs.readText({ path: ref.path, options: input.options }, callOptions(meta))
        ),
      readBytes: async (input, meta) => {
        const ref = decodeUri(input.uri);
        const runtime = await options.runtimes.client(ref.host);
        if (!runtime.success) return err(runtime.error);
        const result = await runtime.data.files.fs.readBytes(
          { path: ref.path, options: input.options },
          callOptions(meta)
        );
        if (!result.success) return result;
        return ok({ meta: result.data.meta, source: result.data.chunks() });
      },
      upload: (input, file, meta) =>
        withFileRuntime(options, input.uri, (files, ref) =>
          files.fs.upload({ path: ref.path, overwrite: input.overwrite }, file, callOptions(meta))
        ),
    },
    tree: {
      model: createTreeModelProvider(options),
    },
    content: createContentModelProvider(options),
    mutations: {
      createFile: (input, meta) =>
        withFileRuntime(options, input.uri, (files, ref) =>
          files.mutations.createFile({ path: ref.path, content: input.content }, callOptions(meta))
        ),
      createDirectory: (input, meta) =>
        withFileRuntime(options, input.uri, (files, ref) =>
          files.mutations.createDirectory({ path: ref.path }, callOptions(meta))
        ),
      rename: (input, meta) =>
        withFilePairRuntime(options, input.uri, input.to, (files, from, to) =>
          files.mutations.rename({ from: from.path, to: to.path }, callOptions(meta))
        ),
      move: (input, meta) =>
        withFilePairRuntime(options, input.uri, input.to, (files, from, to) =>
          files.mutations.move({ from: from.path, to: to.path }, callOptions(meta))
        ),
      delete: (input, meta) =>
        withFileRuntime(options, input.uri, (files, ref) =>
          files.mutations.delete({ path: ref.path, recursive: input.recursive }, callOptions(meta))
        ),
    },
  });
}

function createTreeModelProvider(
  options: CreateFilesWireControllerOptions
): LiveModelProvider<typeof filesWireContract.tree.model> {
  const contract = filesWireContract.tree.model;
  return {
    kind: 'liveModelProvider' as const,
    contract,
    resolveState: (key, name) =>
      resolveRuntimeSource(options, decodeUri(key.root).host, (client) =>
        client.files.tree.model
          .state(
            {
              root: decodeUri(key.root).path,
              sessionId: key.sessionId,
              exclusions: key.exclusions,
            },
            name
          )
          .asLiveSource()
      ),
    async runMutation(name, envelope) {
      const ref = decodeUri(envelope.key.root);
      return withHostRuntime(options, ref.host, (client) =>
        forwardModelMutation(
          client.files.tree.model,
          filesWireContract.tree.model,
          name,
          envelope,
          {
            root: ref.path,
            sessionId: envelope.key.sessionId,
            exclusions: envelope.key.exclusions,
          }
        )
      ) as ReturnType<LiveModelProvider<typeof contract>['runMutation']>;
    },
  };
}

function createContentModelProvider(
  options: CreateFilesWireControllerOptions
): LiveModelProvider<typeof filesWireContract.content> {
  const contract = filesWireContract.content;
  return {
    kind: 'liveModelProvider' as const,
    contract,
    resolveState: (key, name) =>
      resolveRuntimeSource(options, decodeUri(key.uri).host, (client) =>
        client.files.content.state({ path: decodeUri(key.uri).path }, name).asLiveSource()
      ),
    async runMutation(name, envelope) {
      const ref = decodeUri(envelope.key.uri);
      return withHostRuntime(options, ref.host, (client) =>
        forwardModelMutation(client.files.content, filesWireContract.content, name, envelope, {
          path: ref.path,
        })
      ) as ReturnType<LiveModelProvider<typeof contract>['runMutation']>;
    },
  };
}

async function withFileRuntime<T, E>(
  options: CreateFilesWireControllerOptions,
  uri: ResourceUri,
  work: (files: HostRuntimesClient['files'], ref: HostFileRef) => Promise<Result<T, E>>
): Promise<Result<T, E | RuntimeResolveError>> {
  const ref = decodeUri(uri);
  return withHostRuntime(options, ref.host, (client) => work(client.files, ref));
}

async function withFilePairRuntime<T, E>(
  options: CreateFilesWireControllerOptions,
  uri: ResourceUri,
  target: ResourceUri,
  work: (
    files: HostRuntimesClient['files'],
    from: HostFileRef,
    to: HostFileRef
  ) => Promise<Result<T, E>>
): Promise<
  Result<T, E | RuntimeResolveError | { type: 'invalid-path'; path: string; message: string }>
> {
  const from = decodeUri(uri);
  const to = decodeUri(target);
  if (!hostRefEquals(from.host, to.host)) {
    return err({
      type: 'invalid-path' as const,
      path: formatAbsolute(to.path),
      message: 'The target must be on the same host as the source',
    });
  }
  return withHostRuntime(options, from.host, (client) => work(client.files, from, to));
}

async function withHostRuntime<T, E>(
  options: CreateFilesWireControllerOptions,
  host: HostRef,
  work: (client: HostRuntimesClient) => Promise<Result<T, E>>
): Promise<Result<T, E | RuntimeResolveError>> {
  const runtime = await options.runtimes.client(host);
  if (!runtime.success) return err(runtime.error);
  return await work(runtime.data);
}

async function resolveRuntimeSource(
  options: CreateFilesWireControllerOptions,
  host: HostRef,
  source: (client: HostRuntimesClient) => LiveSource
): Promise<LiveSource> {
  const runtime = await options.runtimes.client(host);
  if (!runtime.success) throw runtimeResolveErrorAsError(runtime.error);
  return source(runtime.data);
}

/**
 * Keys reaching the controller already passed the contract's ResourceUri
 * schema, so a decode failure here is a programming error, not user input.
 */
function decodeUri(uri: ResourceUri): HostFileRef {
  const decoded = decodeResourceUri(uri);
  if (!decoded.success) throw new Error(`Invalid resource URI: ${decoded.error.message}`);
  return decoded.data;
}

function callOptions(meta: CallMeta): { signal?: AbortSignal } {
  return meta.signal ? { signal: meta.signal } : {};
}
