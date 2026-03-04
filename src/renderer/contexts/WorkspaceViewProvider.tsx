import {
  ComponentType,
  createContext,
  Fragment,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

type ViewDefinition<TParams extends object = Record<never, never>> = {
  WrapView?: ComponentType<{ children: ReactNode } & TParams>;
  TitlebarSlot?: ComponentType;
  MainPanel: ComponentType;
  RightPanel?: ComponentType;
};

// view registry
const views = {
  settings: {
    WrapView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    TitlebarSlot: () => <div>settings titlebarSlot</div>,
    MainPanel: () => <div>settings mainPanel</div>,
    RightPanel: () => <div>settings rightPanel</div>,
  },
  skills: {
    WrapView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    TitlebarSlot: () => <div>skills titlebarSlot</div>,
    MainPanel: () => <div>skills mainPanel</div>,
    RightPanel: () => <div>skills rightPanel</div>,
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

type NavigateFn = <TId extends ViewId>(...args: NavArgs<TId>) => void;

type ViewState = {
  [K in ViewId]: { viewId: K; wrapParams: WrapParams<K> };
}[ViewId];

type SlotsContextValue = {
  WrapView: ComponentType<{ children: ReactNode } & Record<string, unknown>>;
  TitlebarSlot: ComponentType;
  MainPanel: ComponentType;
  RightPanel: ComponentType;
  currentView: ViewId;
};

type WrapParamsContextValue = {
  wrapParams: Record<string, unknown>;
};

const WorkspaceNavigateContext = createContext<NavigateFn | undefined>(undefined);
const WorkspaceSlotsContext = createContext<SlotsContextValue | undefined>(undefined);
const WorkspaceWrapParamsContext = createContext<WrapParamsContextValue | undefined>(undefined);

export function WorkspaceViewProvider({ children }: { children: ReactNode }) {
  const [viewState, setViewState] = useState<ViewState>({
    viewId: 'skills',
    wrapParams: {},
  });

  const navigate = useCallback((...args: unknown[]) => {
    const [viewId, params] = args as [ViewId, Record<string, unknown>?];
    setViewState({ viewId, wrapParams: params ?? {} } as ViewState);
  }, []) as NavigateFn;

  const slotsValue = useMemo((): SlotsContextValue => {
    const def = views[viewState.viewId];
    return {
      WrapView: (def.WrapView ?? Fragment) as ComponentType<
        { children: ReactNode } & Record<string, unknown>
      >,
      TitlebarSlot: def.TitlebarSlot,
      MainPanel: def.MainPanel,
      RightPanel: def.RightPanel,
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
    <WorkspaceNavigateContext.Provider value={navigate}>
      <WorkspaceSlotsContext.Provider value={slotsValue}>
        <WorkspaceWrapParamsContext.Provider value={wrapParamsValue}>
          {children}
        </WorkspaceWrapParamsContext.Provider>
      </WorkspaceSlotsContext.Provider>
    </WorkspaceNavigateContext.Provider>
  );
}

export function useWorkspaceSlots() {
  const context = useContext(WorkspaceSlotsContext);
  if (!context) {
    throw new Error('useWorkspaceSlots must be used within a WorkspaceSlotsContextProvider');
  }
  return context;
}

export function useWorkspaceWrapParams() {
  const context = useContext(WorkspaceWrapParamsContext);
  if (!context) {
    throw new Error(
      'useWorkspaceWrapParams must be used within a WorkspaceWrapParamsContextProvider'
    );
  }
  return context;
}

export function useWorkspaceNavigation() {
  const navigate = useContext(WorkspaceNavigateContext);
  if (!navigate)
    throw new Error('useWorkspaceNavigation must be used within a WorkspaceViewProvider');
  return { navigate };
}
