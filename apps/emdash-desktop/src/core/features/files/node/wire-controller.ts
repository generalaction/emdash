import { hostRefEquals, type HostRef } from '@emdash/core/primitives/host/api';
import {
  absoluteBasename,
  absoluteDirname,
  decodeResourceUri,
  formatAbsolute,
  hostFileRef,
  parsePortableRelativePath,
  relativizeHostFileRef,
  ROOT_RELATIVE_PATH,
  type HostAbsolutePath,
  type HostFileRef,
  type PortableRelativePath,
  type ResourceUri,
} from '@emdash/core/primitives/path/api';
import type { FileContentModel, FsError } from '@emdash/core/runtimes/files/api';
import {
  gitContract,
  type GitFileContentState,
  type GitFileSource,
} from '@emdash/core/runtimes/git/api';
import {
  runtimeResolveErrorAsError,
  type HostRuntimesClient,
  type RuntimeBroker,
  type RuntimeResolveError,
} from '@emdash/core/services/runtime-broker/api';
import { err, ok, toPendingLease, type Result } from '@emdash/shared';
import type { Scope } from '@emdash/shared/concurrency';
import type { LeasedLiveModelProvider, LiveModelProvider, LiveSource } from '@emdash/wire/rpc';
import { createController, type CallMeta, type Controller } from '@emdash/wire/rpc';
import { cell, derived, expose, remote, snapshot, type Readable } from '@emdash/wire/state';
import { forwardModelMutation } from '@core/services/runtime-clients/node/forward-live-model';
import { filesWireContract, type FilesContentKey } from '../api';

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

type GitContentSource = Exclude<FilesContentKey['source'], 'disk'>;
type WireGitRef = GitContentSource['ref'];

/**
 * Disk sources forward the files runtime's live source untouched (snapshots,
 * deltas, and mutation cursors pass through). Git-ref sources cannot be
 * forwarded — the git runtime's content state has its own shape — so they are
 * re-hosted through the expose bridge, which maps the checkout content state
 * into the files content model per key (spec §6/§8).
 */
function createContentModelProvider(
  options: CreateFilesWireControllerOptions
): LeasedLiveModelProvider<typeof filesWireContract.content> {
  const contract = filesWireContract.content;
  // lingerMs 0: the renderer-side open-file store owns the single content
  // linger (spec §9); the seam must not stack a second one.
  const gitContent = expose(
    contract,
    { content: (key, scope) => resolveGitContentState(options, key, scope) },
    { lingerMs: 0 }
  );
  return {
    kind: 'leasedLiveModelProvider' as const,
    contract,
    acquireState(key, name) {
      if (key.source !== 'disk') return gitContent.acquireState(key, name);
      return toPendingLease(
        resolveRuntimeSource(options, decodeUri(key.uri).host, (client) =>
          client.files.content.state({ path: decodeUri(key.uri).path }, name).asLiveSource()
        ).then((value) => ({ value, release: async () => {} }))
      );
    },
    async runMutation(name, envelope) {
      const ref = decodeUri(envelope.key.uri);
      if (envelope.key.source !== 'disk') {
        // Git snapshots are read-only (spec §6). The rejection lives here at
        // the controller because the contract cannot constrain a mutation to a
        // subset of the model's keys; it classifies as a seam error instead of
        // reaching any runtime. The cast bridges the deferred mutation-name
        // generic, mirroring the forward arm below.
        return err({ type: 'permission-denied' as const, path: formatAbsolute(ref.path) }) as never;
      }
      return withHostRuntime(options, ref.host, (client) =>
        forwardModelMutation(client.files.content, filesWireContract.content, name, envelope, {
          path: ref.path,
        })
      ) as ReturnType<LeasedLiveModelProvider<typeof contract>['runMutation']>;
    },
    dispose: () => gitContent.dispose(),
  };
}

/**
 * Resolves the live content state for a git-ref key: discovers the containing
 * checkout for the decoded absolute path (never supplied by the caller),
 * subscribes to the git runtime's checkout content model, and maps its states
 * into the files content model. Requests that cannot reach the git machinery —
 * a path outside any checkout, an unusable ref — classify as `unavailable`
 * content states rather than throwing.
 */
async function resolveGitContentState(
  options: CreateFilesWireControllerOptions,
  key: FilesContentKey,
  scope: Scope
): Promise<Readable<FileContentModel | undefined>> {
  if (key.source === 'disk') throw new Error('Disk content is forwarded, not re-hosted');
  const fileRef = decodeUri(key.uri);
  const runtime = await options.runtimes.client(fileRef.host);
  if (!runtime.success) throw runtimeResolveErrorAsError(runtime.error);
  const client = runtime.data;
  const fallbackPath = bestEffortRelativePath(fileRef.path);

  const source = toGitFileSource(key.source.ref);
  if (!source.success) {
    return contentErrorState(fallbackPath, {
      type: 'invalid-path',
      path: formatAbsolute(fileRef.path),
      message: source.error,
    });
  }

  const parent = absoluteDirname(fileRef.path);
  if (!parent) {
    return contentErrorState(fallbackPath, {
      type: 'invalid-path',
      path: formatAbsolute(fileRef.path),
      message: 'A filesystem root cannot be read as a file',
    });
  }

  // The parent directory is inspected instead of the file itself so a file
  // deleted from the working tree still resolves its checkout (spec §6).
  const inspection = await client.git.inspectPath({ path: parent });
  if (inspection.kind === 'inspect-failed') {
    return contentErrorState(fallbackPath, {
      type: 'io',
      path: formatAbsolute(fileRef.path),
      message: inspection.message,
    });
  }
  if (inspection.kind === 'not-repository') {
    return contentErrorState(fallbackPath, {
      type: 'invalid-path',
      path: formatAbsolute(fileRef.path),
      message: 'Path is not inside any git checkout',
    });
  }

  const relative = relativizeHostFileRef(hostFileRef(fileRef.host, inspection.rootPath), fileRef);
  if (!relative.success) {
    return contentErrorState(fallbackPath, {
      type: 'invalid-path',
      path: formatAbsolute(fileRef.path),
      message: relative.error.message,
    });
  }
  const checkoutRelativePath = relative.data;

  const contentModel = remote(gitContract.checkout.content, client.git.checkout.content, {
    scope,
  });
  const upstream = contentModel({
    checkout: inspection.rootPath,
    path: checkoutRelativePath,
    source: source.data,
  }).states.content;
  return derived(() => {
    const state = snapshot(upstream).value;
    return state && toFileContentModel(state, checkoutRelativePath);
  });
}

function toGitFileSource(ref: WireGitRef): Result<GitFileSource, string> {
  switch (ref.kind) {
    case 'head':
      return ok({ kind: 'head' });
    case 'staged':
      return ok({ kind: 'index' });
    case 'unstaged':
      // The unstaged "snapshot" has no git object behind it: the working tree
      // is the disk source.
      return err('Working-tree content is served by the disk source, not a git ref');
    case 'branch':
    case 'commit':
    case 'tag':
      return ok({ kind: 'revision', revision: ref });
  }
}

function toFileContentModel(
  state: GitFileContentState,
  path: PortableRelativePath
): FileContentModel {
  switch (state.kind) {
    case 'text':
      return {
        kind: 'text',
        path,
        etag: `git:${state.oid}`,
        byteSize: state.byteSize,
        readonly: true,
        content: state.content,
        eol: state.content.includes('\r\n') ? 'crlf' : 'lf',
      };
    case 'binary':
      return {
        kind: 'binary',
        path,
        etag: `git:${state.oid}`,
        byteSize: state.byteSize,
        readonly: true,
      };
    case 'missing':
      // The ref resolves but does not contain the path, or the ref itself is
      // unknown — both classify as not-found at this seam.
      return { kind: 'unavailable', path, error: { type: 'not-found', path } };
    case 'unavailable':
      return {
        kind: 'unavailable',
        path,
        error: { type: 'io', path, message: state.error.message },
      };
  }
}

function contentErrorState(
  path: PortableRelativePath,
  error: FsError
): Readable<FileContentModel | undefined> {
  return cell<FileContentModel | undefined>({ kind: 'unavailable', path, error });
}

/**
 * Classified error states surface before any checkout root is known, so the
 * model's relative display path can only be a best effort: the file's name.
 */
function bestEffortRelativePath(path: HostAbsolutePath): PortableRelativePath {
  const parsed = parsePortableRelativePath(absoluteBasename(path));
  return parsed.success ? parsed.data : ROOT_RELATIVE_PATH;
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
