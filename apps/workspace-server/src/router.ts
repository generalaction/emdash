import crypto from 'node:crypto';
import {
  PROTOCOL_VERSION,
  negotiateProtocol,
  workspaceContract,
} from '@emdash/core/workspace-server';
import { ORPCError, implement } from '@orpc/server';

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

  git: {
    inspectPath: i.git.inspectPath.handler(notImplemented),
    ensureRepository: i.git.ensureRepository.handler(notImplemented),
    cloneRepository: i.git.cloneRepository.handler(notImplemented),
    repository: {
      refs: {
        snapshot: i.git.repository.refs.snapshot.handler(notImplemented),
        subscribe: i.git.repository.refs.subscribe.handler(notImplemented),
        unsubscribe: i.git.repository.refs.unsubscribe.handler(notImplemented),
      },
      remotes: {
        snapshot: i.git.repository.remotes.snapshot.handler(notImplemented),
        subscribe: i.git.repository.remotes.subscribe.handler(notImplemented),
        unsubscribe: i.git.repository.remotes.unsubscribe.handler(notImplemented),
      },
      stashes: {
        snapshot: i.git.repository.stashes.snapshot.handler(notImplemented),
        subscribe: i.git.repository.stashes.subscribe.handler(notImplemented),
        unsubscribe: i.git.repository.stashes.unsubscribe.handler(notImplemented),
      },
      listCheckouts: i.git.repository.listCheckouts.handler(notImplemented),
      addCheckout: i.git.repository.addCheckout.handler(notImplemented),
      removeCheckout: i.git.repository.removeCheckout.handler(notImplemented),
      pruneCheckouts: i.git.repository.pruneCheckouts.handler(notImplemented),
      createBranch: i.git.repository.createBranch.handler(notImplemented),
      deleteBranch: i.git.repository.deleteBranch.handler(notImplemented),
      renameBranch: i.git.repository.renameBranch.handler(notImplemented),
      setUpstream: i.git.repository.setUpstream.handler(notImplemented),
      createTag: i.git.repository.createTag.handler(notImplemented),
      deleteTag: i.git.repository.deleteTag.handler(notImplemented),
      addRemote: i.git.repository.addRemote.handler(notImplemented),
      removeRemote: i.git.repository.removeRemote.handler(notImplemented),
      fetch: i.git.repository.fetch.handler(notImplemented),
      publishBranch: i.git.repository.publishBranch.handler(notImplemented),
      getDefaultBranch: i.git.repository.getDefaultBranch.handler(notImplemented),
      fetchPrForReview: i.git.repository.fetchPrForReview.handler(notImplemented),
      readBlobAtRef: i.git.repository.readBlobAtRef.handler(notImplemented),
      stashDrop: i.git.repository.stashDrop.handler(notImplemented),
    },
    checkout: {
      status: {
        snapshot: i.git.checkout.status.snapshot.handler(notImplemented),
        subscribe: i.git.checkout.status.subscribe.handler(notImplemented),
        unsubscribe: i.git.checkout.status.unsubscribe.handler(notImplemented),
      },
      head: {
        snapshot: i.git.checkout.head.snapshot.handler(notImplemented),
        subscribe: i.git.checkout.head.subscribe.handler(notImplemented),
        unsubscribe: i.git.checkout.head.unsubscribe.handler(notImplemented),
      },
      stage: i.git.checkout.stage.handler(notImplemented),
      unstage: i.git.checkout.unstage.handler(notImplemented),
      stageAll: i.git.checkout.stageAll.handler(notImplemented),
      unstageAll: i.git.checkout.unstageAll.handler(notImplemented),
      revert: i.git.checkout.revert.handler(notImplemented),
      revertAll: i.git.checkout.revertAll.handler(notImplemented),
      clean: i.git.checkout.clean.handler(notImplemented),
      stageHunk: i.git.checkout.stageHunk.handler(notImplemented),
      unstageHunk: i.git.checkout.unstageHunk.handler(notImplemented),
      discardHunk: i.git.checkout.discardHunk.handler(notImplemented),
      commit: i.git.checkout.commit.handler(notImplemented),
      switch: i.git.checkout.switch.handler(notImplemented),
      reset: i.git.checkout.reset.handler(notImplemented),
      merge: i.git.checkout.merge.handler(notImplemented),
      mergeContinue: i.git.checkout.mergeContinue.handler(notImplemented),
      mergeAbort: i.git.checkout.mergeAbort.handler(notImplemented),
      rebase: i.git.checkout.rebase.handler(notImplemented),
      rebaseContinue: i.git.checkout.rebaseContinue.handler(notImplemented),
      rebaseAbort: i.git.checkout.rebaseAbort.handler(notImplemented),
      rebaseSkip: i.git.checkout.rebaseSkip.handler(notImplemented),
      cherryPick: i.git.checkout.cherryPick.handler(notImplemented),
      revertCommit: i.git.checkout.revertCommit.handler(notImplemented),
      push: i.git.checkout.push.handler(notImplemented),
      pull: i.git.checkout.pull.handler(notImplemented),
      sync: i.git.checkout.sync.handler(notImplemented),
      stashPush: i.git.checkout.stashPush.handler(notImplemented),
      stashApply: i.git.checkout.stashApply.handler(notImplemented),
      stashPop: i.git.checkout.stashPop.handler(notImplemented),
      getFileDiff: i.git.checkout.getFileDiff.handler(notImplemented),
      subscribeFileDiff: i.git.checkout.subscribeFileDiff.handler(notImplemented),
      getChangedFiles: i.git.checkout.getChangedFiles.handler(notImplemented),
      getConflictVersions: i.git.checkout.getConflictVersions.handler(notImplemented),
      getFileAtRef: i.git.checkout.getFileAtRef.handler(notImplemented),
      getFileAtIndex: i.git.checkout.getFileAtIndex.handler(notImplemented),
      getImageAtRef: i.git.checkout.getImageAtRef.handler(notImplemented),
      getImageAtIndex: i.git.checkout.getImageAtIndex.handler(notImplemented),
      getLog: i.git.checkout.getLog.handler(notImplemented),
      getCommit: i.git.checkout.getCommit.handler(notImplemented),
      getCommitFiles: i.git.checkout.getCommitFiles.handler(notImplemented),
      blame: i.git.checkout.blame.handler(notImplemented),
    },
  },

  files: {
    fs: {
      stat: i.files.fs.stat.handler(notImplemented),
      exists: i.files.fs.exists.handler(notImplemented),
      realPath: i.files.fs.realPath.handler(notImplemented),
      readText: i.files.fs.readText.handler(notImplemented),
      readBytes: i.files.fs.readBytes.handler(notImplemented),
      glob: i.files.fs.glob.handler(notImplemented),
      enumerate: i.files.fs.enumerate.handler(notImplemented),
    },
    tree: {
      snapshot: i.files.tree.snapshot.handler(notImplemented),
      subscribe: i.files.tree.subscribe.handler(notImplemented),
      unsubscribe: i.files.tree.unsubscribe.handler(notImplemented),
      expand: i.files.tree.expand.handler(notImplemented),
      collapse: i.files.tree.collapse.handler(notImplemented),
      reveal: i.files.tree.reveal.handler(notImplemented),
    },
    content: {
      snapshot: i.files.content.snapshot.handler(notImplemented),
      subscribe: i.files.content.subscribe.handler(notImplemented),
      unsubscribe: i.files.content.unsubscribe.handler(notImplemented),
    },
    mutations: {
      createFile: i.files.mutations.createFile.handler(notImplemented),
      createDirectory: i.files.mutations.createDirectory.handler(notImplemented),
      rename: i.files.mutations.rename.handler(notImplemented),
      move: i.files.mutations.move.handler(notImplemented),
      copy: i.files.mutations.copy.handler(notImplemented),
      delete: i.files.mutations.delete.handler(notImplemented),
      writeFile: i.files.mutations.writeFile.handler(notImplemented),
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
    queuePrompt: i.acp.queuePrompt.handler(notImplemented),
    editQueuedPrompt: i.acp.editQueuedPrompt.handler(notImplemented),
    deleteQueuedPrompt: i.acp.deleteQueuedPrompt.handler(notImplemented),
    changeQueuePromptOrder: i.acp.changeQueuePromptOrder.handler(notImplemented),
    cancelTurn: i.acp.cancelTurn.handler(notImplemented),
    setModelOption: i.acp.setModelOption.handler(notImplemented),
    setModeOption: i.acp.setModeOption.handler(notImplemented),
    resolvePermission: i.acp.resolvePermission.handler(notImplemented),
    editCurrentPrompt: i.acp.editCurrentPrompt.handler(notImplemented),
    exportACPTranscript: i.acp.exportACPTranscript.handler(notImplemented),
    exportRawAcpLog: i.acp.exportRawAcpLog.handler(notImplemented),
    uploadAttachment: i.acp.uploadAttachment.handler(notImplemented),
    downloadAttachment: i.acp.downloadAttachment.handler(notImplemented),
    deleteAttachment: i.acp.deleteAttachment.handler(notImplemented),
    getHistory: i.acp.getHistory.handler(notImplemented),
    live: {
      sessionStateList: {
        snapshot: i.acp.live.sessionStateList.snapshot.handler(notImplemented),
        subscribe: i.acp.live.sessionStateList.subscribe.handler(notImplemented),
        unsubscribe: i.acp.live.sessionStateList.unsubscribe.handler(notImplemented),
      },
      sessionState: {
        snapshot: i.acp.live.sessionState.snapshot.handler(notImplemented),
        subscribe: i.acp.live.sessionState.subscribe.handler(notImplemented),
        unsubscribe: i.acp.live.sessionState.unsubscribe.handler(notImplemented),
      },
      sessionConfig: {
        snapshot: i.acp.live.sessionConfig.snapshot.handler(notImplemented),
        subscribe: i.acp.live.sessionConfig.subscribe.handler(notImplemented),
        unsubscribe: i.acp.live.sessionConfig.unsubscribe.handler(notImplemented),
      },
      plan: {
        snapshot: i.acp.live.plan.snapshot.handler(notImplemented),
        subscribe: i.acp.live.plan.subscribe.handler(notImplemented),
        unsubscribe: i.acp.live.plan.unsubscribe.handler(notImplemented),
      },
      agents: {
        snapshot: i.acp.live.agents.snapshot.handler(notImplemented),
        subscribe: i.acp.live.agents.subscribe.handler(notImplemented),
        unsubscribe: i.acp.live.agents.unsubscribe.handler(notImplemented),
      },
      activeTurn: {
        snapshot: i.acp.live.activeTurn.snapshot.handler(notImplemented),
        subscribe: i.acp.live.activeTurn.subscribe.handler(notImplemented),
        unsubscribe: i.acp.live.activeTurn.unsubscribe.handler(notImplemented),
      },
      terminals: {
        snapshot: i.acp.live.terminals.snapshot.handler(notImplemented),
        subscribe: i.acp.live.terminals.subscribe.handler(notImplemented),
        unsubscribe: i.acp.live.terminals.unsubscribe.handler(notImplemented),
      },
      terminalOutput: {
        snapshot: i.acp.live.terminalOutput.snapshot.handler(notImplemented),
        subscribe: i.acp.live.terminalOutput.subscribe.handler(notImplemented),
        unsubscribe: i.acp.live.terminalOutput.unsubscribe.handler(notImplemented),
      },
    },
  },

  ptyAgent: {
    startSession: i.ptyAgent.startSession.handler(notImplemented),
    stopSession: i.ptyAgent.stopSession.handler(notImplemented),
    sendInput: i.ptyAgent.sendInput.handler(notImplemented),
    resize: i.ptyAgent.resize.handler(notImplemented),
    subscribeOutput: i.ptyAgent.subscribeOutput.handler(notImplemented),
    sessions: {
      snapshot: i.ptyAgent.sessions.snapshot.handler(notImplemented),
      subscribe: i.ptyAgent.sessions.subscribe.handler(notImplemented),
      unsubscribe: i.ptyAgent.sessions.unsubscribe.handler(notImplemented),
    },
  },
});
