import { createController, type Controller } from '@emdash/wire/api';
import { searchContract } from '../api';
import type { SearchService } from './search-service';

export function createSearchWireController(service: SearchService): Controller {
  return createController(searchContract, {
    commandPalette: (input) => service.search(input),
    searchWorkspaceFiles: ({ workspaceId, query, limit }) =>
      service.searchFiles(workspaceId, query, limit),
    searchWorkspaceContent: {
      run: (input, context) => service.searchContent(input, context),
    },
  });
}
