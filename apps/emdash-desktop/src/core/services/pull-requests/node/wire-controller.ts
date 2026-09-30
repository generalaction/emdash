import type { Scope } from '@emdash/shared/concurrency';
import { createController, type Controller } from '@emdash/wire/rpc';
import { expose } from '@emdash/wire/state';
import { pullRequestsContract } from '../api';
import type { PullRequestService } from './pull-request-service';

export function createPullRequestsWireController(
  service: PullRequestService,
  scope: Scope
): Controller {
  const details = expose(
    pullRequestsContract.details,
    {
      state: (key, lease) => service.observePullRequest(key, lease),
    },
    { lingerMs: 0 }
  );
  const syncState = expose(pullRequestsContract.syncState, {
    state: (key, lease) => service.observeRepository(key.repositoryUrl, lease),
  });
  scope.add(() => details.dispose());
  scope.add(() => syncState.dispose());
  return createController(pullRequestsContract, {
    listPullRequests: (input) => service.listPullRequests(input),
    getFilterOptions: (input) => service.getFilterOptions(input.repositoryUrls),
    getPullRequestsForBranch: (input) =>
      service.getPullRequestsForBranch(input.repositoryUrl, input.branch),
    getPullRequestsForHead: (input) =>
      service.getPullRequestsForHead(
        input.repositoryUrl,
        input.headRepositoryUrl,
        input.headRefName
      ),
    getPullRequestByUrl: (input) => service.getPullRequestByUrl(input.repositoryUrl, input.url),
    registerRepository: (input) => service.registerRepository(input.repositoryUrl),
    unregisterRepository: (input, meta) =>
      service.runOperation('unregister-repository', meta.signal, () =>
        service.unregisterRepository(input.repositoryUrl)
      ),
    refreshRepository: (input) => service.refreshRepository(input),
    releaseRepository: (input) => service.releaseRepository(input.repositoryUrl),
    refreshPullRequest: (input) => service.refreshPullRequest(input),
    details,
    refreshHistory: (input, meta) =>
      service.runOperation('refresh-history', meta.signal, (signal) =>
        service.refreshHistory(input.repositoryUrl, signal)
      ),
    createPullRequest: (input, meta) =>
      service.runOperation('create-pull-request', meta.signal, (signal) =>
        service.createPullRequest(input, signal)
      ),
    mergePullRequest: (input, meta) =>
      service.runOperation('merge-pull-request', meta.signal, (signal) =>
        service.mergePullRequest(input.repositoryUrl, input.number, input.options, signal)
      ),
    markReadyForReview: (input, meta) =>
      service.runOperation('mark-ready-for-review', meta.signal, (signal) =>
        service.markReadyForReview(input.repositoryUrl, input.number, signal)
      ),
    getPullRequestFiles: (input, meta) =>
      service.runOperation('get-pull-request-files', meta.signal, (signal) =>
        service.getPullRequestFiles(input.repositoryUrl, input.number, signal)
      ),
    syncState,
  });
}
