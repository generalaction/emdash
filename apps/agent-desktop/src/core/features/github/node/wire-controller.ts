import { createController, type Controller } from '@agent/wire/rpc';
import { createGithubOperations } from '@core/features/github/node/controller';
import { githubContract } from '../api';

export function createGithubWireController(
  dependencies: Parameters<typeof createGithubOperations>[0]
): Controller {
  const githubOperations = createGithubOperations(dependencies);
  return createController(githubContract, {
    importCliAccounts: () => githubOperations.importCliAccounts(),
    getOwners: ({ accountId }) => githubOperations.getOwners(accountId),
    createRepository: (input) => githubOperations.createRepository(input),
    deleteRepository: (input) => githubOperations.deleteRepository(input),
  });
}
