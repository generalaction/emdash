import { createRPCController } from '@shared/ipc/rpc';
import type { CommandPaletteQuery } from '@shared/search';
import { searchService } from './search-service';

export const searchController = createRPCController({
  commandPalette: (query: CommandPaletteQuery) => searchService.search(query),
});
