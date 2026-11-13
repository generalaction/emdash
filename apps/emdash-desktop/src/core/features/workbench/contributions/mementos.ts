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

const sidebarProjectGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  collapsed: z.boolean(),
});

export type SidebarProjectGroup = z.infer<typeof sidebarProjectGroupSchema>;

// Kept apart from `workbench.sidebar` so app versions without project groups
// ignore this memento instead of treating the whole sidebar state as unreadable.
const workbenchSidebarGroupsV1Schema = z.object({
  version: z.literal('1'),
  /** User-defined project groups, in display order. */
  groups: z.array(sidebarProjectGroupSchema),
  /** Project id -> group id. Projects without an entry are ungrouped. */
  groupByProjectId: z.record(z.string(), z.string()),
});

export const workbenchSidebarGroupsSchema = defineVersionedSchema()
  .initial('1', workbenchSidebarGroupsV1Schema)
  .build();

export type WorkbenchSidebarGroupsState = typeof workbenchSidebarGroupsSchema.Type;

export const workbenchSidebarGroupsMemento = defineMemento({
  id: 'workbench.sidebar-groups',
  subject: appSubject,
  schema: workbenchSidebarGroupsSchema,
  default: {
    version: '1' as const,
    groups: [],
    groupByProjectId: {},
  },
});

const workbenchPanelLayoutsV1Schema = z.object({
  version: z.literal('1'),
  layouts: z.record(z.string(), z.string()),
});

export const workbenchPanelLayoutsSchema = defineVersionedSchema()
  .initial('1', workbenchPanelLayoutsV1Schema)
  .build();
export type WorkbenchPanelLayoutsState = typeof workbenchPanelLayoutsSchema.Type;

export const workbenchPanelLayoutsMemento = defineMemento({
  id: 'workbench.panel-layouts',
  subject: appSubject,
  schema: workbenchPanelLayoutsSchema,
  default: {
    version: '1' as const,
    layouts: {},
  },
});

// The navigation and history mementos moved into the navigation primitive:
// @core/primitives/navigation/api/mementos.
