import { projectViewMemento } from '@core/features/projects/contributions/mementos';
import {
  taskChromeMemento,
  taskDiffPreferencesMemento,
  taskDiffSelectionMemento,
  taskEditorTreeMemento,
  taskPaneLayoutMemento,
  taskTerminalSelectionMemento,
} from '@core/features/tasks/contributions/mementos';
import {
  workbenchNavigationMemento,
  workbenchSidebarMemento,
} from '@core/features/workbench/contributions/mementos';
import type { MementoCatalogEntry } from '@core/primitives/mementos/api';

/**
 * Composition-root registry for persisted mementos.
 *
 * Definitions remain colocated with their owning feature and are imported here.
 * The worker uses this catalog for retention policies; the renderer uses it for
 * subject-level prefetch.
 */
export const mementoCatalog: readonly MementoCatalogEntry[] = [
  projectViewMemento,
  taskChromeMemento,
  taskTerminalSelectionMemento,
  taskEditorTreeMemento,
  taskDiffPreferencesMemento,
  taskDiffSelectionMemento,
  taskPaneLayoutMemento,
  workbenchSidebarMemento,
  workbenchNavigationMemento,
];

export const mementoSweepPolicies = mementoCatalog.flatMap((definition) =>
  definition.retention.tier === 'persisted'
    ? [
        {
          mementoId: definition.id,
          maxAge: definition.retention.maxAge,
          maxEntries: definition.retention.maxEntries,
        },
      ]
    : []
);
