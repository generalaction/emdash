import type { LayoutStorage } from '@emdash/ui/react/primitives';
import { observer } from 'mobx-react-lite';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  asAvailableProject,
  getProjectStore,
} from '@core/features/projects/api/browser/stores/project-selectors';
import type { WorkspaceChromeStore } from '@core/features/projects/api/browser/stores/workspace-chrome-store';
import { workspaceChromeStoreToken } from '@core/features/projects/contributions/project-stores';
import { workbenchPanelLayoutsMemento } from '@core/features/workbench/contributions/mementos';
import { createLayoutStorage } from '@core/primitives/mementos/browser';
import { useSubjectSpace } from '@core/primitives/mementos/react';
import { getNavigation } from '@core/primitives/navigation/browser/navigation-selectors';
import { appSubject } from '@core/primitives/subjects/api';
import type { ViewRef } from '@core/primitives/views/api';

export interface WorkspaceLayoutContextValue {
  isLeftOpen: boolean;
  isZenActive: boolean;
  toggleLeftSidebar: () => void;
  toggleZenMode: () => void;
  /**
   * App-scoped storage facade for the workspace outer layout. The left
   * sidebar is workbench chrome, so navigation never changes its size owner.
   */
  layoutStorage: LayoutStorage;
}

const WorkspaceLayoutContext = createContext<WorkspaceLayoutContextValue | undefined>(undefined);

/** Reads `projectId` from project-bearing view refs (task, project). */
function projectIdFromRef(ref: ViewRef | undefined): string | undefined {
  const projectId = (ref?.params as { projectId?: unknown } | undefined)?.projectId;
  return typeof projectId === 'string' && projectId.length > 0 ? projectId : undefined;
}

/**
 * Workspace chrome for one project, readable only once its subject space has
 * hydrated. There is no render gate at the project boundary (the task-view
 * `isHydrated` gate covers only task subjects), so callers gate here rather
 * than reading project chrome before hydration.
 */
function hydratedWorkspaceChrome(projectId: string): WorkspaceChromeStore | undefined {
  return asAvailableProject(getProjectStore(projectId))?.get(workspaceChromeStoreToken);
}

export const WorkspaceLayoutContextProvider = observer(function WorkspaceLayoutContextProvider({
  children,
}: {
  children: ReactNode;
}) {
  // The active project is sticky: leaving for a project-less view (settings,
  // home) keeps the last project's chrome instead of resetting the sidebar.
  const [activeProjectId, setActiveProjectId] = useState<string | undefined>(() =>
    projectIdFromRef(getNavigation().currentRef)
  );
  // Ephemeral chrome for the no-project / pre-hydration window, so the
  // sidebar toggle still works on a fresh install's home view. Not a shadow
  // copy of store state — it feeds the view only while no chrome store exists.
  const [fallbackLeftOpen, setFallbackLeftOpen] = useState(true);
  // The root app SubjectProvider hydrates before rendering this provider, so
  // the layout facade is safe to read synchronously from the first paint.
  const appSpace = useSubjectSpace(appSubject);

  useEffect(() => {
    return getNavigation().onDidNavigate.subscribe((event) => {
      // The implicit exit-on-navigation cleanup became this explicit command
      // at the navigation site. Only direct navigation ('traversal' to another
      // view ref) exits zen; startup and history navigation preserve chrome state.
      if (
        event.source === 'direct' &&
        event.kind === 'traversal' &&
        event.from &&
        event.from.key !== event.to.key
      ) {
        const fromProjectId = projectIdFromRef(event.from);
        if (fromProjectId) {
          const chrome = hydratedWorkspaceChrome(fromProjectId);
          if (chrome?.state.zen.active) chrome.commands.exitZenMode();
        }
      }
      const projectId = projectIdFromRef(event.to);
      if (projectId) setActiveProjectId(projectId);
    });
  }, []);

  const context = activeProjectId
    ? asAvailableProject(getProjectStore(activeProjectId))
    : undefined;
  const chrome = context?.get(workspaceChromeStoreToken);

  const layoutStorage = useMemo(
    () => createLayoutStorage(appSpace, workbenchPanelLayoutsMemento),
    [appSpace]
  );

  const state = chrome ? chrome.state : undefined;
  const value: WorkspaceLayoutContextValue = {
    isLeftOpen: state ? state.leftSidebarOpen : fallbackLeftOpen,
    isZenActive: state?.zen.active ?? false,
    toggleLeftSidebar: () => {
      if (chrome) chrome.commands.toggleLeftSidebar();
      else setFallbackLeftOpen((open) => !open);
    },
    toggleZenMode: () => {
      if (!chrome) return;
      if (chrome.state.zen.active) chrome.commands.exitZenMode();
      else chrome.commands.enterZenMode();
    },
    layoutStorage,
  };

  return (
    <WorkspaceLayoutContext.Provider value={value}>{children}</WorkspaceLayoutContext.Provider>
  );
});

export function useWorkspaceLayoutContext() {
  const context = useContext(WorkspaceLayoutContext);
  if (!context) {
    throw new Error(
      'useWorkspaceLayoutContext must be used within a WorkspaceLayoutContextProvider'
    );
  }
  return context;
}
