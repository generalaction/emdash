import type { CommandPaletteQuery, WorkspaceFileSearchQuery } from '@core/primitives/search/api';
import { searchService } from './search-service';

export const searchOperations = {
  commandPalette: (query: CommandPaletteQuery) => searchService.search(query),
  searchWorkspaceFiles: (q: WorkspaceFileSearchQuery) =>
    searchService.searchFiles(q.workspaceId, q.query, q.limit),
};
