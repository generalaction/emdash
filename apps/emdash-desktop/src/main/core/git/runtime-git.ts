import type {
  CheckoutHeadState,
  CheckoutStatusState,
  CloneRepositoryError,
  CommitError,
  CreateBranchError,
  DeleteBranchError,
  DiffTarget,
  ExplicitCreateBranchOptions,
  FetchError,
  FetchPrForReviewError,
  FetchPrForReviewOptions,
  GitChange,
  GitCommandError,
  GitLogOptions,
  GitLogResult,
  GitObjectRef,
  GitRefsState,
  GitRemotesState,
  GitRepositoryInfo,
  GitTransferProgress,
  GitWorktreesState,
  ImageReadResult,
  PullError,
  PushError,
} from '@emdash/core/git';
import { gitContract, normalizeDiffTarget } from '@emdash/core/git';
import { err, ok, type Result, type Unsubscribe } from '@emdash/shared';
import {
  createLiveJobReplica,
  LiveJobFailedError,
  ReplicaState,
  type LiveJobClientHandle,
  type LiveJobEndpointDef,
} from '@emdash/wire';
import {
  hostPathFromNative,
  nativePathFromHost,
  relativeRuntimePath,
} from '@shared/core/runtime/paths';
import { getGitRuntimeClient, type GitRuntimeClient } from './runtime-process/host';

type MutationResult<Data, Error> = Promise<Result<Data, Error>>;
type GitClientSource = () => Promise<GitRuntimeClient>;
type NativeGitRepositoryInfo = Omit<GitRepositoryInfo, 'rootPath'> & { rootPath: string };
type NativePathError<Error> = Error extends { path: unknown }
  ? Omit<Error, 'path'> & { path: string }
  : Error;
type NativeCloneRepositoryError = NativePathError<CloneRepositoryError>;

export class RuntimeGit {
  constructor(private readonly getClient: GitClientSource = getGitRuntimeClient) {}

  async inspectPath(nativePath: string) {
    const inspected = await (
      await this.getClient()
    ).inspectPath({
      path: hostPathFromNative(nativePath),
    });
    return inspected.kind === 'repository'
      ? { ...inspected, rootPath: nativePathFromHost(inspected.rootPath) }
      : { ...inspected, path: nativePathFromHost(inspected.path) };
  }

  async ensureRepository(nativePath: string, initIfMissing = false) {
    const result = await (
      await this.getClient()
    ).ensureRepository({
      path: hostPathFromNative(nativePath),
      options: { initIfMissing },
    });
    return result.success
      ? ok({ ...result.data, rootPath: nativePathFromHost(result.data.rootPath) })
      : err({ ...result.error, path: nativePathFromHost(result.error.path) });
  }

  async cloneRepository(
    repositoryUrl: string,
    targetPath: string,
    onProgress?: (progress: GitTransferProgress) => void
  ): Promise<Result<NativeGitRepositoryInfo, NativeCloneRepositoryError>> {
    const client = await this.getClient();
    const result = await runLiveJob<
      typeof gitContract.cloneRepository,
      GitRepositoryInfo,
      CloneRepositoryError
    >(
      gitContract.cloneRepository,
      client.cloneRepository,
      { repositoryUrl, targetPath: hostPathFromNative(targetPath) },
      onProgress
    );
    if (result.success) {
      return ok({ ...result.data, rootPath: nativePathFromHost(result.data.rootPath) });
    }
    const error = result.error;
    return 'path' in error
      ? err({ ...error, path: nativePathFromHost(error.path) } as NativeCloneRepositoryError)
      : err(error as NativeCloneRepositoryError);
  }

  repository(nativePath: string): RuntimeGitRepository {
    return new RuntimeGitRepository(nativePath, this.getClient);
  }

  checkout(nativePath: string): RuntimeGitCheckout {
    return new RuntimeGitCheckout(nativePath, this.getClient);
  }
}

export class RuntimeGitRepository {
  private readonly selector;

  constructor(
    readonly nativePath: string,
    private readonly getClient: GitClientSource = getGitRuntimeClient
  ) {
    this.selector = { repository: hostPathFromNative(nativePath) };
  }

  async getSnapshot(): Promise<{ refs: GitRefsState; remotes: GitRemotesState }> {
    const client = await this.getClient();
    const [refs, remotes] = await Promise.all([
      client.repository.model.state(this.selector, 'refs').snapshot(),
      client.repository.model.state(this.selector, 'remotes').snapshot(),
    ]);
    return { refs: refs.data, remotes: remotes.data };
  }

  async getRefs(): Promise<GitRefsState> {
    return (await (await this.getClient()).repository.model.state(this.selector, 'refs').snapshot())
      .data;
  }

  async getRemotes(): Promise<GitRemotesState> {
    return (
      await (await this.getClient()).repository.model.state(this.selector, 'remotes').snapshot()
    ).data;
  }

  async getDefaultBranch(remote?: string): Promise<Result<string, GitCommandError>> {
    return (await this.getClient()).repository.getDefaultBranch({ ...this.selector, remote });
  }

  getBranchBase(branch: string): Promise<Result<string | null, GitCommandError>> {
    return this.getClient().then((client) =>
      client.repository.getBranchBase({ ...this.selector, branch })
    );
  }

  createBranch(options: ExplicitCreateBranchOptions): MutationResult<void, CreateBranchError> {
    return this.mutate<void, CreateBranchError>('createBranch', { options });
  }

  deleteBranch(branch: string, force?: boolean): MutationResult<void, DeleteBranchError> {
    return this.mutate<void, DeleteBranchError>('deleteBranch', { branch, force });
  }

  addRemote(name: string, url: string): MutationResult<void, GitCommandError> {
    return this.mutate<void, GitCommandError>('addRemote', { name, url });
  }

  setRemoteUrl(name: string, url: string): MutationResult<void, GitCommandError> {
    return this.mutate<void, GitCommandError>('setRemoteUrl', { name, url });
  }

  setUpstream(branch: string, upstream: string | null): MutationResult<void, GitCommandError> {
    return this.mutate<void, GitCommandError>('setUpstream', { branch, upstream });
  }

  setBranchBase(branch: string, base: string): MutationResult<void, GitCommandError> {
    return this.mutate<void, GitCommandError>('setBranchBase', { branch, base });
  }

  listWorktrees(): Promise<Result<GitWorktreesState, GitCommandError>> {
    return this.getClient().then((client) => client.repository.listWorktrees(this.selector));
  }

  addWorktree(options: { path: string; ref: string; newBranch?: string; force?: boolean }) {
    return this.mutate('addWorktree', {
      options: { ...options, path: hostPathFromNative(options.path) },
    });
  }

  removeWorktree(worktreePath: string, force?: boolean): MutationResult<void, GitCommandError> {
    return this.mutate<void, GitCommandError>('removeWorktree', {
      worktreePath: hostPathFromNative(worktreePath),
      force,
    });
  }

  moveWorktree(from: string, to: string): MutationResult<void, GitCommandError> {
    return this.mutate<void, GitCommandError>('moveWorktree', {
      from: hostPathFromNative(from),
      to: hostPathFromNative(to),
    });
  }

  pruneWorktrees(): MutationResult<void, GitCommandError> {
    return this.mutate<void, GitCommandError>('pruneWorktrees', {});
  }

  fetch(
    remote?: string,
    options: { refspec?: string; force?: boolean } = {},
    onProgress?: (progress: GitTransferProgress) => void
  ): Promise<Result<void, FetchError>> {
    return this.runJob(
      gitContract.repository.fetch,
      (client) => client.repository.fetch,
      { ...this.selector, remote, ...options },
      onProgress
    );
  }

  publishBranch(
    branchName: string,
    remote?: string,
    onProgress?: (progress: GitTransferProgress) => void
  ): Promise<Result<{ output: string }, PushError>> {
    return this.runJob(
      gitContract.repository.publishBranch,
      (client) => client.repository.publishBranch,
      { ...this.selector, branchName, remote },
      onProgress
    );
  }

  fetchPrForReview(
    options: FetchPrForReviewOptions,
    onProgress?: (progress: GitTransferProgress) => void
  ): Promise<Result<void, FetchPrForReviewError>> {
    return this.runJob(
      gitContract.repository.fetchPrForReview,
      (client) => client.repository.fetchPrForReview,
      { ...this.selector, options },
      onProgress
    );
  }

  subscribeRemotes(callback: (remotes: GitRemotesState) => void): Unsubscribe {
    let active = true;
    const binding = this.getClient().then(async (client) => {
      const replica = new ReplicaState(client.repository.model.state(this.selector, 'remotes'), {
        schema: gitContract.repository.model.states.remotes.dataSchema,
      });
      await replica.ready;
      if (!active) {
        await replica.dispose();
        return null;
      }
      const unsubscribe = replica.onChange(callback);
      return async () => {
        unsubscribe();
        await replica.dispose();
      };
    });
    return () => {
      active = false;
      void binding.then((dispose) => dispose?.());
    };
  }

  private async mutate<Data, Error>(
    name: Extract<keyof typeof gitContract.repository.model.mutations, string>,
    input: unknown
  ): Promise<Result<Data, Error>> {
    const result = await (
      await this.getClient()
    ).repository.model.mutate(name, {
      key: this.selector,
      input: input as never,
    });
    return (result.success ? ok(result.data.data as Data) : result) as Result<Data, Error>;
  }

  private async runJob<Def extends LiveJobEndpointDef, Data, Error>(
    definition: Def,
    select: (client: GitRuntimeClient) => LiveJobClientHandle<Def>,
    input: Parameters<LiveJobClientHandle<Def>['start']>[0],
    onProgress?: (progress: GitTransferProgress) => void
  ): Promise<Result<Data, Error>> {
    return runLiveJob(definition, select(await this.getClient()), input, onProgress);
  }
}

export class RuntimeGitCheckout {
  private readonly selector;
  readonly repository: RuntimeGitRepository;

  constructor(
    readonly nativePath: string,
    private readonly getClient: GitClientSource = getGitRuntimeClient
  ) {
    this.selector = { checkout: hostPathFromNative(nativePath) };
    this.repository = new RuntimeGitRepository(nativePath, getClient);
  }

  async getStatus(): Promise<CheckoutStatusState> {
    return (await (await this.getClient()).checkout.model.state(this.selector, 'status').snapshot())
      .data;
  }

  async getHead(): Promise<CheckoutHeadState> {
    return (await (await this.getClient()).checkout.model.state(this.selector, 'head').snapshot())
      .data;
  }

  getChangedFiles(target: DiffTarget): Promise<Result<GitChange[], GitCommandError>> {
    return this.getClient().then((client) =>
      client.checkout.getChangedFiles({
        ...this.selector,
        target: normalizeDiffTarget(target),
      })
    );
  }

  isFileTracked(filePath: string): Promise<Result<boolean, GitCommandError>> {
    return this.getClient().then((client) =>
      client.checkout.isFileTracked({ ...this.selector, path: this.filePath(filePath) })
    );
  }

  getFileAtRef(filePath: string, ref: string): Promise<Result<string | null, GitCommandError>> {
    return this.getClient().then((client) =>
      client.checkout.getFileAtRef({
        ...this.selector,
        filePath: this.filePath(filePath),
        ref,
      })
    );
  }

  getFileAtIndex(filePath: string): Promise<Result<string | null, GitCommandError>> {
    return this.getClient().then((client) =>
      client.checkout.getFileAtIndex({ ...this.selector, filePath: this.filePath(filePath) })
    );
  }

  getImageAtRef(filePath: string, ref: string): Promise<Result<ImageReadResult, GitCommandError>> {
    return this.getClient().then((client) =>
      client.checkout.getImageAtRef({
        ...this.selector,
        filePath: this.filePath(filePath),
        ref,
      })
    );
  }

  getImageAtIndex(filePath: string): Promise<Result<ImageReadResult, GitCommandError>> {
    return this.getClient().then((client) =>
      client.checkout.getImageAtIndex({ ...this.selector, filePath: this.filePath(filePath) })
    );
  }

  getLog(options?: GitLogOptions): Promise<Result<GitLogResult, GitCommandError>> {
    return this.getClient().then((client) => client.checkout.getLog({ ...this.selector, options }));
  }

  getCommitFiles(hash: string) {
    return this.getClient().then((client) =>
      client.checkout.getCommitFiles({ ...this.selector, hash })
    );
  }

  async isFileCleanlyTracked(filePath: string): Promise<boolean> {
    const relative = this.filePath(filePath);
    const [index, status] = await Promise.all([
      (await this.getClient()).checkout.getFileAtIndex({
        ...this.selector,
        filePath: relative,
      }),
      this.getStatus(),
    ]);
    if (!index.success || index.data === null || status.kind !== 'ok') return false;
    const entry = status.entries[relative];
    return !entry || (entry.index === 'unmodified' && entry.worktree === 'unmodified');
  }

  stage(paths: string[]): MutationResult<void, GitCommandError> {
    return this.mutate<void, GitCommandError>('stage', {
      paths: paths.map((path) => this.filePath(path)),
    });
  }

  stageAll(): MutationResult<void, GitCommandError> {
    return this.mutate<void, GitCommandError>('stageAll', {});
  }

  unstage(paths: string[]): MutationResult<void, GitCommandError> {
    return this.mutate<void, GitCommandError>('unstage', {
      paths: paths.map((path) => this.filePath(path)),
    });
  }

  unstageAll(): MutationResult<void, GitCommandError> {
    return this.mutate<void, GitCommandError>('unstageAll', {});
  }

  revert(paths: string[]): MutationResult<void, GitCommandError> {
    return this.mutate<void, GitCommandError>('revert', {
      paths: paths.map((path) => this.filePath(path)),
    });
  }

  revertAll(): MutationResult<void, GitCommandError> {
    return this.mutate<void, GitCommandError>('revertAll', {});
  }

  commit(message: string): MutationResult<{ hash: string }, CommitError> {
    return this.mutate<{ hash: string }, CommitError>('commit', { message });
  }

  push(remote?: string): Promise<Result<{ output: string }, PushError>> {
    return this.runJob(gitContract.checkout.push, (client) => client.checkout.push, {
      ...this.selector,
      options: { remote },
    });
  }

  pull(): Promise<Result<{ output: string }, PullError>> {
    return this.runJob(gitContract.checkout.pull, (client) => client.checkout.pull, this.selector);
  }

  private filePath(filePath: string) {
    return relativeRuntimePath(this.selector.checkout, filePath);
  }

  private async mutate<Data, Error>(
    name: Extract<keyof typeof gitContract.checkout.model.mutations, string>,
    input: unknown
  ): Promise<Result<Data, Error>> {
    const result = await (
      await this.getClient()
    ).checkout.model.mutate(name, {
      key: this.selector,
      input: input as never,
    });
    return (result.success ? ok(result.data.data as Data) : result) as Result<Data, Error>;
  }

  private async runJob<Def extends LiveJobEndpointDef, Data, Error>(
    definition: Def,
    select: (client: GitRuntimeClient) => LiveJobClientHandle<Def>,
    input: Parameters<LiveJobClientHandle<Def>['start']>[0]
  ): Promise<Result<Data, Error>> {
    return runLiveJob(definition, select(await this.getClient()), input);
  }
}

export function gitErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
    const type = (error as { type?: unknown }).type;
    if (typeof type === 'string') return type.replaceAll('_', ' ');
  }
  return String(error);
}

async function runLiveJob<Def extends LiveJobEndpointDef, Data, Error>(
  definition: Def,
  handle: LiveJobClientHandle<Def>,
  input: Parameters<LiveJobClientHandle<Def>['start']>[0],
  onProgress?: (progress: GitTransferProgress) => void
): Promise<Result<Data, Error>> {
  const jobs = createLiveJobReplica(definition, handle);
  const lease = await jobs.start(input);
  try {
    const job = await lease.ready();
    const unsubscribe = onProgress ? job.onProgress(onProgress as never) : undefined;
    try {
      return ok((await job.result) as Data);
    } catch (error) {
      if (error instanceof LiveJobFailedError) return err(error.error as Error);
      throw error;
    } finally {
      unsubscribe?.();
    }
  } finally {
    await lease.release();
    await jobs.dispose();
  }
}

export type RuntimeGitObjectRef = GitObjectRef;
