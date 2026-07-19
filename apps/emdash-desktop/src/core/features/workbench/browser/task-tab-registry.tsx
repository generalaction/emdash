/**
 * Task-view tab registry.
 *
 * Instantiates the generic `createTabView` factory with the five task-specific
 * providers and wires in the task persistence adapter.
 *
 * `taskTabView` is the singleton for task views; import from it to get typed
 * store-creator, hook, and derived types:
 *
 *   const paneLayout = taskTabView.createPaneLayoutStore(ctx);
 *   paneLayout.open('file', { path: '/foo.ts' });   // typed ✓
 *
 * `TaskTabKind`, `TaskOpenArgsOf`, etc. are derived from the provider set,
 * so they stay in sync automatically.
 */

import {
  type KindOf,
  type OpenArgsOf,
} from '@core/features/workbench/browser/tabs/core/tab-provider-registry';
import type { TaskTabContext } from '@core/features/workbench/browser/tabs/core/task-tab-context';
import { createTabView } from '@core/features/workbench/browser/tabs/tab-view-factory';
import { taskTabContributions } from '@core/manifests/browser/task-tab-contributions';
import { TaskTabViewPersistor } from './tabs/task-tab-view-persistor';

export const taskTabView = createTabView(taskTabContributions, {
  makePersistor: (ctx) => new TaskTabViewPersistor(ctx as TaskTabContext),
});

type TaskRegistry = typeof taskTabView.registry;

export type TaskTabKind = KindOf<TaskRegistry>;
export type TaskOpenArgsOf<K extends TaskTabKind> = OpenArgsOf<TaskRegistry, K>;

export const { useTabLayout, useTabSelection, TabLayoutProvider } = taskTabView;

// Keep the registry export for consumers that still import it directly.
export const taskTabRegistry = taskTabView.registry;
