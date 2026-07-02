import crypto from 'node:crypto';
import { ORPCError, implement } from '@orpc/server';
import { PROTOCOL_VERSION, negotiateProtocol, workspaceContract } from '@emdash/core/workspace-server';

const i = implement(workspaceContract);

const startedAt = Date.now();
const daemonId = crypto.randomUUID();

/** Stub used by domain handlers not yet implemented on the server. */
function notImplemented(): never {
  throw new ORPCError('NOT_IMPLEMENTED', { message: 'This procedure is not yet implemented.' });
}

export const router = i.router({
  health: i.health.handler(() => ({
    status: 'ok' as const,
    version: process.env['npm_package_version'] ?? '0.0.0',
    uptimeMs: Date.now() - startedAt,
  })),

  initialize: i.initialize.handler(({ input, errors }) => {
    const result = negotiateProtocol(input.protocolVersion, PROTOCOL_VERSION);
    if (!result.compatible) {
      throw errors.PROTOCOL_INCOMPATIBLE({
        data: {
          action: result.action,
          clientProtocolVersion: result.clientProtocolVersion,
          serverProtocolVersion: result.serverProtocolVersion,
        },
      });
    }
    return {
      protocolVersion: PROTOCOL_VERSION,
      agreedVersion: result.agreedVersion,
      agreedMinor: result.agreedMinor,
      server: {
        appVersion: process.env['npm_package_version'] ?? '0.0.0',
        daemonId,
        startedAt,
      },
    };
  }),

  // ---------------------------------------------------------------------------
  // Domain stubs — handlers are implemented in follow-up work.
  // ---------------------------------------------------------------------------

  git: {
    inspectPath: i.git.inspectPath.handler(notImplemented),
    ensureRepository: i.git.ensureRepository.handler(notImplemented),
    cloneRepository: i.git.cloneRepository.handler(notImplemented),
    openRepository: i.git.openRepository.handler(notImplemented),
    openWorktree: i.git.openWorktree.handler(notImplemented),
    repository: {
      release: i.git.repository.release.handler(notImplemented),
      getRefs: i.git.repository.getRefs.handler(notImplemented),
      getRemotes: i.git.repository.getRemotes.handler(notImplemented),
      getSnapshot: i.git.repository.getSnapshot.handler(notImplemented),
      refresh: i.git.repository.refresh.handler(notImplemented),
      subscribe: i.git.repository.subscribe.handler(notImplemented),
      getDefaultBranch: i.git.repository.getDefaultBranch.handler(notImplemented),
      fetch: i.git.repository.fetch.handler(notImplemented),
      addRemote: i.git.repository.addRemote.handler(notImplemented),
      createBranch: i.git.repository.createBranch.handler(notImplemented),
      deleteBranch: i.git.repository.deleteBranch.handler(notImplemented),
      fetchPrForReview: i.git.repository.fetchPrForReview.handler(notImplemented),
      publishBranch: i.git.repository.publishBranch.handler(notImplemented),
      readBlobAtRef: i.git.repository.readBlobAtRef.handler(notImplemented),
    },
    worktree: {
      release: i.git.worktree.release.handler(notImplemented),
      getStatus: i.git.worktree.getStatus.handler(notImplemented),
      getHead: i.git.worktree.getHead.handler(notImplemented),
      getSnapshot: i.git.worktree.getSnapshot.handler(notImplemented),
      refresh: i.git.worktree.refresh.handler(notImplemented),
      subscribe: i.git.worktree.subscribe.handler(notImplemented),
      getStatusFingerprint: i.git.worktree.getStatusFingerprint.handler(notImplemented),
      isFileCleanlyTracked: i.git.worktree.isFileCleanlyTracked.handler(notImplemented),
      getChangedFiles: i.git.worktree.getChangedFiles.handler(notImplemented),
      getFileAtRef: i.git.worktree.getFileAtRef.handler(notImplemented),
      getFileAtIndex: i.git.worktree.getFileAtIndex.handler(notImplemented),
      getImageAtRef: i.git.worktree.getImageAtRef.handler(notImplemented),
      getImageAtIndex: i.git.worktree.getImageAtIndex.handler(notImplemented),
      getLog: i.git.worktree.getLog.handler(notImplemented),
      getCommitFiles: i.git.worktree.getCommitFiles.handler(notImplemented),
      stage: i.git.worktree.stage.handler(notImplemented),
      stageAll: i.git.worktree.stageAll.handler(notImplemented),
      unstage: i.git.worktree.unstage.handler(notImplemented),
      unstageAll: i.git.worktree.unstageAll.handler(notImplemented),
      revert: i.git.worktree.revert.handler(notImplemented),
      revertAll: i.git.worktree.revertAll.handler(notImplemented),
      commit: i.git.worktree.commit.handler(notImplemented),
      push: i.git.worktree.push.handler(notImplemented),
      pull: i.git.worktree.pull.handler(notImplemented),
    },
  },

  files: {
    openTree: i.files.openTree.handler(notImplemented),
    watchChanges: i.files.watchChanges.handler(notImplemented),
    fs: {
      readText: i.files.fs.readText.handler(notImplemented),
      readBytes: i.files.fs.readBytes.handler(notImplemented),
      writeText: i.files.fs.writeText.handler(notImplemented),
      writeBytes: i.files.fs.writeBytes.handler(notImplemented),
      stat: i.files.fs.stat.handler(notImplemented),
      exists: i.files.fs.exists.handler(notImplemented),
      mkdir: i.files.fs.mkdir.handler(notImplemented),
      remove: i.files.fs.remove.handler(notImplemented),
      realPath: i.files.fs.realPath.handler(notImplemented),
      copyFile: i.files.fs.copyFile.handler(notImplemented),
      glob: i.files.fs.glob.handler(notImplemented),
      enumerate: i.files.fs.enumerate.handler(notImplemented),
    },
    tree: {
      release: i.files.tree.release.handler(notImplemented),
      ready: i.files.tree.ready.handler(notImplemented),
      getSnapshot: i.files.tree.getSnapshot.handler(notImplemented),
      refresh: i.files.tree.refresh.handler(notImplemented),
      subscribe: i.files.tree.subscribe.handler(notImplemented),
      registerDir: i.files.tree.registerDir.handler(notImplemented),
      unregisterDir: i.files.tree.unregisterDir.handler(notImplemented),
      revealPath: i.files.tree.revealPath.handler(notImplemented),
      getNode: i.files.tree.getNode.handler(notImplemented),
    },
  },

  deps: {
    probe: i.deps.probe.handler(notImplemented),
    install: i.deps.install.handler(notImplemented),
    uninstall: i.deps.uninstall.handler(notImplemented),
  },

  acp: {
    startSession: i.acp.startSession.handler(notImplemented),
    resumeSession: i.acp.resumeSession.handler(notImplemented),
    stopSession: i.acp.stopSession.handler(notImplemented),
    sendPrompt: i.acp.sendPrompt.handler(notImplemented),
    cancelTurn: i.acp.cancelTurn.handler(notImplemented),
    setModelOption: i.acp.setModelOption.handler(notImplemented),
    setModeOption: i.acp.setModeOption.handler(notImplemented),
    resolvePermission: i.acp.resolvePermission.handler(notImplemented),
    killAllTerminals: i.acp.killAllTerminals.handler(notImplemented),
    getHistory: i.acp.getHistory.handler(notImplemented),
    subscribeActiveTurn: i.acp.subscribeActiveTurn.handler(notImplemented),
    subscribeTerminalOutput: i.acp.subscribeTerminalOutput.handler(notImplemented),
    sessionConfig: {
      snapshot: i.acp.sessionConfig.snapshot.handler(notImplemented),
      subscribe: i.acp.sessionConfig.subscribe.handler(notImplemented),
      unsubscribe: i.acp.sessionConfig.unsubscribe.handler(notImplemented),
    },
    sessionStateList: {
      snapshot: i.acp.sessionStateList.snapshot.handler(notImplemented),
      subscribe: i.acp.sessionStateList.subscribe.handler(notImplemented),
      unsubscribe: i.acp.sessionStateList.unsubscribe.handler(notImplemented),
    },
  },
});
