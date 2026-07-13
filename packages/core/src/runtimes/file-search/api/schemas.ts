import { hostAbsolutePathSchema, portableRelativePathSchema } from '@primitives/path/api';
import { z } from 'zod';

export const FILE_SEARCH_DEFAULT_LIMIT = 20;
export const FILE_SEARCH_MAX_LIMIT = 200;
export const FILE_SEARCH_MAX_QUERY_LENGTH = 512;

export const fileSearchIndexKeySchema = z.object({
  root: hostAbsolutePathSchema,
});

export const fileSearchRegisterRootInputSchema = fileSearchIndexKeySchema;
export const fileSearchUnregisterRootInputSchema = fileSearchIndexKeySchema;

export const fileSearchQuerySchema = fileSearchIndexKeySchema.extend({
  query: z.string().max(FILE_SEARCH_MAX_QUERY_LENGTH),
  limit: z.number().int().positive().max(FILE_SEARCH_MAX_LIMIT).optional(),
});

export const fileSearchHitSchema = z.object({
  path: portableRelativePathSchema,
});

export const fileSearchResultSchema = z.object({
  hits: z.array(fileSearchHitSchema),
});

export const fileSearchRootUnavailableReasonSchema = z.enum([
  'not-found',
  'not-a-directory',
  'permission-denied',
  'invalid-path',
]);

export const fileSearchRootUnavailableErrorSchema = z.object({
  type: z.literal('root-unavailable'),
  root: hostAbsolutePathSchema,
  reason: fileSearchRootUnavailableReasonSchema,
  message: z.string(),
});

export const fileSearchIndexNotReadyErrorSchema = z.object({
  type: z.literal('index-not-ready'),
  root: hostAbsolutePathSchema,
  message: z.string(),
});

export const fileSearchIoErrorSchema = z.object({
  type: z.literal('io'),
  root: hostAbsolutePathSchema,
  message: z.string(),
});

export const fileSearchRegisterRootErrorSchema = z.discriminatedUnion('type', [
  fileSearchRootUnavailableErrorSchema,
  fileSearchIoErrorSchema,
]);

export const fileSearchUnregisterRootErrorSchema = fileSearchIoErrorSchema;

export const fileSearchErrorSchema = z.discriminatedUnion('type', [
  fileSearchRootUnavailableErrorSchema,
  fileSearchIndexNotReadyErrorSchema,
  fileSearchIoErrorSchema,
]);

export type FileSearchIndexKey = z.infer<typeof fileSearchIndexKeySchema>;
export type FileSearchRegisterRootInput = z.infer<typeof fileSearchRegisterRootInputSchema>;
export type FileSearchUnregisterRootInput = z.infer<typeof fileSearchUnregisterRootInputSchema>;
export type FileSearchQuery = z.infer<typeof fileSearchQuerySchema>;
export type FileSearchHit = z.infer<typeof fileSearchHitSchema>;
export type FileSearchResult = z.infer<typeof fileSearchResultSchema>;
export type FileSearchRootUnavailableReason = z.infer<typeof fileSearchRootUnavailableReasonSchema>;
export type FileSearchRootUnavailableError = z.infer<typeof fileSearchRootUnavailableErrorSchema>;
export type FileSearchIndexNotReadyError = z.infer<typeof fileSearchIndexNotReadyErrorSchema>;
export type FileSearchIoError = z.infer<typeof fileSearchIoErrorSchema>;
export type FileSearchRegisterRootError = z.infer<typeof fileSearchRegisterRootErrorSchema>;
export type FileSearchUnregisterRootError = z.infer<typeof fileSearchUnregisterRootErrorSchema>;
export type FileSearchError = z.infer<typeof fileSearchErrorSchema>;
