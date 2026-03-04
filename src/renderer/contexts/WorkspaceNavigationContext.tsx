import { ComponentType, createContext, useContext, type ReactNode } from 'react';

export type NavigateFn = (viewId: string, params?: Record<string, unknown>) => void;

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

export const WorkspaceNavigateContext = createContext<NavigateFn | undefined>(undefined);
export const WorkspaceSlotsContext = createContext<SlotsContextValue | undefined>(undefined);
export const WorkspaceWrapParamsContext = createContext<WrapParamsContextValue | undefined>(
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

export function isCurrentView(currentView: string | null | undefined, target: string): boolean {
  return currentView === target;
}
