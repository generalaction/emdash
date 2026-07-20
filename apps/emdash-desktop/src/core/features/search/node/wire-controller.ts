import { createController, type Controller } from '@emdash/wire/api';
import { searchContract } from '../api';
import { searchService } from './search-service';

export function createSearchWireController(): Controller {
  return createController(searchContract, {
    commandPalette: (input) => searchService.search(input),
    searchWorkspaceFiles: ({ workspaceId, query, limit }) =>
      searchService.searchFiles(workspaceId, query, limit),
  });
}
