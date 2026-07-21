import { err, ok, type Result } from '@emdash/shared';
import {
  createLiveJobReplica,
  LiveJobFailedError,
  type JobError,
  type JobInput,
  type JobProgress,
  type JobResult,
  type GroupMutationEnvelope,
  type LeasedLiveModelProvider,
  type LiveJobClientHandle,
  type LiveJobContext,
  type LiveJobEndpointDef,
  type LiveSource,
} from '@emdash/wire';
import { createController, type CallMeta, type Controller } from '@emdash/wire/api';
import { hostPathFromNative } from '@core/primitives/desktop-runtime/api';
import { sourceControlContract } from '../api';
import {
  sourceControlGitRuntimeContract as gitContract,
  throwSourceControlRuntimeResolveError,
  type SourceControlHostRuntimesClient as HostRuntimesClient,
  type SourceControlRuntimeBroker,
  type SourceControlRuntimeResolveError as RuntimeResolveError,
  type SourceControlWorkspaceIdentity as WorkspaceIdentity,
  type SourceControlWorkspaceIdentityResolver,
} from '../api/runtime-adapter';

export type CreateSourceControlWireControllerOptions = Readonly<{
  runtimes: SourceControlRuntimeBroker;
  workspaceIdentity: SourceControlWorkspaceIdentityResolver;
}>;

export function createSourceControlWireController(
  options: CreateSourceControlWireControllerOptions
): Controller {
  const repositoryModel = createRepositoryModelProvider(options);
  const checkoutModel = createCheckoutModelProvider(options);
  const fileDiffModel = createFileDiffModelProvider(options);
  const contentModel = createContentModelProvider(options);

  return createController(sourceControlContract, {
    repository: {
      model: repositoryModel,
      listWorktrees: (input, meta) =>
        withRepositoryRuntime(options, input, (git, mapped) =>
          git.repository.listWorktrees(mapped, callOptions(meta))
        ),
      getDefaultBranch: (input, meta) =>
        withRepositoryRuntime(options, input, (git, mapped) =>
          git.repository.getDefaultBranch(mapped, callOptions(meta))
        ),
      getBranchBase: (input, meta) =>
        withRepositoryRuntime(options, input, (git, mapped) =>
          git.repository.getBranchBase(mapped, callOptions(meta))
        ),
      readBlobAtRef: (input, meta) =>
        withRepositoryRuntime(options, input, (git, mapped) =>
          git.repository.readBlobAtRef(mapped, callOptions(meta))
        ),
      fetch: job<typeof sourceControlContract.repository.fetch>((input, context) =>
        runRepositoryJob(
          options,
          gitContract.repository.fetch,
          input,
          context,
          (git) => git.repository.fetch
        )
      ),
      publishBranch: job<typeof sourceControlContract.repository.publishBranch>((input, context) =>
        runRepositoryJob(
          options,
          gitContract.repository.publishBranch,
          input,
          context,
          (git) => git.repository.publishBranch
        )
      ),
      fetchPrForReview: job<typeof sourceControlContract.repository.fetchPrForReview>(
        (input, context) =>
          runRepositoryJob(
            options,
            gitContract.repository.fetchPrForReview,
            input,
            context,
            (git) => git.repository.fetchPrForReview
          )
      ),
    },
    checkout: {
      model: checkoutModel,
      fileDiff: fileDiffModel,
      content: contentModel,
      getFileDiff: (input, meta) =>
        withCheckoutRuntime(options, input, (git, mapped) =>
          git.checkout.getFileDiff(mapped, callOptions(meta))
        ),
      getChangedFiles: (input, meta) =>
        withCheckoutRuntime(options, input, (git, mapped) =>
          git.checkout.getChangedFiles(mapped, callOptions(meta))
        ),
      isFileTracked: (input, meta) =>
        withCheckoutRuntime(options, input, (git, mapped) =>
          git.checkout.isFileTracked(mapped, callOptions(meta))
        ),
      getConflictVersions: (input, meta) =>
        withCheckoutRuntime(options, input, (git, mapped) =>
          git.checkout.getConflictVersions(mapped, callOptions(meta))
        ),
      getFileAtRef: (input, meta) =>
        withCheckoutRuntime(options, input, (git, mapped) =>
          git.checkout.getFileAtRef(mapped, callOptions(meta))
        ),
      getFileAtIndex: (input, meta) =>
        withCheckoutRuntime(options, input, (git, mapped) =>
          git.checkout.getFileAtIndex(mapped, callOptions(meta))
        ),
      getImageAtRef: (input, meta) =>
        withCheckoutRuntime(options, input, (git, mapped) =>
          git.checkout.getImageAtRef(mapped, callOptions(meta))
        ),
      getImageAtIndex: (input, meta) =>
        withCheckoutRuntime(options, input, (git, mapped) =>
          git.checkout.getImageAtIndex(mapped, callOptions(meta))
        ),
      getLog: (input, meta) =>
        withCheckoutRuntime(options, input, (git, mapped) =>
          git.checkout.getLog(mapped, callOptions(meta))
        ),
      getCommit: (input, meta) =>
        withCheckoutRuntime(options, input, (git, mapped) =>
          git.checkout.getCommit(mapped, callOptions(meta))
        ),
      getCommitFiles: (input, meta) =>
        withCheckoutRuntime(options, input, (git, mapped) =>
          git.checkout.getCommitFiles(mapped, callOptions(meta))
        ),
      blame: (input, meta) =>
        withCheckoutRuntime(options, input, (git, mapped) =>
          git.checkout.blame(mapped, callOptions(meta))
        ),
      push: job<typeof sourceControlContract.checkout.push>((input, context) =>
        runCheckoutJob(
          options,
          gitContract.checkout.push,
          input,
          context,
          (git) => git.checkout.push
        )
      ),
      pull: job<typeof sourceControlContract.checkout.pull>((input, context) =>
        runCheckoutJob(
          options,
          gitContract.checkout.pull,
          input,
          context,
          (git) => git.checkout.pull
        )
      ),
      sync: job<typeof sourceControlContract.checkout.sync>((input, context) =>
        runCheckoutJob(
          options,
          gitContract.checkout.sync,
          input,
          context,
          (git) => git.checkout.sync
        )
      ),
    },
  });
}

function createRepositoryModelProvider({
  runtimes,
  workspaceIdentity,
}: CreateSourceControlWireControllerOptions): LeasedLiveModelProvider<
  typeof sourceControlContract.repository.model
> {
  const contract = sourceControlContract.repository.model;
  return {
    kind: 'leasedLiveModelProvider',
    contract,
    acquireState: (key, name) => ({
      ready: () =>
        resolveRuntimeSource(
          runtimes,
          workspaceIdentity.resolveProject(key.projectId),
          (client, id) =>
            client.git.repository.model
              .state({ repository: hostPathFromNative(id.path) }, name)
              .asLiveSource()
        ),
      release: async () => {},
    }),
    async runMutation(name, envelope) {
      return withIdentityRuntime(
        runtimes,
        workspaceIdentity.resolveProject(envelope.key.projectId),
        async (client, identity) => {
          // The facade changes only the error schema; mutation inputs remain identical.
          const result = await client.git.repository.model.mutate(name, {
            ...envelope,
            key: { repository: hostPathFromNative(identity.path) },
          } as unknown as GroupMutationEnvelope<typeof gitContract.repository.model, typeof name>);
          return rebindMutationCursors(
            result,
            gitContract.repository.model,
            sourceControlContract.repository.model,
            envelope.key
          );
        }
      ) as ReturnType<LeasedLiveModelProvider<typeof contract>['runMutation']>;
    },
    async dispose() {},
  };
}

function createCheckoutModelProvider({
  runtimes,
  workspaceIdentity,
}: CreateSourceControlWireControllerOptions): LeasedLiveModelProvider<
  typeof sourceControlContract.checkout.model
> {
  const contract = sourceControlContract.checkout.model;
  return {
    kind: 'leasedLiveModelProvider',
    contract,
    acquireState: (key, name) => ({
      ready: () =>
        resolveRuntimeSource(
          runtimes,
          workspaceIdentity.resolve(key.workspaceId),
          (client, identity) =>
            client.git.checkout.model
              .state({ checkout: hostPathFromNative(identity.path) }, name)
              .asLiveSource()
        ),
      release: async () => {},
    }),
    async runMutation(name, envelope) {
      return withIdentityRuntime(
        runtimes,
        workspaceIdentity.resolve(envelope.key.workspaceId),
        async (client, identity) => {
          // The facade changes only the error schema; mutation inputs remain identical.
          const result = await client.git.checkout.model.mutate(name, {
            ...envelope,
            key: { checkout: hostPathFromNative(identity.path) },
          } as unknown as GroupMutationEnvelope<typeof gitContract.checkout.model, typeof name>);
          return rebindMutationCursors(
            result,
            gitContract.checkout.model,
            sourceControlContract.checkout.model,
            envelope.key
          );
        }
      ) as ReturnType<LeasedLiveModelProvider<typeof contract>['runMutation']>;
    },
    async dispose() {},
  };
}

function createFileDiffModelProvider({
  runtimes,
  workspaceIdentity,
}: CreateSourceControlWireControllerOptions): LeasedLiveModelProvider<
  typeof sourceControlContract.checkout.fileDiff
> {
  const contract = sourceControlContract.checkout.fileDiff;
  return {
    kind: 'leasedLiveModelProvider',
    contract,
    acquireState: (key, name) => ({
      ready: () =>
        resolveRuntimeSource(
          runtimes,
          workspaceIdentity.resolve(key.workspaceId),
          (client, identity) =>
            client.git.checkout.fileDiff
              .state(
                {
                  ...withoutWorkspaceId(key),
                  checkout: hostPathFromNative(identity.path),
                },
                name
              )
              .asLiveSource()
        ),
      release: async () => {},
    }),
    async runMutation() {
      throw new Error(`Live model '${contract.id}' has no mutations`);
    },
    async dispose() {},
  };
}

function createContentModelProvider({
  runtimes,
  workspaceIdentity,
}: CreateSourceControlWireControllerOptions): LeasedLiveModelProvider<
  typeof sourceControlContract.checkout.content
> {
  const contract = sourceControlContract.checkout.content;
  return {
    kind: 'leasedLiveModelProvider',
    contract,
    acquireState: (key, name) => ({
      ready: () =>
        resolveRuntimeSource(
          runtimes,
          workspaceIdentity.resolve(key.workspaceId),
          (client, identity) =>
            client.git.checkout.content
              .state(
                {
                  ...withoutWorkspaceId(key),
                  checkout: hostPathFromNative(identity.path),
                },
                name
              )
              .asLiveSource()
        ),
      release: async () => {},
    }),
    async runMutation() {
      throw new Error(`Live model '${contract.id}' has no mutations`);
    },
    async dispose() {},
  };
}

async function withRepositoryRuntime<T extends { projectId: string }, R, E>(
  options: CreateSourceControlWireControllerOptions,
  input: T,
  work: (
    git: HostRuntimesClient['git'],
    mapped: Omit<T, 'projectId'> & { repository: ReturnType<typeof hostPathFromNative> }
  ) => Promise<Result<R, E>>
): Promise<Result<R, E | RuntimeResolveError>> {
  const { projectId, ...rest } = input;
  return withIdentityRuntime(
    options.runtimes,
    options.workspaceIdentity.resolveProject(projectId),
    (client, identity) =>
      work(client.git, {
        ...rest,
        repository: hostPathFromNative(identity.path),
      })
  );
}

async function withCheckoutRuntime<T extends { workspaceId: string }, R, E>(
  options: CreateSourceControlWireControllerOptions,
  input: T,
  work: (
    git: HostRuntimesClient['git'],
    mapped: Omit<T, 'workspaceId'> & { checkout: ReturnType<typeof hostPathFromNative> }
  ) => Promise<Result<R, E>>
): Promise<Result<R, E | RuntimeResolveError>> {
  const { workspaceId, ...rest } = input;
  return withIdentityRuntime(
    options.runtimes,
    options.workspaceIdentity.resolve(workspaceId),
    (client, identity) =>
      work(client.git, {
        ...rest,
        checkout: hostPathFromNative(identity.path),
      })
  );
}

async function withIdentityRuntime<T, E>(
  runtimes: SourceControlRuntimeBroker,
  identityPromise: Promise<WorkspaceIdentity | null>,
  work: (client: HostRuntimesClient, identity: WorkspaceIdentity) => Promise<Result<T, E>>
): Promise<Result<T, E | RuntimeResolveError>> {
  const identity = await requireIdentity(identityPromise);
  const runtime = await runtimes.client(identity.host);
  if (!runtime.success) return err(runtime.error);
  return await work(runtime.data, identity);
}

async function resolveRuntimeSource(
  runtimes: SourceControlRuntimeBroker,
  identityPromise: Promise<WorkspaceIdentity | null>,
  source: (client: HostRuntimesClient, identity: WorkspaceIdentity) => LiveSource
): Promise<LiveSource> {
  const identity = await requireIdentity(identityPromise);
  const runtime = await runtimes.client(identity.host);
  if (!runtime.success) throwSourceControlRuntimeResolveError(runtime.error);
  return source(runtime.data, identity);
}

async function requireIdentity(
  identityPromise: Promise<WorkspaceIdentity | null>
): Promise<WorkspaceIdentity> {
  const identity = await identityPromise;
  if (!identity) throw new Error('Source-control workspace identity was not found');
  return identity;
}

function withoutWorkspaceId<T extends { workspaceId: string }>(input: T): Omit<T, 'workspaceId'> {
  const { workspaceId: _, ...rest } = input;
  return rest;
}

function callOptions(meta: CallMeta): { signal?: AbortSignal } {
  return meta.signal ? { signal: meta.signal } : {};
}

function job<Def extends LiveJobEndpointDef>(
  run: (
    input: JobInput<Def>,
    context: LiveJobContext<JobProgress<Def>>
  ) => Promise<Result<JobResult<Def>, JobError<Def>>>
): { run: typeof run } {
  return { run };
}

async function runRepositoryJob<
  Def extends LiveJobEndpointDef,
  Input extends { projectId: string },
>(
  options: CreateSourceControlWireControllerOptions,
  definition: Def,
  input: Input,
  context: LiveJobContext<JobProgress<Def>>,
  handle: (git: HostRuntimesClient['git']) => LiveJobClientHandle<Def>
): Promise<Result<JobResult<Def>, JobError<Def> | RuntimeResolveError>> {
  const { projectId, ...rest } = input;
  return withIdentityRuntime(
    options.runtimes,
    options.workspaceIdentity.resolveProject(projectId),
    (client, identity) =>
      runUpstreamJob(
        definition,
        handle(client.git),
        {
          ...rest,
          repository: hostPathFromNative(identity.path),
        } as JobInput<Def>,
        context
      )
  );
}

async function runCheckoutJob<
  Def extends LiveJobEndpointDef,
  Input extends { workspaceId: string },
>(
  options: CreateSourceControlWireControllerOptions,
  definition: Def,
  input: Input,
  context: LiveJobContext<JobProgress<Def>>,
  handle: (git: HostRuntimesClient['git']) => LiveJobClientHandle<Def>
): Promise<Result<JobResult<Def>, JobError<Def> | RuntimeResolveError>> {
  const { workspaceId, ...rest } = input;
  return withIdentityRuntime(
    options.runtimes,
    options.workspaceIdentity.resolve(workspaceId),
    (client, identity) =>
      runUpstreamJob(
        definition,
        handle(client.git),
        {
          ...rest,
          checkout: hostPathFromNative(identity.path),
        } as JobInput<Def>,
        context
      )
  );
}

async function runUpstreamJob<Def extends LiveJobEndpointDef>(
  definition: Def,
  handle: LiveJobClientHandle<Def>,
  input: JobInput<Def>,
  context: LiveJobContext<JobProgress<Def>>
): Promise<Result<JobResult<Def>, JobError<Def>>> {
  const jobs = createLiveJobReplica(definition, handle);
  const lease = await jobs.start(input);
  try {
    const running = await lease.ready();
    const unsubscribe = running.onProgress(context.progress);
    const cancel = () => void running.cancel();
    context.signal.addEventListener('abort', cancel, { once: true });
    if (context.signal.aborted) cancel();
    try {
      return ok(await running.result);
    } catch (error) {
      if (error instanceof LiveJobFailedError) return err(error.error as JobError<Def>);
      throw error;
    } finally {
      context.signal.removeEventListener('abort', cancel);
      unsubscribe();
    }
  } finally {
    await lease.release();
    await jobs.dispose();
  }
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
