import { automationsViewDef } from '@core/features/automations/contributions/views';
import { libraryViewDef } from '@core/features/library/contributions/views';
import { mcpViewDef } from '@core/features/mcp/contributions/views';
import { projectViewDef } from '@core/features/projects/contributions/views';
import { settingsViewDef } from '@core/features/settings/contributions/views';
import { skillsViewDef } from '@core/features/skills/contributions/views';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import { homeViewDef } from '@core/features/workbench/contributions/views';
import { defineViewCatalog } from '@core/primitives/views/api';

export const viewCatalog = defineViewCatalog([
  homeViewDef,
  automationsViewDef,
  libraryViewDef,
  skillsViewDef,
  mcpViewDef,
  projectViewDef,
  taskViewDef,
  settingsViewDef,
] as const);

export type ViewId = (typeof viewCatalog.defs)[number]['id'];
