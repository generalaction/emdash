import { gitContract } from '@emdash/core/runtimes/git/api';
import { defineContract, downloadFile, liveJob, liveModel, liveState } from '@emdash/wire/rpc';
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
    },
    mutations: runtimeFallibleMutations(repository.model.mutations),
  }),
  listWorktrees: runtimeFallibleProcedure(projectKeySchema, repository.listWorktrees.output),
  getDefaultBranch: runtimeFallibleProcedure(
    repository.getDefaultBranch.input.omit({ repository: true }).extend(projectKeySchema.shape),
    repository.getDefaultBranch.output
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
  getChangedFiles: runtimeFallibleProcedure(
    checkout.getChangedFiles.input.omit({ checkout: true }).extend(workspaceKeySchema.shape),
    checkout.getChangedFiles.output
  ),
  getFile: runtimeFallibleProcedure(
    checkout.getFile.input.omit({ checkout: true }).extend(workspaceKeySchema.shape),
    checkout.getFile.output
  ),
  download: downloadFile({
    input: checkout.download.input.omit({ checkout: true }).extend(workspaceKeySchema.shape),
    meta: checkout.download.meta,
    error: runtimeResolveErrorUnion(checkout.download.error),
  }),
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
});

export const sourceControlDomain = 'sourceControl' as const;

export const sourceControlContract = defineContract({
  repository: sourceControlRepositoryContract,
  checkout: sourceControlCheckoutContract,
});

export type SourceControlContract = typeof sourceControlContract;
