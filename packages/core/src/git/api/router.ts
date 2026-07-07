import type { Lease } from '@emdash/shared';
import { implement } from '@orpc/server';
import { RPCHandler } from '@orpc/server/message-port';
import { streamLiveUpdates } from '../../live/adapters/orpc';
import type { LiveModelServer } from '../../live/model';
import type { LiveUpdate } from '../../live/protocol';
import type { IGitCheckout } from '../checkout/types';
import type { IGitRepository } from '../repository/types';
import type { CheckoutLease, IGitRuntime, RepoLease } from '../types';
import { gitContract } from './contract';
import type { FileDiffStalenessEvent } from './queries';

const i = implement(gitContract);

type RepoInput = { repositoryRoot: string };
type CheckoutInput = { checkoutPath: string };

export function createGitRouter(runtime: IGitRuntime) {
  const repositories = new Map<string, Promise<RepoLease>>();
  const checkouts = new Map<string, Promise<CheckoutLease>>();
  let disposed = false;

  const repositoryLease = (repositoryRoot: string): Promise<RepoLease> => {
    assertOpen();
    let lease = repositories.get(repositoryRoot);
    if (!lease) {
      lease = runtime.openRepository(repositoryRoot);
      repositories.set(repositoryRoot, lease);
      evictOnFailure(repositories, repositoryRoot, lease);
    }
    return lease;
  };

  const checkoutLease = (checkoutPath: string): Promise<CheckoutLease> => {
    assertOpen();
    let lease = checkouts.get(checkoutPath);
    if (!lease) {
      lease = runtime.openCheckout(checkoutPath);
      checkouts.set(checkoutPath, lease);
      evictOnFailure(checkouts, checkoutPath, lease);
    }
    return lease;
  };

  const repository = async (input: RepoInput): Promise<IGitRepository> =>
    (await repositoryLease(input.repositoryRoot)).value;

  const checkout = async (input: CheckoutInput): Promise<IGitCheckout> =>
    (await checkoutLease(input.checkoutPath)).value;

  const router = i.router({
    inspectPath: i.inspectPath.handler(({ input }) => runtime.inspectPath(input.path)),
    ensureRepository: i.ensureRepository.handler(({ input }) =>
      runtime.ensureRepository(input.path, input.options)
    ),
    cloneRepository: i.cloneRepository.handler(({ input }) =>
      runtime.cloneRepository(input.repositoryUrl, input.targetPath)
    ),
    repository: {
      refs: {
        snapshot: i.repository.refs.snapshot.handler(async ({ input }) => {
          const repoInput = input as RepoInput;
          return (await repository(repoInput)).refs.snapshot();
        }),
        subscribe: i.repository.refs.subscribe.handler(({ input, signal }) => {
          const repoInput = input as RepoInput;
          return streamModel(repository(repoInput), (repo) => repo.refs, signal);
        }),
        unsubscribe: i.repository.refs.unsubscribe.handler(() => undefined),
      },
      remotes: {
        snapshot: i.repository.remotes.snapshot.handler(async ({ input }) => {
          const repoInput = input as RepoInput;
          return (await repository(repoInput)).remotes.snapshot();
        }),
        subscribe: i.repository.remotes.subscribe.handler(({ input, signal }) => {
          const repoInput = input as RepoInput;
          return streamModel(repository(repoInput), (repo) => repo.remotes, signal);
        }),
        unsubscribe: i.repository.remotes.unsubscribe.handler(() => undefined),
      },
      stashes: {
        snapshot: i.repository.stashes.snapshot.handler(async ({ input }) => {
          const repoInput = input as RepoInput;
          return (await repository(repoInput)).stashes.snapshot();
        }),
        subscribe: i.repository.stashes.subscribe.handler(({ input, signal }) => {
          const repoInput = input as RepoInput;
          return streamModel(repository(repoInput), (repo) => repo.stashes, signal);
        }),
        unsubscribe: i.repository.stashes.unsubscribe.handler(() => undefined),
      },

      listCheckouts: i.repository.listCheckouts.handler(async ({ input }) =>
        (await repository(input)).listCheckouts()
      ),
      addCheckout: i.repository.addCheckout.handler(async ({ input }) =>
        (await repository(input)).addCheckout(input.options)
      ),
      removeCheckout: i.repository.removeCheckout.handler(async ({ input }) =>
        (await repository(input)).removeCheckout(input.checkoutPath, input.force)
      ),
      pruneCheckouts: i.repository.pruneCheckouts.handler(async ({ input }) =>
        (await repository(input)).pruneCheckouts()
      ),
      createBranch: i.repository.createBranch.handler(async ({ input }) =>
        (await repository(input)).createBranch(input.options)
      ),
      deleteBranch: i.repository.deleteBranch.handler(async ({ input }) =>
        (await repository(input)).deleteBranch(input.branch, input.force)
      ),
      renameBranch: i.repository.renameBranch.handler(async ({ input }) =>
        (await repository(input)).renameBranch(input.oldName, input.newName)
      ),
      setUpstream: i.repository.setUpstream.handler(async ({ input }) =>
        (await repository(input)).setUpstream(input.branch, input.upstream)
      ),
      createTag: i.repository.createTag.handler(async ({ input }) =>
        (await repository(input)).createTag(input.options)
      ),
      deleteTag: i.repository.deleteTag.handler(async ({ input }) =>
        (await repository(input)).deleteTag(input.name)
      ),
      addRemote: i.repository.addRemote.handler(async ({ input }) =>
        (await repository(input)).addRemote(input.name, input.url)
      ),
      removeRemote: i.repository.removeRemote.handler(async ({ input }) =>
        (await repository(input)).removeRemote(input.name)
      ),
      fetch: i.repository.fetch.handler(async ({ input }) =>
        (await repository(input)).fetch(input.remote)
      ),
      publishBranch: i.repository.publishBranch.handler(async ({ input }) =>
        (await repository(input)).publishBranch(input.branchName, input.remote)
      ),
      getDefaultBranch: i.repository.getDefaultBranch.handler(async ({ input }) =>
        (await repository(input)).getDefaultBranch(input.remote)
      ),
      fetchPrForReview: i.repository.fetchPrForReview.handler(async ({ input }) =>
        (await repository(input)).fetchPrForReview(input.options)
      ),
      readBlobAtRef: i.repository.readBlobAtRef.handler(async ({ input }) =>
        (await repository(input)).readBlobAtRef(input.ref, input.filePath)
      ),
      stashDrop: i.repository.stashDrop.handler(async ({ input }) =>
        (await repository(input)).stashDrop(input.stashIndex)
      ),
    },
    checkout: {
      status: {
        snapshot: i.checkout.status.snapshot.handler(async ({ input }) => {
          const checkoutInput = input as CheckoutInput;
          return (await checkout(checkoutInput)).status.snapshot();
        }),
        subscribe: i.checkout.status.subscribe.handler(({ input, signal }) => {
          const checkoutInput = input as CheckoutInput;
          return streamModel(checkout(checkoutInput), (co) => co.status, signal);
        }),
        unsubscribe: i.checkout.status.unsubscribe.handler(() => undefined),
      },
      head: {
        snapshot: i.checkout.head.snapshot.handler(async ({ input }) => {
          const checkoutInput = input as CheckoutInput;
          return (await checkout(checkoutInput)).head.snapshot();
        }),
        subscribe: i.checkout.head.subscribe.handler(({ input, signal }) => {
          const checkoutInput = input as CheckoutInput;
          return streamModel(checkout(checkoutInput), (co) => co.head, signal);
        }),
        unsubscribe: i.checkout.head.unsubscribe.handler(() => undefined),
      },

      stage: i.checkout.stage.handler(async ({ input }) =>
        (await checkout(input)).stage(input.paths)
      ),
      unstage: i.checkout.unstage.handler(async ({ input }) =>
        (await checkout(input)).unstage(input.paths)
      ),
      stageAll: i.checkout.stageAll.handler(async ({ input }) =>
        (await checkout(input)).stageAll()
      ),
      unstageAll: i.checkout.unstageAll.handler(async ({ input }) =>
        (await checkout(input)).unstageAll()
      ),
      revert: i.checkout.revert.handler(async ({ input }) =>
        (await checkout(input)).revert(input.paths)
      ),
      revertAll: i.checkout.revertAll.handler(async ({ input }) =>
        (await checkout(input)).revertAll()
      ),
      clean: i.checkout.clean.handler(async ({ input }) =>
        (await checkout(input)).clean({ paths: input.paths, force: input.force })
      ),
      stageHunk: i.checkout.stageHunk.handler(async ({ input }) =>
        (await checkout(input)).stageHunk(input.path, input.hunkHeader)
      ),
      unstageHunk: i.checkout.unstageHunk.handler(async ({ input }) =>
        (await checkout(input)).unstageHunk(input.path, input.hunkHeader)
      ),
      discardHunk: i.checkout.discardHunk.handler(async ({ input }) =>
        (await checkout(input)).discardHunk(input.path, input.hunkHeader)
      ),
      commit: i.checkout.commit.handler(async ({ input }) =>
        (await checkout(input)).commit(input.message, input.options)
      ),
      switch: i.checkout.switch.handler(async ({ input }) =>
        (await checkout(input)).switch(input.options)
      ),
      reset: i.checkout.reset.handler(async ({ input }) =>
        (await checkout(input)).reset(input.ref, input.mode)
      ),
      merge: i.checkout.merge.handler(async ({ input }) =>
        (await checkout(input)).merge(input.options)
      ),
      mergeContinue: i.checkout.mergeContinue.handler(async ({ input }) =>
        (await checkout(input)).mergeContinue(input.message)
      ),
      mergeAbort: i.checkout.mergeAbort.handler(async ({ input }) =>
        (await checkout(input)).mergeAbort()
      ),
      rebase: i.checkout.rebase.handler(async ({ input }) =>
        (await checkout(input)).rebase(input.options)
      ),
      rebaseContinue: i.checkout.rebaseContinue.handler(async ({ input }) =>
        (await checkout(input)).rebaseContinue()
      ),
      rebaseAbort: i.checkout.rebaseAbort.handler(async ({ input }) =>
        (await checkout(input)).rebaseAbort()
      ),
      rebaseSkip: i.checkout.rebaseSkip.handler(async ({ input }) =>
        (await checkout(input)).rebaseSkip()
      ),
      cherryPick: i.checkout.cherryPick.handler(async ({ input }) =>
        (await checkout(input)).cherryPick(input.commits, input.noCommit)
      ),
      revertCommit: i.checkout.revertCommit.handler(async ({ input }) =>
        (await checkout(input)).revertCommit(input.commit, input.noCommit)
      ),
      push: i.checkout.push.handler(async ({ input }) =>
        (await checkout(input)).push(input.options)
      ),
      pull: i.checkout.pull.handler(async ({ input }) => (await checkout(input)).pull()),
      sync: i.checkout.sync.handler(async ({ input }) => (await checkout(input)).sync()),
      stashPush: i.checkout.stashPush.handler(async ({ input }) =>
        (await checkout(input)).stashPush(input.options)
      ),
      stashApply: i.checkout.stashApply.handler(async ({ input }) =>
        (await checkout(input)).stashApply(input.stashIndex)
      ),
      stashPop: i.checkout.stashPop.handler(async ({ input }) =>
        (await checkout(input)).stashPop(input.stashIndex)
      ),
      getFileDiff: i.checkout.getFileDiff.handler(async ({ input }) =>
        (await checkout(input)).getFileDiff(input.path, input.base)
      ),
      subscribeFileDiff: i.checkout.subscribeFileDiff.handler(({ input, signal }) =>
        streamFileDiff(checkout(input), input.path, signal)
      ),
      getChangedFiles: i.checkout.getChangedFiles.handler(async ({ input }) =>
        (await checkout(input)).getChangedFiles(input.base)
      ),
      getConflictVersions: i.checkout.getConflictVersions.handler(async ({ input }) =>
        (await checkout(input)).getConflictVersions(input.path)
      ),
      getFileAtRef: i.checkout.getFileAtRef.handler(async ({ input }) =>
        (await checkout(input)).getFileAtRef(input.filePath, input.ref)
      ),
      getFileAtIndex: i.checkout.getFileAtIndex.handler(async ({ input }) =>
        (await checkout(input)).getFileAtIndex(input.filePath)
      ),
      getImageAtRef: i.checkout.getImageAtRef.handler(async ({ input }) =>
        (await checkout(input)).getImageAtRef(input.filePath, input.ref)
      ),
      getImageAtIndex: i.checkout.getImageAtIndex.handler(async ({ input }) =>
        (await checkout(input)).getImageAtIndex(input.filePath)
      ),
      getLog: i.checkout.getLog.handler(async ({ input }) =>
        (await checkout(input)).getLog(input.options)
      ),
      getCommit: i.checkout.getCommit.handler(async ({ input }) =>
        (await checkout(input)).getCommit(input.hash)
      ),
      getCommitFiles: i.checkout.getCommitFiles.handler(async ({ input }) =>
        (await checkout(input)).getCommitFiles(input.hash)
      ),
      blame: i.checkout.blame.handler(async ({ input }) =>
        (await checkout(input)).blame(input.path, input.ref)
      ),
    },
  });

  async function dispose(): Promise<void> {
    disposed = true;
    const checkoutReleases = [...checkouts.values()].map((lease) => releaseLease(lease));
    const repositoryReleases = [...repositories.values()].map((lease) => releaseLease(lease));
    checkouts.clear();
    repositories.clear();
    await Promise.all([...checkoutReleases, ...repositoryReleases]);
  }

  function assertOpen(): void {
    if (disposed) throw new Error('Git router disposed');
  }

  return { router, dispose };
}

export type GitRouterHandle = ReturnType<typeof createGitRouter>;
export type GitRouter = GitRouterHandle['router'];
export type GitMessagePort = Parameters<RPCHandler<Record<never, never>>['upgrade']>[0];

export function serveGitPort(router: GitRouter, port: GitMessagePort): void {
  new RPCHandler(router).upgrade(port);
}

async function* streamModel<T, R>(
  resource: Promise<R>,
  select: (resource: R) => LiveModelServer<T>,
  signal?: AbortSignal
): AsyncGenerator<LiveUpdate> {
  yield* streamLiveUpdates(select(await resource), signal);
}

async function* streamFileDiff(
  checkout: Promise<IGitCheckout>,
  path: string,
  signal?: AbortSignal
): AsyncGenerator<FileDiffStalenessEvent> {
  const buffer: FileDiffStalenessEvent[] = [];
  let wakeup: (() => void) | null = null;

  const unsubscribe = (await checkout).subscribeFileDiff(path, (event) => {
    buffer.push(event);
    wakeup?.();
  });

  const onAbort = (): void => {
    unsubscribe();
    wakeup?.();
  };
  signal?.addEventListener('abort', onAbort);

  try {
    while (!signal?.aborted) {
      if (buffer.length === 0) {
        await new Promise<void>((resolve) => {
          wakeup = resolve;
        });
        wakeup = null;
      }
      while (buffer.length > 0) {
        yield buffer.shift()!;
      }
    }
  } finally {
    unsubscribe();
    signal?.removeEventListener('abort', onAbort);
  }
}

async function releaseLease<T>(lease: Promise<Lease<T>>): Promise<void> {
  try {
    await (await lease).release();
  } catch {}
}

function evictOnFailure<T>(cache: Map<string, Promise<T>>, key: string, lease: Promise<T>): void {
  lease.catch(() => {
    if (cache.get(key) === lease) cache.delete(key);
  });
}
