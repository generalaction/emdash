import { defineVersionedSchema } from '@emdash/core/primitives/versioned-schema/api';
import { z } from 'zod';
import { defineMemento } from '@core/primitives/mementos/api';
import { appSubject } from '@core/primitives/subjects/api';

const workbenchSidebarV1Schema = z.object({
  version: z.literal('1'),
  expandedProjectIds: z.array(z.string()),
  projectOrder: z.array(z.string()),
  taskOrderByProject: z.record(z.string(), z.array(z.string())),
  taskSortBy: z.enum(['created-at', 'updated-at']),
});

export const workbenchSidebarSchema = defineVersionedSchema()
  .initial('1', workbenchSidebarV1Schema)
  .build();

export type WorkbenchSidebarState = typeof workbenchSidebarSchema.Type;

export const workbenchSidebarMemento = defineMemento({
  id: 'workbench.sidebar',
  subject: appSubject,
  schema: workbenchSidebarSchema,
  default: {
    version: '1' as const,
    expandedProjectIds: [],
    projectOrder: [],
    taskOrderByProject: {},
    taskSortBy: 'created-at' as const,
  },
});

const workbenchNavigationV1Schema = z.object({
  version: z.literal('1'),
  currentViewId: z.string(),
  viewParams: z.record(z.string(), z.unknown()),
});

export const workbenchNavigationSchema = defineVersionedSchema()
  .initial('1', workbenchNavigationV1Schema)
  .build();

export type WorkbenchNavigationState = typeof workbenchNavigationSchema.Type;

export const workbenchNavigationMemento = defineMemento({
  id: 'workbench.navigation',
  subject: appSubject,
  schema: workbenchNavigationSchema,
  default: {
    version: '1' as const,
    currentViewId: 'home',
    viewParams: {},
  },
});
