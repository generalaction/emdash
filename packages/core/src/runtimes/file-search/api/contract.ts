import { defineContract, fallible, liveJob, liveModel, liveState } from '@emdash/wire/rpc';
import { z } from 'zod';
import {
  contentSearchErrorSchema,
  fileSearchUnregisterRootErrorSchema,
  pathSearchErrorSchema,
} from './errors';
import {
  activeRootStatusSchema,
  contentSearchInputSchema,
  contentSearchProgressSchema,
  contentSearchResultSchema,
  evictRootInputSchema,
  fileSearchRootInputSchema,
  pathSearchInputSchema,
  pathSearchResultSchema,
} from './schemas';

export const fileSearchContract = defineContract({
  activeRoot: liveModel({
    key: fileSearchRootInputSchema,
    states: {
      status: liveState({ data: activeRootStatusSchema }),
    },
  }),
  evictRoot: fallible({
    input: evictRootInputSchema,
    data: z.void(),
    error: fileSearchUnregisterRootErrorSchema,
  }),
  searchPaths: fallible({
    input: pathSearchInputSchema,
    data: pathSearchResultSchema,
    error: pathSearchErrorSchema,
  }),
  searchContent: liveJob({
    input: contentSearchInputSchema,
    progress: contentSearchProgressSchema,
    result: contentSearchResultSchema,
    error: contentSearchErrorSchema,
  }),
});

export type FileSearchContract = typeof fileSearchContract;
