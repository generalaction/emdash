import { portableRelativePathSchema, resourceUriSchema } from '@emdash/core/primitives/path/api';
import { z } from 'zod';

export type PaletteEntityKind = 'task' | 'project' | 'conversation';

export interface SearchItem {
  kind: PaletteEntityKind;
  id: string;
  projectId: string | null;
  taskId: string | null;
  title: string;
  subtitle: string;
  score: number;
}

export interface PaletteEntitySearchQuery {
  kind: PaletteEntityKind;
  query: string;
  context?: {
    projectId?: string;
    taskId?: string;
    workspaceId?: string;
  };
  limit?: number;
}

export const workspaceFileSearchQuerySchema = z.object({
  workspaceId: z.string().min(1),
  query: z.string(),
  limit: z.number().optional(),
});

export type WorkspaceFileSearchQuery = z.infer<typeof workspaceFileSearchQuerySchema>;

export const workspaceFileHitSchema = z.object({
  resource: resourceUriSchema,
  relativePath: portableRelativePathSchema,
  filename: z.string(),
});

export type WorkspaceFileHit = z.infer<typeof workspaceFileHitSchema>;
