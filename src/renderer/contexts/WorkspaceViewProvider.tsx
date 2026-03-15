import {
  ComponentType,
  Fragment,
  useCallback,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from 'react';
import { useModalContext } from './ModalProvider';
import {
  views,
  type ViewDefinition,
  type ViewId,
  type WrapParams,
} from './workspace-views-registry';
import {
  WorkspaceNavigateContext,
  WorkspaceSlotsContext,
  WorkspaceUpdateViewParamsContext,
  WorkspaceViewParamsStoreContext,
  WorkspaceWrapParamsContext,
  type NavigateFn,
  type SlotsContextValue,
  type UpdateViewParamsFn,
  type WrapParamsContextValue,
} from './WorkspaceNavigationContext';

/**
 * NavArgs makes the params argument optional when all fields are optional,
 * and omits it entirely for views with no params (home, skills).
 */
type NavArgs<TId extends ViewId> = keyof WrapParams<TId> extends never
  ? [viewId: TId]
  : Partial<WrapParams<TId>> extends WrapParams<TId>
    ? [viewId: TId, params?: WrapParams<TId>]
    : [viewId: TId, params: WrapParams<TId>];

export type NavigateFnTyped = <TId extends ViewId>(...args: NavArgs<TId>) => void;

type ViewParamsStore = Partial<{ [K in ViewId]: WrapParams<K> }>;

export function WorkspaceViewProvider({ children }: { children: ReactNode }) {
  const { closeModal } = useModalContext();
  const [currentViewId, setCurrentViewId] = useState<ViewId>('home');
  const [viewParamsStore, setViewParamsStore] = useState<ViewParamsStore>({});
  const [_, startTransition] = useTransition();

  const navigate = useCallback(
    (...args: unknown[]) => {
      const [viewId, params] = args as [ViewId, Record<string, unknown>?];
      startTransition(() => {
        setCurrentViewId(viewId);
        setViewParamsStore((prev) => ({ ...prev, [viewId]: params ?? {} }));
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
    <WorkspaceNavigateContext.Provider value={navigate as unknown as NavigateFn}>
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
