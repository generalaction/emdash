import { z } from 'zod';

export const appDetectionStatusSchema = z.enum(['detected', 'not-detected', 'unknown']);
export type AppDetectionStatus = z.infer<typeof appDetectionStatusSchema>;
export type AppDetectionResults = Record<string, AppDetectionStatus>;
