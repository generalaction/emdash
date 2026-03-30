import { runInAction } from 'mobx';
import {
  ComponentType,
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from 'react';
import { useModalContext } from '../modal/modal-provider';
import { appState } from '../stores/app-state';
import {
  WorkspaceNavigateContext,
  WorkspaceSlotsContext,
  WorkspaceUpdateViewParamsContext,
  WorkspaceViewParamsStoreContext,
  WorkspaceWrapParamsContext,
  type NavigateFnTyped,
  type SlotsContextValue,
  type UpdateViewParamsFn,
  type WrapParamsContextValue,
} from './navigation-provider';
import { views, type ViewDefinition, type ViewId, type WrapParams } from './registry';

type ViewParamsStore = Partial<{ [K in ViewId]: WrapParams<K> }>;

export function WorkspaceViewProvider({ children }: { children: ReactNode }) {
  const { closeModal } = useModalContext();
  const [currentViewId, setCurrentViewId] = useState<ViewId>(() => {
    const v = appState.navigation.currentViewId;
    // #region agent log
    fetch('http://127.0.0.1:7430/ingest/6ccbb4c2-4905-4756-889f-988f583bdf2f', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'f1d8e3' },
      body: JSON.stringify({
        sessionId: 'f1d8e3',
        location: 'provider.tsx:useState-viewId',
        message: 'useState currentViewId initializer',
        data: { currentViewId: v, viewParams: appState.navigation.viewParamsStore },
        timestamp: Date.now(),
        runId: 'run2',
        hypothesisId: 'D',
      }),
    }).catch(() => {});
    // #endregion
    return v;
  });
  const [viewParamsStore, setViewParamsStore] = useState<ViewParamsStore>(
    () => appState.navigation.viewParamsStore as ViewParamsStore
  );
  const [_, startTransition] = useTransition();

  // Sync React state back to the MobX persistence mirror after every commit.
  // The SnapshotRegistry reaction then debounces the RPC write by 1 s.
  useEffect(() => {
    // #region agent log
    fetch('http://127.0.0.1:7430/ingest/6ccbb4c2-4905-4756-889f-988f583bdf2f', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'f1d8e3' },
      body: JSON.stringify({
        sessionId: 'f1d8e3',
        location: 'provider.tsx:sync-effect',
        message: 'sync useEffect fired',
        data: { currentViewId, viewParams: viewParamsStore },
        timestamp: Date.now(),
        runId: 'run2',
        hypothesisId: 'F',
      }),
    }).catch(() => {});
    // #endregion
    runInAction(() => appState.navigation.sync(currentViewId, viewParamsStore));
  }, [currentViewId, viewParamsStore]);

  const navigate = useCallback(
    (...args: unknown[]) => {
      const [viewId, params] = args as [ViewId, Record<string, unknown> | undefined];
      startTransition(() => {
        setCurrentViewId(viewId);
        // Only overwrite stored params when the caller explicitly passes them;
        // navigating without params preserves whatever was stored for that view.
        if (params !== undefined) {
          setViewParamsStore((prev) => ({ ...prev, [viewId]: params }));
        }
        closeModal();
      });
    },
    [closeModal]
  ) as NavigateFnTyped;

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
      <WorkspaceSlotsContext.Provider value={slotsValue}>
        <WorkspaceWrapParamsContext.Provider value={wrapParamsValue}>
          <WorkspaceViewParamsStoreContext.Provider value={viewParamsStoreValue}>
            <WorkspaceUpdateViewParamsContext.Provider value={updateViewParams}>
              {children}
            </WorkspaceUpdateViewParamsContext.Provider>
          </WorkspaceViewParamsStoreContext.Provider>
        </WorkspaceWrapParamsContext.Provider>
      </WorkspaceSlotsContext.Provider>
    </WorkspaceNavigateContext.Provider>
  );
}
