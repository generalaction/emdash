import { z } from 'zod';

/** Identifies a repository by its canonical (realpath-resolved) top-level root. */
export const repositoryKeySchema = z.object({ repositoryRoot: z.string() });
export type RepositoryKey = z.infer<typeof repositoryKeySchema>;
