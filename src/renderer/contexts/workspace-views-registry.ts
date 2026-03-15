import type { ComponentType, ReactNode } from 'react';
import { projectView } from '@renderer/views/projects/view';
import { taskView } from '@renderer/views/tasks/view';
import { HomeMainPanel, HomeTitlebar } from '../views/home-view';
import { SettingsMainPanel, SettingsTitlebar, SettingsViewWrapper } from '../views/settings-view';
import { SkillsMainPanel, SkillsTitlebar } from '../views/skills-view';

export type ViewDefinition<TParams extends object = Record<never, never>> = {
  WrapView?: ComponentType<{ children: ReactNode } & TParams>;
  TitlebarSlot?: ComponentType;
  MainPanel: ComponentType;
  RightPanel?: ComponentType;
};

export const views = {
  home: {
    TitlebarSlot: HomeTitlebar,
    MainPanel: HomeMainPanel,
  },
  skills: {
    TitlebarSlot: SkillsTitlebar,
    MainPanel: SkillsMainPanel,
  },
  project: projectView,
  task: taskView,
  settings: {
    WrapView: SettingsViewWrapper,
    TitlebarSlot: SettingsTitlebar,
    MainPanel: SettingsMainPanel,
  },
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
