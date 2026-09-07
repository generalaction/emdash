import { fileSearchContract } from '@emdash/core/runtimes/file-search/api';
import { runtimeResolveErrorSchema } from '@emdash/core/services/runtime-broker/api';
import { defineContract, liveJob, procedure } from '@emdash/wire/rpc';
import { z } from 'zod';
import type { PaletteEntitySearchQuery, SearchItem } from '@core/primitives/search/api';
import {
  workspaceFileHitSchema,
  workspaceFileSearchQuerySchema,
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

export const searchDomain = 'search' as const;

export const searchContract = defineContract({
  searchPaletteEntities: procedure({
    input: z.custom<PaletteEntitySearchQuery>(),
    output: z.custom<SearchItem[]>(),
  }),
  searchWorkspaceFiles: procedure({
    input: workspaceFileSearchQuerySchema,
    output: z.array(workspaceFileHitSchema),
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
