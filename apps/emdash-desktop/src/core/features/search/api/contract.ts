import { defineContract, procedure } from '@emdash/wire';
import { z } from 'zod';
import type {
  CommandPaletteQuery,
  SearchItem,
  WorkspaceFileHit,
  WorkspaceFileSearchQuery,
} from '@core/primitives/search/api';

export const searchContract = defineContract({
  commandPalette: procedure({
    input: z.custom<CommandPaletteQuery>(),
    output: z.custom<SearchItem[]>(),
  }),
  searchWorkspaceFiles: procedure({
    input: z.custom<WorkspaceFileSearchQuery>(),
    output: z.custom<WorkspaceFileHit[]>(),
  }),
});
