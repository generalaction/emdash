import { createController, type Controller } from '@emdash/wire/api';
import { searchOperations } from '@main/core/search/controller';
import { searchContract } from '../api';

export function createSearchWireController(): Controller {
  return createController(searchContract, {
    commandPalette: (input) => searchOperations.commandPalette(input),
    searchWorkspaceFiles: (input) => searchOperations.searchWorkspaceFiles(input),
  });
}
