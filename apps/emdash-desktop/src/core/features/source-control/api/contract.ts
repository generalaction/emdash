import { gitContract } from '@emdash/core/runtimes/git/api';
import { defineContract, liveJob, liveModel, liveState } from '@emdash/wire';
import { z } from 'zod';
import {
  runtimeFallibleMutations,
  runtimeFallibleProcedure,
  runtimeResolveErrorUnion,
} from '@core/primitives/desktop-runtime/api/fallible-contract';

const projectKeySchema = z.object({ projectId: z.string() });
const workspaceKeySchema = z.object({ workspaceId: z.string() });

const repository = gitContract.repository;
const checkout = gitContract.checkout;

const sourceControlRepositoryContract = defineContract({
  model: liveModel({
    key: projectKeySchema,
    states: {
      refs: liveState({ data: repository.model.states.refs.dataSchema }),
      remotes: liveState({ data: repository.model.states.remotes.dataSchema }),
      stashes: liveState({ data: repository.model.states.stashes.dataSchema }),
      worktrees: liveState({ data: repository.model.states.worktrees.dataSchema }),
    },
    mutations: runtimeFallibleMutations(repository.model.mutations),
  }),
  listWorktrees: runtimeFallibleProcedure(projectKeySchema, repository.listWorktrees.output),
  getDefaultBranch: runtimeFallibleProcedure(
    repository.getDefaultBranch.input.omit({ repository: true }).extend(projectKeySchema.shape),
    repository.getDefaultBranch.output
  ),
  getBranchBase: runtimeFallibleProcedure(
    repository.getBranchBase.input.omit({ repository: true }).extend(projectKeySchema.shape),
    repository.getBranchBase.output
  ),
  readBlobAtRef: runtimeFallibleProcedure(
    repository.readBlobAtRef.input.omit({ repository: true }).extend(projectKeySchema.shape),
    repository.readBlobAtRef.output
  ),
  fetch: liveJob({
    input: repository.fetch.input.omit({ repository: true }).extend(projectKeySchema.shape),
    progress: repository.fetch.progress,
    result: repository.fetch.result,
    error: runtimeResolveErrorUnion(repository.fetch.error),
  }),
  publishBranch: liveJob({
    input: repository.publishBranch.input.omit({ repository: true }).extend(projectKeySchema.shape),
    progress: repository.publishBranch.progress,
    result: repository.publishBranch.result,
    error: runtimeResolveErrorUnion(repository.publishBranch.error),
  }),
  fetchPrForReview: liveJob({
    input: repository.fetchPrForReview.input
      .omit({ repository: true })
      .extend(projectKeySchema.shape),
    progress: repository.fetchPrForReview.progress,
    result: repository.fetchPrForReview.result,
    error: runtimeResolveErrorUnion(repository.fetchPrForReview.error),
  }),
});

const sourceControlCheckoutContract = defineContract({
  model: liveModel({
    key: workspaceKeySchema,
    states: {
      status: liveState({ data: checkout.model.states.status.dataSchema }),
      head: liveState({ data: checkout.model.states.head.dataSchema }),
    },
    mutations: runtimeFallibleMutations(checkout.model.mutations),
  }),
  fileDiff: liveModel({
    key: checkout.fileDiff.keySchema.omit({ checkout: true }).extend(workspaceKeySchema.shape),
    states: {
      staleness: liveState({ data: checkout.fileDiff.states.staleness.dataSchema }),
    },
  }),
  content: liveModel({
    key: checkout.content.keySchema.omit({ checkout: true }).extend(workspaceKeySchema.shape),
    states: {
      content: liveState({ data: checkout.content.states.content.dataSchema }),
    },
  }),
  getFileDiff: runtimeFallibleProcedure(
    checkout.getFileDiff.input.omit({ checkout: true }).extend(workspaceKeySchema.shape),
    checkout.getFileDiff.output
  ),
  getChangedFiles: runtimeFallibleProcedure(
    checkout.getChangedFiles.input.omit({ checkout: true }).extend(workspaceKeySchema.shape),
    checkout.getChangedFiles.output
  ),
  isFileTracked: runtimeFallibleProcedure(
    checkout.isFileTracked.input.omit({ checkout: true }).extend(workspaceKeySchema.shape),
    checkout.isFileTracked.output
  ),
  getConflictVersions: runtimeFallibleProcedure(
    checkout.getConflictVersions.input.omit({ checkout: true }).extend(workspaceKeySchema.shape),
    checkout.getConflictVersions.output
  ),
  getFileAtRef: runtimeFallibleProcedure(
    checkout.getFileAtRef.input.omit({ checkout: true }).extend(workspaceKeySchema.shape),
    checkout.getFileAtRef.output
  ),
  getFileAtIndex: runtimeFallibleProcedure(
    checkout.getFileAtIndex.input.omit({ checkout: true }).extend(workspaceKeySchema.shape),
    checkout.getFileAtIndex.output
  ),
  getImageAtRef: runtimeFallibleProcedure(
    checkout.getImageAtRef.input.omit({ checkout: true }).extend(workspaceKeySchema.shape),
    checkout.getImageAtRef.output
  ),
  getImageAtIndex: runtimeFallibleProcedure(
    checkout.getImageAtIndex.input.omit({ checkout: true }).extend(workspaceKeySchema.shape),
    checkout.getImageAtIndex.output
  ),
  getLog: runtimeFallibleProcedure(
    checkout.getLog.input.omit({ checkout: true }).extend(workspaceKeySchema.shape),
    checkout.getLog.output
  ),
  getCommit: runtimeFallibleProcedure(
    checkout.getCommit.input.omit({ checkout: true }).extend(workspaceKeySchema.shape),
    checkout.getCommit.output
  ),
  getCommitFiles: runtimeFallibleProcedure(
    checkout.getCommitFiles.input.omit({ checkout: true }).extend(workspaceKeySchema.shape),
    checkout.getCommitFiles.output
  ),
  blame: runtimeFallibleProcedure(
    checkout.blame.input.omit({ checkout: true }).extend(workspaceKeySchema.shape),
    checkout.blame.output
  ),
  push: liveJob({
    input: checkout.push.input.omit({ checkout: true }).extend(workspaceKeySchema.shape),
    progress: checkout.push.progress,
    result: checkout.push.result,
    error: runtimeResolveErrorUnion(checkout.push.error),
  }),
  pull: liveJob({
    input: checkout.pull.input.omit({ checkout: true }).extend(workspaceKeySchema.shape),
    progress: checkout.pull.progress,
    result: checkout.pull.result,
    error: runtimeResolveErrorUnion(checkout.pull.error),
  }),
  sync: liveJob({
    input: checkout.sync.input.omit({ checkout: true }).extend(workspaceKeySchema.shape),
    progress: checkout.sync.progress,
    result: checkout.sync.result,
    error: runtimeResolveErrorUnion(checkout.sync.error),
  }),
});

export const sourceControlContract = defineContract({
  repository: sourceControlRepositoryContract,
  checkout: sourceControlCheckoutContract,
});

export type SourceControlContract = typeof sourceControlContract;
