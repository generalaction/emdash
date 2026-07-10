import {
  gitContract,
  toGitCommandError,
  type CheckoutKey,
  type FetchError,
  type FetchPrForReviewError,
  type GitCommandError,
  type GitContract,
  type PullError,
  type PushError,
  type RepositoryKey,
  type SyncError,
} from '@emdash/core/git';
import { type Result } from '@emdash/shared';
import {
  createController,
  type ContractImpl,
  type Controller,
  type LiveModelDef,
  type LiveModelHost,
  type LiveModelProvider,
  type ValidatePolicy,
  withValidation,
} from '@emdash/wire';
import type { CheckoutResource } from '../checkout/resource';
import type { GitRuntime } from '../git-runtime';
import type { RepositoryResource } from '../repository/resource';
import type { GitSessionManager } from '../session/session-manager';

export type GitControllerOptions = {
  validate?: ValidatePolicy;
};

export function createGitController(
  runtime: GitRuntime,
  options: GitControllerOptions = {}
): Controller {
  return withValidation(
    gitContract,
    createController(gitContract, createGitContractImpl(runtime)),
    options.validate ?? 'inputs'
  );
}

export function createGitContractImpl(
  runtime: GitRuntime,
  contract: GitContract = gitContract
): ContractImpl<GitContract> {
  const sessions = runtime.sessions;

  return {
    inspectPath: (input) => runtime.inspectPath(input.path),
    ensureRepository: (input) => runtime.ensureRepository(input.path, input.options),
    cloneRepository: {
      run: (input, ctx) =>
        runtime.cloneRepository(input.repositoryUrl, input.targetPath, {
          signal: ctx.signal,
          onProgress: ctx.progress,
        }),
      toError: toJobError,
    },

    repository: {
      model: liveModelHostProvider(contract.repository.model, sessions.repositoryHost),

      open: (input) => sessions.startRepositorySession(input.path),
      close: (input) => sessions.stopRepositorySession(input),

      listCheckouts: (input) =>
        sessions.readRepository(input, (resource) => resource.repository.listCheckouts()),
      getDefaultBranch: (input) =>
        sessions.readRepository(input, (resource) =>
          resource.repository.getDefaultBranch(input.remote)
        ),
      readBlobAtRef: (input) =>
        sessions.readRepository(input, (resource) =>
          resource.repository.readBlobAtRef(input.ref, input.filePath)
        ),

      fetch: {
        run: (input, ctx) =>
          withRepositoryJob<void, FetchError>(
            sessions,
            { repositoryRoot: input.repositoryRoot },
            async (resource) => {
              const result = await resource.repository.fetch(input.remote, {
                signal: ctx.signal,
                onProgress: ctx.progress,
              });
              if (result.success) await resource.refreshRefs();
              return result;
            }
          ),
        toError: toJobError,
      },
      publishBranch: {
        run: (input, ctx) =>
          withRepositoryJob<{ output: string }, PushError>(
            sessions,
            { repositoryRoot: input.repositoryRoot },
            async (resource) => {
              const result = await resource.repository.publishBranch(
                input.branchName,
                input.remote,
                {
                  signal: ctx.signal,
                  onProgress: ctx.progress,
                }
              );
              if (result.success) await resource.refreshRefs();
              return result;
            }
          ),
        toError: toJobError,
      },
      fetchPrForReview: {
        run: (input, ctx) =>
          withRepositoryJob<void, FetchPrForReviewError>(
            sessions,
            { repositoryRoot: input.repositoryRoot },
            async (resource) => {
              const result = await resource.repository.fetchPrForReview(input.options, {
                signal: ctx.signal,
                onProgress: ctx.progress,
              });
              if (result.success) {
                await Promise.all([resource.refreshRefs(), resource.refreshRemotes()]);
              }
              return result;
            }
          ),
        toError: toJobError,
      },
    },

    checkout: {
      model: liveModelHostProvider(contract.checkout.model, sessions.checkoutHost),
      fileDiff: fileDiffModelProvider(contract.checkout.fileDiff, sessions),

      open: (input) => sessions.startCheckoutSession(input.path),
      close: (input) => sessions.stopCheckoutSession(input),

      getFileDiff: (input) =>
        withCheckoutRead(input, sessions, (resource) =>
          resource.checkout.getFileDiff(input.path, input.base)
        ),
      getChangedFiles: (input) =>
        sessions.readCheckout(input, (resource) => resource.checkout.getChangedFiles(input.base)),
      getConflictVersions: (input) =>
        withCheckoutRead(input, sessions, (resource) =>
          resource.checkout.getConflictVersions(input.path)
        ),
      getFileAtRef: (input) =>
        sessions.readCheckout(input, (resource) =>
          resource.checkout.getFileAtRef(input.filePath, input.ref)
        ),
      getFileAtIndex: (input) =>
        sessions.readCheckout(input, (resource) =>
          resource.checkout.getFileAtIndex(input.filePath)
        ),
      getImageAtRef: (input) =>
        sessions.readCheckout(input, (resource) =>
          resource.checkout.getImageAtRef(input.filePath, input.ref)
        ),
      getImageAtIndex: (input) =>
        sessions.readCheckout(input, (resource) =>
          resource.checkout.getImageAtIndex(input.filePath)
        ),
      getLog: (input) =>
        sessions.readCheckout(input, (resource) => resource.checkout.getLog(input.options)),
      getCommit: (input) =>
        sessions.readCheckout(input, (resource) => resource.checkout.getCommit(input.hash)),
      getCommitFiles: (input) =>
        sessions.readCheckout(input, (resource) => resource.checkout.getCommitFiles(input.hash)),
      blame: (input) =>
        withCheckoutRead(input, sessions, (resource) =>
          resource.checkout.blame(input.path, input.ref)
        ),

      push: {
        run: (input, ctx) =>
          withCheckoutJob<{ output: string }, PushError>(
            sessions,
            { checkoutPath: input.checkoutPath },
            async (resource) => {
              const result = await resource.checkout.push(input.options, {
                signal: ctx.signal,
                onProgress: ctx.progress,
              });
              if (result.success) await refreshCheckoutHistory(resource);
              return result;
            }
          ),
        toError: toJobError,
      },
      pull: {
        run: (input, ctx) =>
          withCheckoutJob<{ output: string }, PullError>(
            sessions,
            { checkoutPath: input.checkoutPath },
            async (resource) => {
              const result = await resource.checkout.pull({
                signal: ctx.signal,
                onProgress: ctx.progress,
              });
              if (result.success) await refreshCheckoutHistory(resource);
              return result;
            }
          ),
        toError: toJobError,
      },
      sync: {
        run: (input, ctx) =>
          withCheckoutJob<{ output: string }, SyncError>(
            sessions,
            { checkoutPath: input.checkoutPath },
            async (resource) => {
              const result = await resource.checkout.sync({
                signal: ctx.signal,
                onProgress: ctx.progress,
              });
              if (result.success) await refreshCheckoutHistory(resource);
              return result;
            }
          ),
        toError: toJobError,
      },
    },
  };
}

function liveModelHostProvider<Def extends LiveModelDef>(
  contract: Def,
  sourceHost: LiveModelHost<Def>
): LiveModelProvider<Def> {
  return {
    kind: 'liveModelProvider',
    contract,
    resolveState: (key, name) => sourceHost.get(key)?.states[name],
    async runMutation(name, envelope) {
      const result = await sourceHost.runMutation(name, envelope);
      if (!result.success) return result;
      return {
        success: true,
        data: {
          data: result.data.data,
          cursors: result.data.cursors.map((cursor) => ({
            ...cursor,
            model: rebindModelId(cursor.model, sourceHost.contract.id, contract.id),
          })),
        },
      };
    },
  };
}

function rebindModelId(model: string, sourceId: string, targetId: string): string {
  if (model === sourceId) return targetId;
  if (model.startsWith(`${sourceId}.`)) return `${targetId}${model.slice(sourceId.length)}`;
  return model;
}

function fileDiffModelProvider<Def extends LiveModelDef>(
  def: Def,
  sessions: GitSessionManager
): LiveModelProvider<Def> {
  const provider: LiveModelProvider = {
    kind: 'liveModelProvider',
    contract: def,
    resolveState: (key) => {
      const { checkoutPath, path } = key as CheckoutKey & { path: string };
      return sessions.checkoutFileDiffSource({ checkoutPath }, path);
    },
    runMutation: () => {
      throw new Error('git.checkout.fileDiff has no mutations');
    },
  };
  return provider as LiveModelProvider<Def>;
}

async function withRepositoryJob<T, E>(
  sessions: GitSessionManager,
  key: RepositoryKey,
  run: (resource: RepositoryResource) => Promise<Result<T, E>>
): Promise<Result<T, E>> {
  const session = sessions.requireRepositorySession(key);
  if (!session.success) return session as Result<T, E>;
  return run(session.data);
}

async function withCheckoutJob<T, E>(
  sessions: GitSessionManager,
  key: CheckoutKey,
  run: (resource: CheckoutResource) => Promise<Result<T, E>>
): Promise<Result<T, E>> {
  const session = sessions.requireCheckoutSession(key);
  if (!session.success) return session as Result<T, E>;
  return run(session.data);
}

async function withCheckoutRead<T>(
  key: CheckoutKey,
  sessions: GitSessionManager,
  read: (resource: CheckoutResource) => Promise<Result<T, GitCommandError>>
): Promise<Result<T, GitCommandError>> {
  const session = sessions.requireCheckoutSession(key);
  if (!session.success) return session;
  try {
    return await read(session.data);
  } catch (error) {
    return { success: false, error: toGitCommandError(error) };
  }
}

async function refreshCheckoutHistory(resource: CheckoutResource): Promise<void> {
  await Promise.all([
    resource.refreshStatus(),
    resource.refreshHead(),
    resource.repository.refreshRefs(),
  ]);
  resource.bumpAllDiffStates('ref-changed');
}

function toJobError<E>(error: unknown): E {
  if (error && typeof error === 'object' && 'type' in error) return error as E;
  return toGitCommandError(error) as E;
}
