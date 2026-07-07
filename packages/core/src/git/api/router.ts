import { onMessagePortClose } from '@orpc/client/message-port';
import { ORPCError } from '@orpc/server';
import { RPCHandler } from '@orpc/server/message-port';
import { streamEvents, streamLiveUpdates } from '../../live/adapters/orpc';
import type { LiveModelServer } from '../../live/model';
import type { LiveJobState } from '../../live/protocol';
import type { LiveJobServer } from '../../live/job';
import type { IGitRuntime } from '../types';
import { i, withCheckout, withRepository, type GitApiContext } from './middlewares';
import { createGitSession, type GitSession } from './session';

export const gitRouter = i.router({
  inspectPath: i.inspectPath.handler(({ context, input }) =>
    context.runtime.inspectPath(input.path)
  ),
  ensureRepository: i.ensureRepository.handler(({ context, input }) =>
    context.runtime.ensureRepository(input.path, input.options)
  ),
  cloneRepository: {
    start: i.cloneRepository.start.handler(({ context, input }) =>
      context.jobs.cloneRepository.start(input)
    ),
    cancel: i.cloneRepository.cancel.handler(({ context, input }) =>
      context.jobs.cloneRepository.cancel(input.jobId)
    ),
    snapshot: i.cloneRepository.snapshot.handler(({ context, input }) =>
      jobOrThrow(context.jobs.cloneRepository, input.jobId).snapshot()
    ),
    subscribe: i.cloneRepository.subscribe.handler(({ context, input, signal }) =>
      streamLiveUpdates(jobOrThrow(context.jobs.cloneRepository, input.jobId), signal)
    ),
    unsubscribe: i.cloneRepository.unsubscribe.handler(() => undefined),
  },
  repository: {
    refs: {
      snapshot: i.repository.refs.snapshot
        .use(withRepository)
        .handler(({ context }) => context.repository.refs.snapshot()),
      subscribe: i.repository.refs.subscribe
        .use(withRepository)
        .handler(({ context, signal }) => streamLiveUpdates(context.repository.refs, signal)),
      unsubscribe: i.repository.refs.unsubscribe.handler(() => undefined),
    },
    remotes: {
      snapshot: i.repository.remotes.snapshot
        .use(withRepository)
        .handler(({ context }) => context.repository.remotes.snapshot()),
      subscribe: i.repository.remotes.subscribe
        .use(withRepository)
        .handler(({ context, signal }) => streamLiveUpdates(context.repository.remotes, signal)),
      unsubscribe: i.repository.remotes.unsubscribe.handler(() => undefined),
    },
    stashes: {
      snapshot: i.repository.stashes.snapshot
        .use(withRepository)
        .handler(({ context }) => context.repository.stashes.snapshot()),
      subscribe: i.repository.stashes.subscribe
        .use(withRepository)
        .handler(({ context, signal }) => streamLiveUpdates(context.repository.stashes, signal)),
      unsubscribe: i.repository.stashes.unsubscribe.handler(() => undefined),
    },

    listCheckouts: i.repository.listCheckouts
      .use(withRepository)
      .handler(({ context }) => context.repository.listCheckouts()),
    addCheckout: i.repository.addCheckout
      .use(withRepository)
      .handler(({ context, input }) => context.repository.addCheckout(input.options)),
    removeCheckout: i.repository.removeCheckout
      .use(withRepository)
      .handler(({ context, input }) =>
        context.repository.removeCheckout(input.checkoutPath, input.force)
      ),
    pruneCheckouts: i.repository.pruneCheckouts
      .use(withRepository)
      .handler(({ context }) => context.repository.pruneCheckouts()),
    createBranch: i.repository.createBranch
      .use(withRepository)
      .handler(({ context, input }) => context.repository.createBranch(input.options)),
    deleteBranch: i.repository.deleteBranch
      .use(withRepository)
      .handler(({ context, input }) => context.repository.deleteBranch(input.branch, input.force)),
    renameBranch: i.repository.renameBranch
      .use(withRepository)
      .handler(({ context, input }) =>
        context.repository.renameBranch(input.oldName, input.newName)
      ),
    setUpstream: i.repository.setUpstream
      .use(withRepository)
      .handler(({ context, input }) =>
        context.repository.setUpstream(input.branch, input.upstream)
      ),
    createTag: i.repository.createTag
      .use(withRepository)
      .handler(({ context, input }) => context.repository.createTag(input.options)),
    deleteTag: i.repository.deleteTag
      .use(withRepository)
      .handler(({ context, input }) => context.repository.deleteTag(input.name)),
    addRemote: i.repository.addRemote
      .use(withRepository)
      .handler(({ context, input }) => context.repository.addRemote(input.name, input.url)),
    removeRemote: i.repository.removeRemote
      .use(withRepository)
      .handler(({ context, input }) => context.repository.removeRemote(input.name)),
    fetch: {
      start: i.repository.fetch.start.handler(({ context, input }) =>
        context.jobs.fetch.start(input)
      ),
      cancel: i.repository.fetch.cancel.handler(({ context, input }) =>
        context.jobs.fetch.cancel(input.jobId)
      ),
      snapshot: i.repository.fetch.snapshot.handler(({ context, input }) =>
        jobOrThrow(context.jobs.fetch, input.jobId).snapshot()
      ),
      subscribe: i.repository.fetch.subscribe.handler(({ context, input, signal }) =>
        streamLiveUpdates(jobOrThrow(context.jobs.fetch, input.jobId), signal)
      ),
      unsubscribe: i.repository.fetch.unsubscribe.handler(() => undefined),
    },
    publishBranch: {
      start: i.repository.publishBranch.start.handler(({ context, input }) =>
        context.jobs.publishBranch.start(input)
      ),
      cancel: i.repository.publishBranch.cancel.handler(({ context, input }) =>
        context.jobs.publishBranch.cancel(input.jobId)
      ),
      snapshot: i.repository.publishBranch.snapshot.handler(({ context, input }) =>
        jobOrThrow(context.jobs.publishBranch, input.jobId).snapshot()
      ),
      subscribe: i.repository.publishBranch.subscribe.handler(({ context, input, signal }) =>
        streamLiveUpdates(jobOrThrow(context.jobs.publishBranch, input.jobId), signal)
      ),
      unsubscribe: i.repository.publishBranch.unsubscribe.handler(() => undefined),
    },
    getDefaultBranch: i.repository.getDefaultBranch
      .use(withRepository)
      .handler(({ context, input }) => context.repository.getDefaultBranch(input.remote)),
    fetchPrForReview: {
      start: i.repository.fetchPrForReview.start.handler(({ context, input }) =>
        context.jobs.fetchPrForReview.start(input)
      ),
      cancel: i.repository.fetchPrForReview.cancel.handler(({ context, input }) =>
        context.jobs.fetchPrForReview.cancel(input.jobId)
      ),
      snapshot: i.repository.fetchPrForReview.snapshot.handler(({ context, input }) =>
        jobOrThrow(context.jobs.fetchPrForReview, input.jobId).snapshot()
      ),
      subscribe: i.repository.fetchPrForReview.subscribe.handler(({ context, input, signal }) =>
        streamLiveUpdates(jobOrThrow(context.jobs.fetchPrForReview, input.jobId), signal)
      ),
      unsubscribe: i.repository.fetchPrForReview.unsubscribe.handler(() => undefined),
    },
    readBlobAtRef: i.repository.readBlobAtRef
      .use(withRepository)
      .handler(({ context, input }) => context.repository.readBlobAtRef(input.ref, input.filePath)),
    stashDrop: i.repository.stashDrop
      .use(withRepository)
      .handler(({ context, input }) => context.repository.stashDrop(input.stashIndex)),
  },
  checkout: {
    status: {
      snapshot: i.checkout.status.snapshot
        .use(withCheckout)
        .handler(({ context }) => context.checkout.status.snapshot()),
      subscribe: i.checkout.status.subscribe
        .use(withCheckout)
        .handler(({ context, signal }) => streamLiveUpdates(context.checkout.status, signal)),
      unsubscribe: i.checkout.status.unsubscribe.handler(() => undefined),
    },
    head: {
      snapshot: i.checkout.head.snapshot
        .use(withCheckout)
        .handler(({ context }) => context.checkout.head.snapshot()),
      subscribe: i.checkout.head.subscribe
        .use(withCheckout)
        .handler(({ context, signal }) => streamLiveUpdates(context.checkout.head, signal)),
      unsubscribe: i.checkout.head.unsubscribe.handler(() => undefined),
    },

    stage: i.checkout.stage
      .use(withCheckout)
      .handler(({ context, input }) => context.checkout.stage(input.paths)),
    unstage: i.checkout.unstage
      .use(withCheckout)
      .handler(({ context, input }) => context.checkout.unstage(input.paths)),
    stageAll: i.checkout.stageAll
      .use(withCheckout)
      .handler(({ context }) => context.checkout.stageAll()),
    unstageAll: i.checkout.unstageAll
      .use(withCheckout)
      .handler(({ context }) => context.checkout.unstageAll()),
    revert: i.checkout.revert
      .use(withCheckout)
      .handler(({ context, input }) => context.checkout.revert(input.paths)),
    revertAll: i.checkout.revertAll
      .use(withCheckout)
      .handler(({ context }) => context.checkout.revertAll()),
    clean: i.checkout.clean
      .use(withCheckout)
      .handler(({ context, input }) =>
        context.checkout.clean({ paths: input.paths, force: input.force })
      ),
    stageHunk: i.checkout.stageHunk
      .use(withCheckout)
      .handler(({ context, input }) => context.checkout.stageHunk(input.path, input.hunkHeader)),
    unstageHunk: i.checkout.unstageHunk
      .use(withCheckout)
      .handler(({ context, input }) => context.checkout.unstageHunk(input.path, input.hunkHeader)),
    discardHunk: i.checkout.discardHunk
      .use(withCheckout)
      .handler(({ context, input }) => context.checkout.discardHunk(input.path, input.hunkHeader)),
    commit: i.checkout.commit
      .use(withCheckout)
      .handler(({ context, input }) => context.checkout.commit(input.message, input.options)),
    switch: i.checkout.switch
      .use(withCheckout)
      .handler(({ context, input }) => context.checkout.switch(input.options)),
    reset: i.checkout.reset
      .use(withCheckout)
      .handler(({ context, input }) => context.checkout.reset(input.ref, input.mode)),
    merge: i.checkout.merge
      .use(withCheckout)
      .handler(({ context, input }) => context.checkout.merge(input.options)),
    mergeContinue: i.checkout.mergeContinue
      .use(withCheckout)
      .handler(({ context, input }) => context.checkout.mergeContinue(input.message)),
    mergeAbort: i.checkout.mergeAbort
      .use(withCheckout)
      .handler(({ context }) => context.checkout.mergeAbort()),
    rebase: i.checkout.rebase
      .use(withCheckout)
      .handler(({ context, input }) => context.checkout.rebase(input.options)),
    rebaseContinue: i.checkout.rebaseContinue
      .use(withCheckout)
      .handler(({ context }) => context.checkout.rebaseContinue()),
    rebaseAbort: i.checkout.rebaseAbort
      .use(withCheckout)
      .handler(({ context }) => context.checkout.rebaseAbort()),
    rebaseSkip: i.checkout.rebaseSkip
      .use(withCheckout)
      .handler(({ context }) => context.checkout.rebaseSkip()),
    cherryPick: i.checkout.cherryPick
      .use(withCheckout)
      .handler(({ context, input }) => context.checkout.cherryPick(input.commits, input.noCommit)),
    revertCommit: i.checkout.revertCommit
      .use(withCheckout)
      .handler(({ context, input }) => context.checkout.revertCommit(input.commit, input.noCommit)),
    push: {
      start: i.checkout.push.start.handler(({ context, input }) => context.jobs.push.start(input)),
      cancel: i.checkout.push.cancel.handler(({ context, input }) =>
        context.jobs.push.cancel(input.jobId)
      ),
      snapshot: i.checkout.push.snapshot.handler(({ context, input }) =>
        jobOrThrow(context.jobs.push, input.jobId).snapshot()
      ),
      subscribe: i.checkout.push.subscribe.handler(({ context, input, signal }) =>
        streamLiveUpdates(jobOrThrow(context.jobs.push, input.jobId), signal)
      ),
      unsubscribe: i.checkout.push.unsubscribe.handler(() => undefined),
    },
    pull: {
      start: i.checkout.pull.start.handler(({ context, input }) => context.jobs.pull.start(input)),
      cancel: i.checkout.pull.cancel.handler(({ context, input }) =>
        context.jobs.pull.cancel(input.jobId)
      ),
      snapshot: i.checkout.pull.snapshot.handler(({ context, input }) =>
        jobOrThrow(context.jobs.pull, input.jobId).snapshot()
      ),
      subscribe: i.checkout.pull.subscribe.handler(({ context, input, signal }) =>
        streamLiveUpdates(jobOrThrow(context.jobs.pull, input.jobId), signal)
      ),
      unsubscribe: i.checkout.pull.unsubscribe.handler(() => undefined),
    },
    sync: {
      start: i.checkout.sync.start.handler(({ context, input }) => context.jobs.sync.start(input)),
      cancel: i.checkout.sync.cancel.handler(({ context, input }) =>
        context.jobs.sync.cancel(input.jobId)
      ),
      snapshot: i.checkout.sync.snapshot.handler(({ context, input }) =>
        jobOrThrow(context.jobs.sync, input.jobId).snapshot()
      ),
      subscribe: i.checkout.sync.subscribe.handler(({ context, input, signal }) =>
        streamLiveUpdates(jobOrThrow(context.jobs.sync, input.jobId), signal)
      ),
      unsubscribe: i.checkout.sync.unsubscribe.handler(() => undefined),
    },
    stashPush: i.checkout.stashPush
      .use(withCheckout)
      .handler(({ context, input }) => context.checkout.stashPush(input.options)),
    stashApply: i.checkout.stashApply
      .use(withCheckout)
      .handler(({ context, input }) => context.checkout.stashApply(input.stashIndex)),
    stashPop: i.checkout.stashPop
      .use(withCheckout)
      .handler(({ context, input }) => context.checkout.stashPop(input.stashIndex)),
    getFileDiff: i.checkout.getFileDiff
      .use(withCheckout)
      .handler(({ context, input }) => context.checkout.getFileDiff(input.path, input.base)),
    subscribeFileDiff: i.checkout.subscribeFileDiff
      .use(withCheckout)
      .handler(({ context, input, signal }) =>
        streamEvents((cb) => context.checkout.subscribeFileDiff(input.path, cb), signal)
      ),
    getChangedFiles: i.checkout.getChangedFiles
      .use(withCheckout)
      .handler(({ context, input }) => context.checkout.getChangedFiles(input.base)),
    getConflictVersions: i.checkout.getConflictVersions
      .use(withCheckout)
      .handler(({ context, input }) => context.checkout.getConflictVersions(input.path)),
    getFileAtRef: i.checkout.getFileAtRef
      .use(withCheckout)
      .handler(({ context, input }) => context.checkout.getFileAtRef(input.filePath, input.ref)),
    getFileAtIndex: i.checkout.getFileAtIndex
      .use(withCheckout)
      .handler(({ context, input }) => context.checkout.getFileAtIndex(input.filePath)),
    getImageAtRef: i.checkout.getImageAtRef
      .use(withCheckout)
      .handler(({ context, input }) => context.checkout.getImageAtRef(input.filePath, input.ref)),
    getImageAtIndex: i.checkout.getImageAtIndex
      .use(withCheckout)
      .handler(({ context, input }) => context.checkout.getImageAtIndex(input.filePath)),
    getLog: i.checkout.getLog
      .use(withCheckout)
      .handler(({ context, input }) => context.checkout.getLog(input.options)),
    getCommit: i.checkout.getCommit
      .use(withCheckout)
      .handler(({ context, input }) => context.checkout.getCommit(input.hash)),
    getCommitFiles: i.checkout.getCommitFiles
      .use(withCheckout)
      .handler(({ context, input }) => context.checkout.getCommitFiles(input.hash)),
    blame: i.checkout.blame
      .use(withCheckout)
      .handler(({ context, input }) => context.checkout.blame(input.path, input.ref)),
  },
});

export type GitRouter = typeof gitRouter;
export type GitMessagePort = Parameters<RPCHandler<GitApiContext>['upgrade']>[0];

export function serveGitPort(runtime: IGitRuntime, port: GitMessagePort): GitSession {
  const session = createGitSession(runtime);
  new RPCHandler(gitRouter).upgrade(port, { context: session.context });
  onMessagePortClose(port, () => void session.dispose());
  return session;
}

function jobOrThrow<I, P, R, E>(
  server: LiveJobServer<I, P, R, E>,
  jobId: string
): LiveModelServer<LiveJobState<P, R, E>> {
  const job = server.job(jobId);
  if (!job) throw new ORPCError('NOT_FOUND', { message: `Unknown git job '${jobId}'` });
  return job;
}
