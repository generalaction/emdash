import { ComponentType, createContext, useCallback, useContext, type ReactNode } from 'react';
import type { ViewId, WrapParams } from '@renderer/app/view-registry';

/**
 * NavArgs makes the params argument optional when all fields are optional,
 * and omits it entirely for views with no params (home, skills).
 */
export type NavArgs<TId extends ViewId> = keyof WrapParams<TId> extends never
  ? [viewId: TId]
  : Partial<WrapParams<TId>> extends WrapParams<TId>
    ? [viewId: TId, params?: WrapParams<TId>]
    : [viewId: TId, params: WrapParams<TId>];

/** Higher-rank navigate function — generic at the call site, not at the hook call site. */
export type NavigateFnTyped = <TId extends ViewId>(...args: NavArgs<TId>) => void;

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

export const WorkspaceNavigateContext = createContext<NavigateFnTyped | undefined>(undefined);
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

export function useNavigate(): { navigate: NavigateFnTyped } {
  const navigate = useContext(WorkspaceNavigateContext);
  if (!navigate) {
    throw new Error('useNavigate must be used within a WorkspaceViewProvider');
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

export function useParams<TId extends ViewId>(
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

export type ViewLayoutOverride = {
  hideRightPanel?: boolean;
};

export const ViewLayoutOverrideContext = createContext<ViewLayoutOverride>({});

export function useViewLayoutOverride(): ViewLayoutOverride {
  return useContext(ViewLayoutOverrideContext);
}
