export { GitRuntime, type GitRuntimeOptions } from './git-runtime';
export { classifyCloneRepositoryError, gitErr, gitErrorMessage, toGitCommandError } from './errors';
export { computeBaseRef } from './base-ref';
export { gitContract, type GitContract } from './api/contract';
export { gitRepositoryContract, type GitRepositoryContract } from './repository/api/contract';
export { gitCheckoutContract, type GitCheckoutContract } from './checkout/contract';
export { createGitController, type GitControllerOptions } from './api/controller';
export { repositoryKeySchema, type RepositoryKey } from './repository/api/key';
export { checkoutKeySchema, type CheckoutKey } from './checkout/key';
export { GitSessionManager } from './session/session-manager';
export type { GitIdentity, GitOnError, GitSessionManagerOptions } from './session/types';
export {
  createRepositoryLiveHost,
  createRepositoryLiveModels,
  type RepositoryInitialState,
  type RepositoryLiveHost,
  type RepositoryLiveModels,
  type RepositoryModel,
} from './repository/live-models';
export { RepositoryResource, type CheckoutWatchRegistration } from './repository/resource';
export {
  createCheckoutLiveHost,
  createCheckoutLiveModels,
  type CheckoutFileDiffModel,
  type CheckoutInitialState,
  type CheckoutLiveHost,
  type CheckoutLiveModels,
  type CheckoutModel,
} from './checkout/live-models';
export { CheckoutResource } from './checkout/resource';
export {
  fileDiffStalenessSchema,
  fileDiffStalenessReasonSchema,
  type FileDiffStaleness,
  type FileDiffStalenessReason,
} from './checkout/models/file-diff';
export type { GitOpContext } from './transfer-progress';
export type {
  CloneRepositoryJobInput,
  FetchJobInput,
  FetchPrForReviewJobInput,
  GitSyncProgress,
  GitTransferProgress,
  PublishBranchJobInput,
  PullJobInput,
  PushJobInput,
  SyncJobInput,
} from './api/jobs';
export { MAX_STATUS_FILES, StatusParser, TooManyFilesChangedError } from './checkout/ops/status';
export type { FileStatus } from './checkout/ops/status';
export type { IGitRepository } from './repository/types';
export type { IGitCheckout } from './checkout/types';
export type {
  CloneRepositoryError,
  CommitError,
  CreateBranchError,
  DeleteBranchError,
  EnsureRepositoryError,
  FetchError,
  FetchPrForReviewError,
  GitCommandError,
  MergeError,
  PullError,
  PushError,
  RebaseError,
  SwitchError,
  SyncError,
} from './api/errors';
export type {
  BlameHunk,
  BlameResult,
  CheckoutInfo,
  Commit,
  CommitFile,
  ConflictVersions,
  DiffHunk,
  DiffLine,
  DiffMode,
  DiffTarget,
  FileChange,
  FileDiff,
  GitChange,
  GitChangeStatus,
  GitLogResult,
  GitObjectRef,
  GitPathInspection,
  GitRepositoryInfo,
  ImageBlob,
  ImageReadResult,
  ImageUnavailableReason,
  MergeBaseRange,
} from './api/queries';
export type {
  AddCheckoutOptions,
  CommitOptions,
  CreateBranchOptions,
  EnsureRepositoryOptions,
  FetchPrForReviewOptions,
  GitLogOptions,
  MergeOptions,
  PushOptions,
  RebaseOptions,
  ResetMode,
  StashPushOptions,
  SwitchOptions,
  TagOptions,
} from './api/commands';
export type {
  GitBranch,
  GitBranchRef,
  GitLocalBranchRef,
  GitRefsModel,
  GitRemote,
  GitRemoteBranchRef,
  GitTag,
  LocalBranch,
  RemoteBranch,
} from './repository/models/refs';
export type { GitRemotesModel } from './repository/models/remotes';
export type { GitStash, GitStashesModel } from './repository/models/stashes';
export type { GitCheckoutsModel } from './repository/models/checkouts';
export type { GitHeadModel } from './checkout/models/head';
export type {
  CheckoutOperation,
  CheckoutStatusModel,
  CheckoutStatusSummary,
  FileGitStatus,
  GitStatusCode,
} from './checkout/models/status';
