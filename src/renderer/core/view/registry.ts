import type { ComponentType, ReactNode } from 'react';
import { homeView } from '@renderer/views/home-view';
import { projectView } from '@renderer/views/projects/view';
import { settingsView } from '@renderer/views/settings/settings-view';
import { skillsView } from '@renderer/views/skills-view';
import { taskView } from '@renderer/views/tasks/view';

export type ViewDefinition<TParams extends object = Record<never, never>> = {
  WrapView?: ComponentType<{ children: ReactNode } & TParams>;
  TitlebarSlot?: ComponentType;
  MainPanel: ComponentType;
  RightPanel?: ComponentType;
};

export const views = {
  home: homeView,
  skills: skillsView,
  project: projectView,
  task: taskView,
  settings: settingsView,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} satisfies Record<string, ViewDefinition<any>>;

type Views = typeof views;

/** Union of all registered view IDs — inferred from the registry. */
export type ViewId = keyof Views;

/** Params accepted by a view's WrapView component (empty for views with no WrapView). */
export type WrapParams<TId extends ViewId> = Views[TId] extends {
  WrapView: ComponentType<infer P>;
}
  ? Omit<P, 'children'>
  : Record<never, never>;
