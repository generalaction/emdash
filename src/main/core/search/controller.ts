import type { CommandPaletteQuery } from '@shared/core/search';
import { createRPCController } from '@shared/lib/ipc/rpc';
import { searchService } from './search-service';

export const searchController = createRPCController({
  commandPalette: (query: CommandPaletteQuery) => searchService.search(query),
});
