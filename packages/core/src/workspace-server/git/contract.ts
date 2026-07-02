import { eventIterator, oc } from '@orpc/contract';
import { z } from 'zod';
import { result } from '../shared/schemas';
import {
  cloneRepositoryErrorSchema,
  commitErrorSchema,
  commitFileSchema,
  createBranchOptionsSchema,
  deleteBranchErrorSchema,
  diffTargetSchema,
  ensureRepositoryErrorSchema,
  ensureRepositoryOptionsSchema,
  fetchErrorSchema,
  fetchPrForReviewErrorSchema,
  fetchPrForReviewOptionsSchema,
  gitChangeSchema,
  gitCommandErrorSchema,
  gitHeadModelSchema,
  gitLogOptionsSchema,
  gitLogResultSchema,
  gitPathInspectionSchema,
  gitRefsModelSchema,
  gitRemotesModelSchema,
  gitRepoSnapshotSchema,
  gitRepoUpdateSchema,
  gitRepositoryInfoSchema,
  gitSequencesSchema,
  gitStatusFingerprintSchema,
  gitStatusUntrackedModeSchema,
  gitWorktreeSnapshotSchema,
  gitWorktreeUpdateSchema,
  imageReadResultSchema,
  pullErrorSchema,
  pushErrorSchema,
} from './schemas';

// ---------------------------------------------------------------------------
// Shared commit result used by `repository.publishBranch` and `worktree.push`
// ---------------------------------------------------------------------------

const outputSequencesResult = result(
  z.object({ output: z.string(), sequences: gitSequencesSchema }),
  pushErrorSchema
);

const sequencesResult = result(z.object({ sequences: gitSequencesSchema }), gitCommandErrorSchema);

const fetchResult = result(z.object({ sequences: gitSequencesSchema }), fetchErrorSchema);

// ---------------------------------------------------------------------------
// repository.* procedures (take repositoryId)
// ---------------------------------------------------------------------------

const repositoryId = z.object({ repositoryId: z.string() });

const repositoryContract = {
  release: oc.input(repositoryId).output(z.void()),

  getRefs: oc.input(repositoryId).output(gitRefsModelSchema),

  getRemotes: oc.input(repositoryId).output(gitRemotesModelSchema),

  getSnapshot: oc.input(repositoryId).output(gitRepoSnapshotSchema),

  refresh: oc.input(repositoryId).output(gitRepoSnapshotSchema),

  subscribe: oc.input(repositoryId).output(eventIterator(gitRepoUpdateSchema)),

  getDefaultBranch: oc
    .input(repositoryId.extend({ remote: z.string().optional() }))
    .output(z.string()),

  fetch: oc.input(repositoryId.extend({ remote: z.string().optional() })).output(fetchResult),

  addRemote: oc
    .input(repositoryId.extend({ name: z.string(), url: z.string() }))
    .output(sequencesResult),

  createBranch: oc
    .input(repositoryId.extend({ options: createBranchOptionsSchema }))
    .output(result(z.object({ sequences: gitSequencesSchema }), gitCommandErrorSchema)),

  deleteBranch: oc
    .input(repositoryId.extend({ branch: z.string(), force: z.boolean().optional() }))
    .output(result(z.object({ sequences: gitSequencesSchema }), deleteBranchErrorSchema)),

  fetchPrForReview: oc
    .input(repositoryId.extend({ options: fetchPrForReviewOptionsSchema }))
    .output(result(z.object({ sequences: gitSequencesSchema }), fetchPrForReviewErrorSchema)),

  publishBranch: oc
    .input(
      repositoryId.extend({
        branchName: z.string(),
        remote: z.string().optional(),
      })
    )
    .output(outputSequencesResult),

  readBlobAtRef: oc
    .input(repositoryId.extend({ ref: z.string(), filePath: z.string() }))
    .output(z.string().nullable()),
};

// ---------------------------------------------------------------------------
// worktree.* procedures (take worktreeId)
// ---------------------------------------------------------------------------

const worktreeId = z.object({ worktreeId: z.string() });

const worktreeContract = {
  release: oc.input(worktreeId).output(z.void()),

  getStatus: oc.input(worktreeId).output(z.object({ status: z.any() })),

  getHead: oc.input(worktreeId).output(gitHeadModelSchema),

  getSnapshot: oc.input(worktreeId).output(gitWorktreeSnapshotSchema),

  refresh: oc.input(worktreeId).output(gitWorktreeSnapshotSchema),

  subscribe: oc.input(worktreeId).output(eventIterator(gitWorktreeUpdateSchema)),

  getStatusFingerprint: oc
    .input(worktreeId.extend({ untracked: gitStatusUntrackedModeSchema }))
    .output(gitStatusFingerprintSchema),

  isFileCleanlyTracked: oc.input(worktreeId.extend({ filePath: z.string() })).output(z.boolean()),

  getChangedFiles: oc
    .input(worktreeId.extend({ base: diffTargetSchema }))
    .output(z.array(gitChangeSchema)),

  getFileAtRef: oc
    .input(worktreeId.extend({ filePath: z.string(), ref: z.string() }))
    .output(z.string().nullable()),

  getFileAtIndex: oc
    .input(worktreeId.extend({ filePath: z.string() }))
    .output(z.string().nullable()),

  getImageAtRef: oc
    .input(worktreeId.extend({ filePath: z.string(), ref: z.string() }))
    .output(imageReadResultSchema),

  getImageAtIndex: oc
    .input(worktreeId.extend({ filePath: z.string() }))
    .output(imageReadResultSchema),

  getLog: oc
    .input(worktreeId.extend({ options: gitLogOptionsSchema.optional() }))
    .output(gitLogResultSchema),

  getCommitFiles: oc
    .input(worktreeId.extend({ hash: z.string() }))
    .output(z.array(commitFileSchema)),

  stage: oc
    .input(worktreeId.extend({ paths: z.array(z.string()) }))
    .output(result(gitSequencesSchema, gitCommandErrorSchema)),

  stageAll: oc.input(worktreeId).output(result(gitSequencesSchema, gitCommandErrorSchema)),

  unstage: oc
    .input(worktreeId.extend({ paths: z.array(z.string()) }))
    .output(result(gitSequencesSchema, gitCommandErrorSchema)),

  unstageAll: oc.input(worktreeId).output(result(gitSequencesSchema, gitCommandErrorSchema)),

  revert: oc
    .input(worktreeId.extend({ paths: z.array(z.string()) }))
    .output(result(gitSequencesSchema, gitCommandErrorSchema)),

  revertAll: oc.input(worktreeId).output(result(gitSequencesSchema, gitCommandErrorSchema)),

  commit: oc
    .input(worktreeId.extend({ message: z.string() }))
    .output(
      result(z.object({ hash: z.string(), sequences: gitSequencesSchema }), commitErrorSchema)
    ),

  push: oc
    .input(worktreeId.extend({ remote: z.string().optional() }))
    .output(outputSequencesResult),

  pull: oc
    .input(worktreeId)
    .output(
      result(z.object({ output: z.string(), sequences: gitSequencesSchema }), pullErrorSchema)
    ),
};

// ---------------------------------------------------------------------------
// runtime-level procedures (no handle required)
// ---------------------------------------------------------------------------

const runtimeContract = {
  inspectPath: oc.input(z.object({ path: z.string() })).output(gitPathInspectionSchema),

  ensureRepository: oc
    .input(z.object({ path: z.string(), options: ensureRepositoryOptionsSchema.optional() }))
    .output(result(gitRepositoryInfoSchema, ensureRepositoryErrorSchema)),

  cloneRepository: oc
    .input(z.object({ repositoryUrl: z.string(), targetPath: z.string() }))
    .output(result(gitRepositoryInfoSchema, cloneRepositoryErrorSchema)),

  openRepository: oc.input(z.object({ pathInsideRepo: z.string() })).output(
    z.object({
      repositoryId: z.string(),
      gitCommonDir: z.string(),
      objectStoreDir: z.string(),
    })
  ),

  openWorktree: oc.input(z.object({ worktreePath: z.string() })).output(
    z.object({
      worktreeId: z.string(),
      repositoryId: z.string(),
      worktree: z.string(),
    })
  ),
};

// ---------------------------------------------------------------------------
// Top-level git contract (nested routers)
// ---------------------------------------------------------------------------

export const gitContract = {
  ...runtimeContract,
  repository: repositoryContract,
  worktree: worktreeContract,
};

export type GitContract = typeof gitContract;
