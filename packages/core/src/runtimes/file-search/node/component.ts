import { z } from 'zod';

export const fileSearchComponentConfigSchema = z.object({
  databasePath: z.string().min(1),
  ripgrepPath: z.string().min(1).optional(),
  maxConcurrentScans: z.number().int().positive().optional(),
  maxConcurrentContentSearches: z.number().int().positive().optional(),
});

export type FileSearchComponentConfig = z.infer<typeof fileSearchComponentConfigSchema>;
