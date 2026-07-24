/**
 * Task-view tab registry.
 *
 * Instantiates the generic tab-view factory with task-specific providers and
 * the task persistence adapter. This composition belongs to the workbench
 * feature; the workbench-shell primitive owns only the generic tab engine.
 */
import { taskTabContributions } from '@core/manifests/browser/task-tab-contributions';
import {
  type KindOf,
  type OpenArgsOf,
} from '@core/primitives/workbench-shell/browser/tabs/core/tab-provider-registry';
import { createTabView } from '@core/primitives/workbench-shell/browser/tabs/tab-view-factory';
import type { TaskTabContext } from './tabs/task-tab-context';
import { TaskTabViewPersistor } from './tabs/task-tab-view-persistor';

export const taskTabView = createTabView(taskTabContributions, {
  makePersistor: (ctx) => new TaskTabViewPersistor(ctx as TaskTabContext),
});

type TaskRegistry = typeof taskTabView.registry;

export type TaskTabKind = KindOf<TaskRegistry>;
export type TaskOpenArgsOf<K extends TaskTabKind> = OpenArgsOf<TaskRegistry, K>;

export const { useTabLayout, useTabSelection, TabLayoutProvider } = taskTabView;

export const taskTabRegistry = taskTabView.registry;
