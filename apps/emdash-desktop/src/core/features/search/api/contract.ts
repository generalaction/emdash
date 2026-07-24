import { fileSearchContract } from '@emdash/core/runtimes/file-search/api';
import { runtimeResolveErrorSchema } from '@emdash/core/services/runtime-broker/api';
import { defineContract, liveJob, procedure } from '@emdash/wire';
import { z } from 'zod';
import type {
  CommandPaletteQuery,
  SearchItem,
  WorkspaceFileHit,
  WorkspaceFileSearchQuery,
} from '@core/primitives/search/api';

const workspaceContentSearchInputSchema = fileSearchContract.searchContent.input
  .omit({ root: true })
  .extend({ workspaceId: z.string().min(1) });

const workspaceNotFoundErrorSchema = z.object({
  type: z.literal('workspace-not-found'),
  workspaceId: z.string(),
  message: z.string(),
});

/** Host-runtime shape used internally by the node relay. */
export const contentSearchRuntimeContract = defineContract({
  searchContent: fileSearchContract.searchContent,
});

export const searchContract = defineContract({
  commandPalette: procedure({
    input: z.custom<CommandPaletteQuery>(),
    output: z.custom<SearchItem[]>(),
  }),
  searchWorkspaceFiles: procedure({
    input: z.custom<WorkspaceFileSearchQuery>(),
    output: z.custom<WorkspaceFileHit[]>(),
  }),
  searchWorkspaceContent: liveJob({
    input: workspaceContentSearchInputSchema,
    progress: fileSearchContract.searchContent.progress,
    result: fileSearchContract.searchContent.result,
    error: z.union([
      fileSearchContract.searchContent.error,
      runtimeResolveErrorSchema,
      workspaceNotFoundErrorSchema,
    ]),
  }),
});
