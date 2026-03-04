import { ComponentType, Fragment, useCallback, useMemo, type ReactNode } from 'react';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { ProjectViewWrapper } from './CurrentProjectProvider';
import { TaskViewWrapper } from './CurrentTaskProvider';
import { HomeTitlebar, HomeMainPanel } from '../views/home-view';
import { SkillsTitlebar, SkillsMainPanel } from '../views/skills-view';
import { ProjectTitlebar, ProjectMainPanel } from '../views/project-view';
import { TaskTitlebar, TaskMainPanel, TaskRightSidebar } from '../views/task-view';
import { SettingsViewWrapper, SettingsTitlebar, SettingsMainPanel } from '../views/settings-view';
import {
  WorkspaceNavigateContext,
  WorkspaceSlotsContext,
  WorkspaceWrapParamsContext,
} from './WorkspaceNavigationContext';
import type {
  SlotsContextValue,
  WrapParamsContextValue,
  NavigateFn,
} from './WorkspaceNavigationContext';
import type { SettingsPageTab } from '../components/SettingsPage';

// Re-export hooks and types that consumers need
export {
  useWorkspaceNavigation,
  useWorkspaceSlots,
  useWorkspaceWrapParams,
  isCurrentView,
} from './WorkspaceNavigationContext';

type ViewDefinition<TParams extends object = Record<never, never>> = {
  WrapView?: ComponentType<{ children: ReactNode } & TParams>;
  TitlebarSlot?: ComponentType;
  MainPanel: ComponentType;
  RightPanel?: ComponentType;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const views = {
  home: {
    TitlebarSlot: HomeTitlebar,
    MainPanel: HomeMainPanel,
  },
  skills: {
    TitlebarSlot: SkillsTitlebar,
    MainPanel: SkillsMainPanel,
  },
  project: {
    WrapView: ProjectViewWrapper,
    TitlebarSlot: ProjectTitlebar,
    MainPanel: ProjectMainPanel,
  },
  task: {
    WrapView: TaskViewWrapper,
    TitlebarSlot: TaskTitlebar,
    MainPanel: TaskMainPanel,
    RightPanel: TaskRightSidebar,
  },
  settings: {
    WrapView: SettingsViewWrapper as ComponentType<{
      children: ReactNode;
      tab?: SettingsPageTab;
    }>,
    TitlebarSlot: SettingsTitlebar,
    MainPanel: SettingsMainPanel,
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} satisfies Record<string, ViewDefinition<any>>;

type Views = typeof views;
type ViewId = keyof Views;

type WrapParams<TId extends ViewId> = Views[TId] extends { WrapView: ComponentType<infer P> }
  ? Omit<P, 'children'>
  : Record<never, never>;

type NavArgs<TId extends ViewId> = keyof WrapParams<TId> extends never
  ? [viewId: TId]
  : [viewId: TId, params: WrapParams<TId>];

export type NavigateFnTyped = <TId extends ViewId>(...args: NavArgs<TId>) => void;

type ViewState = {
  [K in ViewId]: { viewId: K; wrapParams: WrapParams<K> };
}[ViewId];

const VIEW_STATE_KEY = 'emdash:view-state';
const DEFAULT_VIEW_STATE: ViewState = { viewId: 'home', wrapParams: {} } as ViewState;

export function WorkspaceViewProvider({ children }: { children: ReactNode }) {
  const [viewState, setViewState] = useLocalStorage<ViewState>(VIEW_STATE_KEY, DEFAULT_VIEW_STATE);

  const navigate = useCallback(
    (...args: unknown[]) => {
      const [viewId, params] = args as [ViewId, Record<string, unknown>?];
      setViewState({ viewId, wrapParams: params ?? {} } as ViewState);
    },
    [setViewState]
  ) as NavigateFnTyped;

  const slotsValue = useMemo((): SlotsContextValue => {
    const def = (views as unknown as Record<string, ViewDefinition<Record<string, unknown>>>)[
      viewState.viewId
    ];
    return {
      WrapView: (def.WrapView ?? Fragment) as ComponentType<
        { children: ReactNode } & Record<string, unknown>
      >,
      TitlebarSlot: def.TitlebarSlot ?? (() => null),
      MainPanel: def.MainPanel,
      RightPanel: def.RightPanel ?? null,
      currentView: viewState.viewId,
    };
  }, [viewState.viewId]);

  const wrapParamsValue = useMemo(
    (): WrapParamsContextValue => ({
      wrapParams: viewState.wrapParams as Record<string, unknown>,
    }),
    [viewState.wrapParams]
  );

  return (
    <WorkspaceNavigateContext.Provider value={navigate as unknown as NavigateFn}>
      <WorkspaceSlotsContext.Provider value={slotsValue}>
        <WorkspaceWrapParamsContext.Provider value={wrapParamsValue}>
          {children}
        </WorkspaceWrapParamsContext.Provider>
      </WorkspaceSlotsContext.Provider>
    </WorkspaceNavigateContext.Provider>
  );
}

export type { ViewId, ViewState };
