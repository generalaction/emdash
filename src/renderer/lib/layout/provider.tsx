import { runInAction } from 'mobx';
import {
  ComponentType,
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from 'react';
import {
  views,
  type ViewDefinition,
  type ViewId,
  type WrapParams,
} from '@renderer/app/view-registry';
import { useModalContext } from '@renderer/lib/modal/modal-provider';
import { appState } from '@renderer/lib/stores/app-state';
import { focusTracker } from '@renderer/utils/focus-tracker';
import { clearTelemetryTaskScope, setTelemetryTaskScope } from '@renderer/utils/telemetry-scope';
import { captureTelemetry } from '@renderer/utils/telemetryClient';
import {
  WorkspaceNavigateContext,
  WorkspaceNavigationHistoryContext,
  WorkspaceSlotsContext,
  WorkspaceUpdateViewParamsContext,
  WorkspaceViewParamsStoreContext,
  WorkspaceWrapParamsContext,
  type NavigateFnTyped,
  type NavigationHistoryContextValue,
  type SlotsContextValue,
  type UpdateViewParamsFn,
  type WrapParamsContextValue,
} from './navigation-provider';

type ViewParamsStore = Partial<{ [K in ViewId]: WrapParams<K> }>;

type HistoryEntry = {
  viewId: ViewId;
  params?: Record<string, unknown>;
};

type HistoryState = {
  entries: HistoryEntry[];
  index: number;
};

const HISTORY_LIMIT = 50;

function shallowEqualParams(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

function syncTelemetryScope(currentViewId: ViewId, viewParamsStore: ViewParamsStore): void {
  if (currentViewId !== 'task') {
    clearTelemetryTaskScope();
    return;
  }

  const taskParams = viewParamsStore.task;
  if (
    taskParams &&
    typeof taskParams.projectId === 'string' &&
    typeof taskParams.taskId === 'string'
  ) {
    setTelemetryTaskScope({ projectId: taskParams.projectId, taskId: taskParams.taskId });
    return;
  }

  clearTelemetryTaskScope();
}

const viewEvents: Record<
  ViewId,
  | 'home_viewed'
  | 'project_viewed'
  | 'task_viewed'
  | 'settings_viewed'
  | 'skills_viewed'
  | 'mcp_viewed'
> = {
  home: 'home_viewed',
  project: 'project_viewed',
  task: 'task_viewed',
  settings: 'settings_viewed',
  skills: 'skills_viewed',
  mcp: 'mcp_viewed',
};

export function WorkspaceViewProvider({ children }: { children: ReactNode }) {
  const { closeModal } = useModalContext();
  const [currentViewId, setCurrentViewId] = useState<ViewId>(() => {
    const v = appState.navigation.currentViewId;
    return v;
  });
  const [viewParamsStore, setViewParamsStore] = useState<ViewParamsStore>(
    () => appState.navigation.viewParamsStore as ViewParamsStore
  );
  const [historyState, setHistoryState] = useState<HistoryState>(() => {
    const initialId = appState.navigation.currentViewId;
    const initialParams = appState.navigation.viewParamsStore[initialId] as
      | Record<string, unknown>
      | undefined;
    return { entries: [{ viewId: initialId, params: initialParams }], index: 0 };
  });
  const historyStateRef = useRef(historyState);
  const viewParamsStoreRef = useRef(viewParamsStore);
  const [_, startTransition] = useTransition();

  useEffect(() => {
    historyStateRef.current = historyState;
  }, [historyState]);

  useEffect(() => {
    viewParamsStoreRef.current = viewParamsStore;
  }, [viewParamsStore]);

  // Sync React state back to the MobX persistence mirror after every commit.
  // The SnapshotRegistry reaction then debounces the RPC write by 1 s.
  useEffect(() => {
    runInAction(() => appState.navigation.sync(currentViewId, viewParamsStore));
  }, [currentViewId, viewParamsStore]);

  useEffect(() => {
    const initialViewId = appState.navigation.currentViewId;
    focusTracker.initialize({ view: initialViewId });
    syncTelemetryScope(initialViewId, appState.navigation.viewParamsStore as ViewParamsStore);
    captureTelemetry(viewEvents[initialViewId], { from_view: null });
  }, []);

  useEffect(() => {
    syncTelemetryScope(currentViewId, viewParamsStore);
  }, [currentViewId, viewParamsStore]);

  const navigate = useCallback(
    (...args: unknown[]) => {
      const [viewId, params] = args as [ViewId, Record<string, unknown> | undefined];
      if (viewId !== currentViewId) {
        const transition = focusTracker.transition(
          viewId === 'task'
            ? { view: viewId }
            : {
                view: viewId,
                mainPanel: null,
                rightPanel: null,
                focusedRegion: null,
              },
          'navigation'
        );

        captureTelemetry(viewEvents[viewId], {
          from_view: transition?.previous.view ?? null,
        });
      }

      startTransition(() => {
        setCurrentViewId(viewId);
        // Only overwrite stored params when the caller explicitly passes them;
        // navigating without params preserves whatever was stored for that view.
        if (params !== undefined) {
          setViewParamsStore((prev) => ({ ...prev, [viewId]: params }));
        }
        closeModal();

        setHistoryState((prev) => {
          const truncated = prev.entries.slice(0, prev.index + 1);
          const last = truncated[truncated.length - 1];
          const recordedParams = (params ?? viewParamsStoreRef.current[viewId]) as
            | Record<string, unknown>
            | undefined;
          if (last && last.viewId === viewId && shallowEqualParams(last.params, recordedParams)) {
            return prev;
          }
          const next = [...truncated, { viewId, params: recordedParams }];
          const trimmed =
            next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next;
          return { entries: trimmed, index: trimmed.length - 1 };
        });
      });
    },
    [closeModal, currentViewId]
  ) as NavigateFnTyped;

  const navigateToEntry = useCallback(
    (entry: HistoryEntry, nextHistoryState: HistoryState) => {
      if (entry.viewId !== currentViewId) {
        const transition = focusTracker.transition(
          entry.viewId === 'task'
            ? { view: entry.viewId }
            : {
                view: entry.viewId,
                mainPanel: null,
                rightPanel: null,
                focusedRegion: null,
              },
          'navigation'
        );

        captureTelemetry(viewEvents[entry.viewId], {
          from_view: transition?.previous.view ?? null,
        });
      }

      startTransition(() => {
        setHistoryState(nextHistoryState);
        setCurrentViewId(entry.viewId);
        setViewParamsStore((prev) => {
          const next: ViewParamsStore = { ...prev };
          if (entry.params === undefined) {
            delete next[entry.viewId];
          } else {
            (next as Record<ViewId, unknown>)[entry.viewId] = entry.params;
          }
          return next;
        });
        closeModal();
      });
    },
    [closeModal, currentViewId]
  );

  const goBack = useCallback(() => {
    const prev = historyStateRef.current;
    if (prev.index <= 0) return;
    const nextIndex = prev.index - 1;
    navigateToEntry(prev.entries[nextIndex], { ...prev, index: nextIndex });
  }, [navigateToEntry]);

  const goForward = useCallback(() => {
    const prev = historyStateRef.current;
    if (prev.index >= prev.entries.length - 1) return;
    const nextIndex = prev.index + 1;
    navigateToEntry(prev.entries[nextIndex], { ...prev, index: nextIndex });
  }, [navigateToEntry]);

  const navigationHistoryValue = useMemo<NavigationHistoryContextValue>(
    () => ({
      goBack,
      goForward,
      canGoBack: historyState.index > 0,
      canGoForward: historyState.index < historyState.entries.length - 1,
    }),
    [goBack, goForward, historyState]
  );

  const updateViewParams = useCallback(
    <TId extends ViewId>(
      viewId: TId,
      update: Partial<WrapParams<TId>> | ((prev: WrapParams<TId>) => WrapParams<TId>)
    ) => {
      setViewParamsStore((prev) => {
        const current = (prev[viewId] ?? {}) as WrapParams<TId>;
        const next = typeof update === 'function' ? update(current) : { ...current, ...update };
        return { ...prev, [viewId]: next };
      });
    },
    []
  ) as UpdateViewParamsFn;

  const slotsValue = useMemo((): SlotsContextValue => {
    const def = (views as unknown as Record<string, ViewDefinition<Record<string, unknown>>>)[
      currentViewId
    ];
    return {
      WrapView: (def.WrapView ?? Fragment) as ComponentType<
        { children: ReactNode } & Record<string, unknown>
      >,
      TitlebarSlot: def.TitlebarSlot ?? (() => null),
      MainPanel: def.MainPanel,
      RightPanel: def.RightPanel ?? null,
      currentView: currentViewId,
    };
  }, [currentViewId]);

  const wrapParamsValue = useMemo(
    (): WrapParamsContextValue => ({
      wrapParams: (viewParamsStore[currentViewId] ?? {}) as Record<string, unknown>,
    }),
    [viewParamsStore, currentViewId]
  );

  const viewParamsStoreValue = useMemo(() => ({ viewParamsStore }), [viewParamsStore]);

  return (
    <WorkspaceNavigateContext.Provider value={navigate}>
      <WorkspaceNavigationHistoryContext.Provider value={navigationHistoryValue}>
        <WorkspaceSlotsContext.Provider value={slotsValue}>
          <WorkspaceWrapParamsContext.Provider value={wrapParamsValue}>
            <WorkspaceViewParamsStoreContext.Provider value={viewParamsStoreValue}>
              <WorkspaceUpdateViewParamsContext.Provider value={updateViewParams}>
                {children}
              </WorkspaceUpdateViewParamsContext.Provider>
            </WorkspaceViewParamsStoreContext.Provider>
          </WorkspaceWrapParamsContext.Provider>
        </WorkspaceSlotsContext.Provider>
      </WorkspaceNavigationHistoryContext.Provider>
    </WorkspaceNavigateContext.Provider>
  );
}
