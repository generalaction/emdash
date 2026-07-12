import {
  denormalizeDiffTarget,
  gitContract,
  type gitCheckoutContract,
  type CheckoutSelector,
  type GitCommandError,
  type GitLogOptions,
  type GitSyncProgress,
  type GitTransferProgress,
  type NormalizedDiffTarget,
  type PullJobInput,
  type PushJobInput,
  type SyncJobInput,
} from '@emdash/core/git';
import type { PortableRelativePath } from '@emdash/core/path';
import { err, ok, type Result } from '@emdash/shared';
import {
  createResourceLiveModelHost,
  type LiveJobContext,
  type ResourceLiveModelHost,
} from '@emdash/wire';
import type { GitAllocationGraph } from '../allocation/allocation-graph';
import { expectedGitCommandError } from '../api/errors';
import type { CheckoutResource } from './checkout-resource';

type CheckoutModel = typeof gitCheckoutContract.model;
type FileDiffModel = typeof gitCheckoutContract.fileDiff;
type FileContentModel = typeof gitCheckoutContract.content;

export class GitCheckoutRuntime {
  readonly model: ResourceLiveModelHost<CheckoutModel>;
  readonly fileDiffModel: ResourceLiveModelHost<FileDiffModel>;
  readonly fileContentModel: ResourceLiveModelHost<FileContentModel>;

  private readonly modelHosts = new Map<string, ResourceLiveModelHost<CheckoutModel>>();
  private readonly fileDiffHosts = new Map<string, ResourceLiveModelHost<FileDiffModel>>();
  private readonly fileContentHosts = new Map<string, ResourceLiveModelHost<FileContentModel>>();

  constructor(private readonly allocations: GitAllocationGraph) {
    this.model = this.modelHost(gitContract.checkout.model);
    this.fileDiffModel = this.fileDiffHost(gitContract.checkout.fileDiff);
    this.fileContentModel = this.fileContentHost(gitContract.checkout.content);
  }

  modelHost(contract: CheckoutModel = gitContract.checkout.model) {
    const existing = this.modelHosts.get(contract.id);
    if (existing) return existing;
    const host = createResourceLiveModelHost(contract, {
      acquire: (key) => this.allocations.acquireCheckout(key),
      states: {
        status: ({ resource }) => resource.state('status'),
        head: ({ resource }) => resource.state('head'),
      },
      mutations: {
        stage: (context) => context.resource.stage(context),
        unstage: (context) => context.resource.unstage(context),
        stageAll: (context) => context.resource.stageAll(context),
        unstageAll: (context) => context.resource.unstageAll(context),
        revert: (context) => context.resource.revert(context),
        revertAll: (context) => context.resource.revertAll(context),
        clean: (context) => context.resource.clean(context),
        stageHunk: (context) => context.resource.stageHunk(context),
        unstageHunk: (context) => context.resource.unstageHunk(context),
        discardHunk: (context) => context.resource.discardHunk(context),
        commit: (context) => context.resource.commit(context),
        switch: (context) => context.resource.switch(context),
        reset: (context) => context.resource.reset(context),
        merge: (context) => context.resource.merge(context),
        mergeContinue: (context) => context.resource.mergeContinue(context),
        mergeAbort: (context) => context.resource.mergeAbort(context),
        rebase: (context) => context.resource.rebase(context),
        rebaseContinue: (context) => context.resource.rebaseContinue(context),
        rebaseAbort: (context) => context.resource.rebaseAbort(context),
        rebaseSkip: (context) => context.resource.rebaseSkip(context),
        cherryPick: (context) => context.resource.cherryPick(context),
        revertCommit: (context) => context.resource.revertCommit(context),
        stashPush: (context) => context.resource.stashPush(context),
        stashApply: (context) => context.resource.stashApply(context),
        stashPop: (context) => context.resource.stashPop(context),
      },
      toMutationError: (_name, error) => expectedGitCommandError(error),
    });
    this.modelHosts.set(contract.id, host);
    return host;
  }

  fileDiffHost(contract: FileDiffModel = gitContract.checkout.fileDiff) {
    const existing = this.fileDiffHosts.get(contract.id);
    if (existing) return existing;
    const host = createResourceLiveModelHost(contract, {
      acquire: (key) => this.allocations.acquireCheckout(key),
      states: {
        staleness: ({ resource, key }) =>
          resource.acquireFileDiffStaleness({
            filePath: key.filePath,
            target: key.target,
          }),
      },
    });
    this.fileDiffHosts.set(contract.id, host);
    return host;
  }

  fileContentHost(contract: FileContentModel = gitContract.checkout.content) {
    const existing = this.fileContentHosts.get(contract.id);
    if (existing) return existing;
    const host = createResourceLiveModelHost(contract, {
      acquire: (key) => this.allocations.acquireCheckout(key),
      states: {
        content: ({ resource, key }) =>
          resource.acquireFileContent({ path: key.path, source: key.source }),
      },
    });
    this.fileContentHosts.set(contract.id, host);
    return host;
  }

  getFileDiff(
    input: CheckoutSelector & {
      path: PortableRelativePath;
      target?: NormalizedDiffTarget;
    }
  ) {
    return this.run(input, (checkout) =>
      checkout.getFileDiff(
        input.path,
        input.target ? denormalizeDiffTarget(input.target) : undefined
      )
    );
  }

  getChangedFiles(input: CheckoutSelector & { target: NormalizedDiffTarget }) {
    return this.read(input, (checkout) =>
      checkout.getChangedFiles(denormalizeDiffTarget(input.target))
    );
  }

  isFileTracked(input: CheckoutSelector & { path: PortableRelativePath }) {
    return this.read(input, (checkout) => checkout.isFileTracked(input.path));
  }

  getConflictVersions(input: CheckoutSelector & { path: PortableRelativePath }) {
    return this.run(input, (checkout) => checkout.getConflictVersions(input.path));
  }

  getFileAtRef(input: CheckoutSelector & { filePath: PortableRelativePath; ref: string }) {
    return this.read(input, (checkout) => checkout.getFileAtRef(input.filePath, input.ref));
  }

  getFileAtIndex(input: CheckoutSelector & { filePath: PortableRelativePath }) {
    return this.read(input, (checkout) => checkout.getFileAtIndex(input.filePath));
  }

  getImageAtRef(input: CheckoutSelector & { filePath: PortableRelativePath; ref: string }) {
    return this.read(input, (checkout) => checkout.getImageAtRef(input.filePath, input.ref));
  }

  getImageAtIndex(input: CheckoutSelector & { filePath: PortableRelativePath }) {
    return this.read(input, (checkout) => checkout.getImageAtIndex(input.filePath));
  }

  getLog(input: CheckoutSelector & { options?: GitLogOptions }) {
    return this.read(input, (checkout) => checkout.getLog(input.options));
  }

  getCommit(input: CheckoutSelector & { hash: string }) {
    return this.read(input, (checkout) => checkout.getCommit(input.hash));
  }

  getCommitFiles(input: CheckoutSelector & { hash: string }) {
    return this.read(input, (checkout) => checkout.getCommitFiles(input.hash));
  }

  blame(input: CheckoutSelector & { path: PortableRelativePath; ref?: string }) {
    return this.run(input, (checkout) => checkout.blame(input.path, input.ref));
  }

  push(input: PushJobInput, context: LiveJobContext<GitTransferProgress>) {
    return this.run(input, (checkout) =>
      checkout.push(input.options, {
        signal: context.signal,
        onProgress: context.progress,
      })
    );
  }

  pull(input: PullJobInput, context: LiveJobContext<GitTransferProgress>) {
    return this.run(input, (checkout) =>
      checkout.pull({ signal: context.signal, onProgress: context.progress })
    );
  }

  sync(input: SyncJobInput, context: LiveJobContext<GitSyncProgress>) {
    return this.run(input, (checkout) =>
      checkout.sync({ signal: context.signal, onProgress: context.progress })
    );
  }

  async dispose(): Promise<void> {
    await Promise.all([
      ...[...this.modelHosts.values()].map((host) => host.dispose()),
      ...[...this.fileDiffHosts.values()].map((host) => host.dispose()),
      ...[...this.fileContentHosts.values()].map((host) => host.dispose()),
    ]);
    this.modelHosts.clear();
    this.fileDiffHosts.clear();
    this.fileContentHosts.clear();
  }

  private read<T>(selector: CheckoutSelector, read: (resource: CheckoutResource) => Promise<T>) {
    return this.run(
      selector,
      async (resource): Promise<Result<T, never>> => ok(await read(resource))
    );
  }

  private async run<T, E>(
    selector: CheckoutSelector,
    run: (resource: CheckoutResource) => Promise<Result<T, E>>
  ): Promise<Result<T, E | GitCommandError>> {
    try {
      return await this.allocations.useCheckout(selector, run);
    } catch (error) {
      const expected = expectedGitCommandError(error);
      if (expected) return err(expected);
      throw error;
    }
  }
}
