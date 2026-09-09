import {
  acpDraftMemento,
  providerPreferencesMemento,
} from '@core/features/conversations/contributions/mementos';
import {
  projectViewMemento,
  workspaceChromeMemento,
} from '@core/features/projects/contributions/mementos';
import {
  taskChromeMemento,
  taskDiffPreferencesMemento,
  taskDiffSelectionMemento,
  taskEditorTreeMemento,
  taskPaneLayoutMemento,
  taskPanelLayoutsMemento,
  taskTerminalSelectionMemento,
} from '@core/features/tasks/contributions/mementos';
import {
  workbenchPanelLayoutsMemento,
  workbenchSidebarMemento,
} from '@core/features/workbench/contributions/mementos';
import type { MementoCatalogEntry } from '@core/primitives/mementos/api';
import { workbenchHistoryMemento } from '@core/primitives/navigation/api/mementos';

/**
 * Composition-root registry for persisted mementos.
 *
 * Definitions remain colocated with their owning feature and are imported here.
 * The worker uses this catalog for retention policies; the renderer uses it for
 * subject-level prefetch.
 */
export const mementoCatalog: readonly MementoCatalogEntry[] = [
  acpDraftMemento,
  providerPreferencesMemento,
  projectViewMemento,
  workspaceChromeMemento,
  taskChromeMemento,
  taskTerminalSelectionMemento,
  taskEditorTreeMemento,
  taskDiffPreferencesMemento,
  taskDiffSelectionMemento,
  taskPaneLayoutMemento,
  taskPanelLayoutsMemento,
  workbenchPanelLayoutsMemento,
  workbenchSidebarMemento,
  workbenchHistoryMemento,
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
