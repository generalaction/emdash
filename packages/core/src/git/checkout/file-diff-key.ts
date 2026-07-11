import { z } from 'zod';
import { checkoutSelectorSchema } from '../api/selectors';
import { gitFilePathSchema, normalizedDiffTargetSchema } from './schemas';

export const boundFileDiffKeySchema = z.object({
  filePath: gitFilePathSchema,
  target: normalizedDiffTargetSchema,
});
export type BoundFileDiffKey = z.infer<typeof boundFileDiffKeySchema>;

export const fileDiffKeySchema = checkoutSelectorSchema.extend(boundFileDiffKeySchema.shape);
export type FileDiffKey = z.infer<typeof fileDiffKeySchema>;
