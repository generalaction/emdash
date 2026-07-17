import { useObserver } from 'mobx-react-lite';
import { Fragment, useCallback, type ComponentType, type ReactNode } from 'react';
import type { viewCatalog, ViewId } from '@core/manifests/view-catalog';
import type { ViewParams, ViewRef } from '@core/primitives/views/api';
import { getViewRuntime } from '@core/primitives/views/react';
import { appState } from '@renderer/lib/stores/app-state';

export type NavigateFnTyped = (ref: ViewRef) => void;

export type SlotsContextValue = {
  WrapView: ComponentType<{ children: ReactNode } & Record<string, unknown>>;
  TitlebarSlot: ComponentType;
  MainPanel: ComponentType;
  currentView: ViewId;
};

export type WorkspaceViewParamsValue = {
  params: Record<string, unknown>;
};

type ViewDefinition = (typeof viewCatalog.defs)[number];

const EmptyTitlebar = () => null;

export function useNavigate(): { navigate: NavigateFnTyped } {
  const navigate = useCallback((ref: ViewRef) => {
    appState.navigation.navigate(ref);
  }, []);
  return { navigate };
}

export function useWorkspaceSlots(): SlotsContextValue {
  return useObserver(() => {
    const viewId = appState.navigation.currentViewId;
    const contribution = getViewRuntime(viewId) ?? getViewRuntime('home');
    if (!contribution) throw new Error('Home view runtime is not registered');
    const slots = contribution.runtime.slots as unknown as {
      wrap?: ComponentType<{ children: ReactNode } & Record<string, unknown>>;
      titlebar?: ComponentType;
      main: ComponentType;
    };
    return {
      WrapView: slots.wrap ?? Fragment,
      TitlebarSlot: slots.titlebar ?? EmptyTitlebar,
      MainPanel: slots.main,
      currentView: contribution.def.id as ViewId,
    };
  });
}

export function useWorkspaceViewParams(): WorkspaceViewParamsValue {
  return useObserver(() => ({
    params: appState.navigation.currentRef.params,
  }));
}

export function useViewParams<TDef extends ViewDefinition>(
  definition: TDef
): ViewParams<TDef> | undefined {
  return useObserver(() => {
    const current = appState.navigation.currentRef;
    const ref =
      current.viewId === definition.id ? current : appState.navigation.lastRefFor(definition);
    return ref?.params as ViewParams<TDef> | undefined;
  });
}

/**
 * Returns current params while the view is active and its last recorded params
 * during an unmount transition. `setParams` is a no-op when the view is not current.
 */
export function useCurrentViewParams<TDef extends ViewDefinition>(
  definition: TDef
): {
  params: ViewParams<TDef>;
  setParams: (
    update: Partial<ViewParams<TDef>> | ((previous: ViewParams<TDef>) => ViewParams<TDef>)
  ) => void;
} {
  const setParams = useCallback(
    (update: Partial<ViewParams<TDef>> | ((previous: ViewParams<TDef>) => ViewParams<TDef>)) => {
      const current = appState.navigation.currentRef;
      if (current.viewId !== definition.id) return;
      const previous = current.params as ViewParams<TDef>;
      const next = typeof update === 'function' ? update(previous) : { ...previous, ...update };
      const ref = definition.safeRef(next);
      if (ref) appState.navigation.navigate(ref);
    },
    [definition]
  );

  return useObserver(() => {
    const current = appState.navigation.currentRef;
    const ref =
      current.viewId === definition.id ? current : appState.navigation.lastRefFor(definition);
    if (!ref) throw new Error(`No params have been recorded for view '${definition.id}'`);
    return {
      params: ref.params as ViewParams<TDef>,
      setParams,
    };
  });
}

export function isCurrentView(currentView: string | null | undefined, target: string): boolean {
  return currentView === target;
}
