import { ComponentType, Fragment, useCallback, useMemo, useState, type ReactNode } from 'react';
import { projectView } from '@renderer/views/projects/view';
import { HomeMainPanel, HomeTitlebar } from '../views/home-view';
import { SettingsMainPanel, SettingsTitlebar, SettingsViewWrapper } from '../views/settings-view';
import { SkillsMainPanel, SkillsTitlebar } from '../views/skills-view';
import { TaskMainPanel, TaskRightSidebar, TaskTitlebar } from '../views/task-view';
import { TaskViewWrapper } from './CurrentTaskProvider';
import {
  WorkspaceNavigateContext,
  WorkspaceSlotsContext,
  WorkspaceWrapParamsContext,
  type NavigateFn,
  type SlotsContextValue,
  type WrapParamsContextValue,
} from './WorkspaceNavigationContext';

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

const views = {
  home: {
    TitlebarSlot: HomeTitlebar,
    MainPanel: HomeMainPanel,
  },
  skills: {
    TitlebarSlot: SkillsTitlebar,
    MainPanel: SkillsMainPanel,
  },
  project: projectView,
  task: {
    WrapView: TaskViewWrapper,
    TitlebarSlot: TaskTitlebar,
    MainPanel: TaskMainPanel,
    RightPanel: TaskRightSidebar,
  },
  settings: {
    WrapView: SettingsViewWrapper,
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

const DEFAULT_VIEW_STATE: ViewState = { viewId: 'home', wrapParams: {} } as ViewState;

export function WorkspaceViewProvider({ children }: { children: ReactNode }) {
  const [viewState, setViewState] = useState<ViewState>(DEFAULT_VIEW_STATE);

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
