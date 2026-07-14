import { z } from 'zod';

export const fileSearchComponentConfigSchema = z.object({
  databasePath: z.string().min(1),
  maxIndexedFiles: z.number().int().positive().optional(),
  maxConcurrentScans: z.number().int().positive().optional(),
});

export type FileSearchComponentConfig = z.infer<typeof fileSearchComponentConfigSchema>;
