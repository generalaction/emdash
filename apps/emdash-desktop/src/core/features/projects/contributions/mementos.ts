import { defineVersionedSchema } from '@emdash/core/primitives/versioned-schema/api';
import { z } from 'zod';
import { defineMemento } from '@core/primitives/mementos/api';
import { projectSubject } from './subject';

const projectViewV1Schema = z.object({
  version: z.literal('1'),
  activeView: z.enum(['tasks', 'pull-request', 'workspaces', 'settings']),
  taskViewTab: z.enum(['active', 'archived']),
  selectedIssueProvider: z.string().optional(),
});

export const projectViewSchema = defineVersionedSchema().initial('1', projectViewV1Schema).build();

export type ProjectViewState = typeof projectViewSchema.Type;

export const projectViewMemento = defineMemento({
  id: 'projects.view',
  subject: projectSubject,
  schema: projectViewSchema,
  default: {
    version: '1' as const,
    activeView: 'tasks' as const,
    taskViewTab: 'active' as const,
  },
});
