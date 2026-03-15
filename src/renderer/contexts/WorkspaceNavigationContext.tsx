import { ComponentType, createContext, useCallback, useContext, type ReactNode } from 'react';
import type { ViewId, WrapParams } from './workspace-views-registry';

export type NavigateFn = (viewId: string, params?: Record<string, unknown>) => void;

export type UpdateViewParamsFn = <TId extends ViewId>(
  viewId: TId,
  update: Partial<WrapParams<TId>> | ((prev: WrapParams<TId>) => WrapParams<TId>)
) => void;

export type SlotsContextValue = {
  WrapView: ComponentType<{ children: ReactNode } & Record<string, unknown>>;
  TitlebarSlot: ComponentType;
  MainPanel: ComponentType;
  RightPanel: ComponentType | null;
  currentView: string;
};

export type WrapParamsContextValue = {
  wrapParams: Record<string, unknown>;
};

export type ViewParamsStoreContextValue = {
  viewParamsStore: Partial<{ [K in ViewId]: WrapParams<K> }>;
};

export const WorkspaceNavigateContext = createContext<NavigateFn | undefined>(undefined);
export const WorkspaceSlotsContext = createContext<SlotsContextValue | undefined>(undefined);
export const WorkspaceWrapParamsContext = createContext<WrapParamsContextValue | undefined>(
  undefined
);
export const WorkspaceViewParamsStoreContext = createContext<
  ViewParamsStoreContextValue | undefined
>(undefined);
export const WorkspaceUpdateViewParamsContext = createContext<UpdateViewParamsFn | undefined>(
  undefined
);

export function useWorkspaceNavigation(): { navigate: NavigateFn } {
  const navigate = useContext(WorkspaceNavigateContext);
  if (!navigate) {
    throw new Error('useWorkspaceNavigation must be used within a WorkspaceViewProvider');
  }
  return { navigate };
}

export function useWorkspaceSlots(): SlotsContextValue {
  const context = useContext(WorkspaceSlotsContext);
  if (!context) {
    throw new Error('useWorkspaceSlots must be used within a WorkspaceViewProvider');
  }
  return context;
}

export function useWorkspaceWrapParams(): WrapParamsContextValue {
  const context = useContext(WorkspaceWrapParamsContext);
  if (!context) {
    throw new Error('useWorkspaceWrapParams must be used within a WorkspaceViewProvider');
  }
  return context;
}

export function useViewParams<TId extends ViewId>(
  viewId: TId
): {
  params: WrapParams<TId>;
  setParams: (
    update: Partial<WrapParams<TId>> | ((prev: WrapParams<TId>) => WrapParams<TId>)
  ) => void;
} {
  const storeCtx = useContext(WorkspaceViewParamsStoreContext);
  const updateFn = useContext(WorkspaceUpdateViewParamsContext);
  if (!storeCtx || !updateFn) {
    throw new Error('useViewParams must be used within a WorkspaceViewProvider');
  }
  const params = (storeCtx.viewParamsStore[viewId] ?? {}) as WrapParams<TId>;
  const setParams = useCallback(
    (update: Partial<WrapParams<TId>> | ((prev: WrapParams<TId>) => WrapParams<TId>)) => {
      updateFn(viewId, update);
    },
    // viewId is a stable string literal
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [updateFn, viewId]
  );
  return { params, setParams };
}

export function isCurrentView(currentView: string | null | undefined, target: string): boolean {
  return currentView === target;
}
