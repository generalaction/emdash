export { GitRuntime, type GitRuntimeOptions } from './git-runtime';
export { classifyCloneRepositoryError, gitErr, gitErrorMessage, toGitCommandError } from './errors';
export { computeBaseRef } from './repository/ops/base-ref';
export { gitContract, type GitContract } from './api/contract';
export { gitRepositoryContract, type GitRepositoryContract } from './repository/contract';
export { gitCheckoutContract, type GitCheckoutContract } from './checkout/contract';
export { createGitController, type GitControllerOptions } from './api/controller';
export { repositoryKeySchema, type RepositoryKey } from './repository/key';
export { checkoutKeySchema, type CheckoutKey } from './checkout/key';
export { GitSessionManager } from './session/session-manager';
export type { GitIdentity, GitOnError, GitSessionManagerOptions } from './session/identity';
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
export type { GitOpContext } from './exec/transfer-progress';
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
  CheckoutInfo,
  CloneRepositoryJobInput,
  EnsureRepositoryOptions,
  GitPathInspection,
  GitRepositoryInfo,
  GitSyncProgress,
  GitTransferProgress,
} from './api/schemas';
export type {
  BlameHunk,
  BlameResult,
  Commit,
  CommitFile,
  CommitOptions,
  ConflictVersions,
  DiffHunk,
  DiffLine,
  DiffMode,
  DiffTarget,
  FileChange,
  FileDiff,
  GitChange,
  GitChangeStatus,
  GitLogOptions,
  GitLogResult,
  GitObjectRef,
  ImageBlob,
  ImageReadResult,
  ImageUnavailableReason,
  MergeBaseRange,
  MergeOptions,
  PullJobInput,
  PushJobInput,
  PushOptions,
  RebaseOptions,
  ResetMode,
  StashPushOptions,
  SwitchOptions,
  SyncJobInput,
} from './checkout/schemas';
export type {
  AddCheckoutOptions,
  CreateBranchOptions,
  FetchJobInput,
  FetchPrForReviewJobInput,
  FetchPrForReviewOptions,
  PublishBranchJobInput,
  TagOptions,
} from './repository/schemas';
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
