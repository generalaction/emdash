import { defineContract, eventStream } from '@emdash/wire/api';
import { z } from 'zod';

export const watchKeySchema = z.object({
  root: z.string(),
  ignore: z.array(z.string()),
});

export const watchEventSchema = z.object({
  kind: z.enum(['create', 'update', 'delete']),
  path: z.string(),
});

export const watchEventsBatchSchema = z.object({
  kind: z.literal('events'),
  events: z.array(watchEventSchema),
});

export const watchResyncSchema = z.object({
  kind: z.literal('resync'),
});

export const watchReadySchema = z.object({
  kind: z.literal('ready'),
});

export const watchErrorSchema = z.object({
  kind: z.literal('error'),
  message: z.string(),
});

export const fsWatchContract = defineContract({
  events: eventStream({
    key: watchKeySchema,
    event: z.union([watchEventsBatchSchema, watchResyncSchema, watchReadySchema, watchErrorSchema]),
  }),
});

export type FsWatchKey = z.infer<typeof watchKeySchema>;
export type FsWatchEvent = z.infer<typeof watchEventSchema>;
export type FsWatchStreamEvent =
  | z.infer<typeof watchEventsBatchSchema>
  | z.infer<typeof watchResyncSchema>
  | z.infer<typeof watchReadySchema>
  | z.infer<typeof watchErrorSchema>;
