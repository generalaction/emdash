import { createController, type Controller } from '@emdash/wire/rpc';
import { createGithubOperations } from '@core/features/github/node/controller';
import { githubContract } from '../api';
import { githubEvents } from './event-host';

export function createGithubWireController(
  dependencies: Parameters<typeof createGithubOperations>[0]
): Controller {
  const githubOperations = createGithubOperations(dependencies);
  return createController(githubContract, {
    auth: () => githubOperations.auth(),
    importCliAccounts: () => githubOperations.importCliAccounts(),
    authCancel: () => githubOperations.authCancel(),
    getRepositories: ({ accountId }) => githubOperations.getRepositories(accountId),
    getOwners: ({ accountId }) => githubOperations.getOwners(accountId),
    createRepository: (input) => githubOperations.createRepository(input),
    deleteRepository: (input) => githubOperations.deleteRepository(input),
    events: githubEvents,
  });
}
