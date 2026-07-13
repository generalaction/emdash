import { defineContract, fallible } from '@emdash/wire';
import { z } from 'zod';
import {
  fileSearchErrorSchema,
  fileSearchQuerySchema,
  fileSearchRegisterRootErrorSchema,
  fileSearchRegisterRootInputSchema,
  fileSearchResultSchema,
  fileSearchUnregisterRootErrorSchema,
  fileSearchUnregisterRootInputSchema,
} from './schemas';

export const fileSearchContract = defineContract({
  registerRoot: fallible({
    input: fileSearchRegisterRootInputSchema,
    data: z.void(),
    error: fileSearchRegisterRootErrorSchema,
  }),
  unregisterRoot: fallible({
    input: fileSearchUnregisterRootInputSchema,
    data: z.void(),
    error: fileSearchUnregisterRootErrorSchema,
  }),
  search: fallible({
    input: fileSearchQuerySchema,
    data: fileSearchResultSchema,
    error: fileSearchErrorSchema,
  }),
});

export type FileSearchContract = typeof fileSearchContract;
