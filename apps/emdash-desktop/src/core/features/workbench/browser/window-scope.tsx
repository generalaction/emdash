import { useEffect, useLayoutEffect, type ReactNode } from 'react';
import { libraryViewDef } from '@core/features/library/contributions/views';
import { projectViewDef } from '@core/features/projects/contributions/views';
import { getRegisteredTaskData } from '@core/features/tasks/api/browser/task-state/task-selectors';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import { getTaskComposition } from '@core/features/workbench/api/browser/task-composition-selectors';
import { openModal } from '@core/manifests/browser/modal-api';
import { windowScope } from '@core/manifests/browser/scope-catalog';
import { viewCatalog } from '@core/manifests/browser/view-catalog';
import { confirmRegistry } from '@core/primitives/keybindings/browser';
import { applyHistoryEntry } from '@core/primitives/ui/browser/components/nav-buttons';
import { openInCommandRegistry } from '@core/primitives/ui/browser/components/titlebar/open-in-command-registry';
import { toast } from '@core/primitives/ui/browser/use-toast';
import { disabled, enabled, hidden, type ViewScopeImpl } from '@core/primitives/view-scopes/api';
import { scopes } from '@core/primitives/view-scopes/browser';
import { useViewScope, ViewScopeInstanceProvider } from '@core/primitives/view-scopes/react';
import { useWorkspaceLayoutContext } from '@renderer/lib/layout/layout-provider';
import { useViewParams, useWorkspaceSlots } from '@renderer/lib/layout/navigation-provider';
import { toggleSettingsView } from '@renderer/lib/layout/settings-toggle';
import { appState } from '@renderer/lib/stores/app-state';
import { toggleAppTheme } from '@renderer/lib/theme/theme-toggle';

export function WindowScope({ children }: { readonly children: ReactNode }) {
  const { currentView } = useWorkspaceSlots();
  const taskParams = useViewParams(taskViewDef);
  const projectParams = useViewParams(projectViewDef);
  const { exitZenMode, toggleLeft, toggleZenMode } = useWorkspaceLayoutContext();

  const currentProjectId =
    currentView === 'task'
      ? taskParams?.projectId
      : currentView === 'project'
        ? projectParams?.projectId
        : undefined;
  const currentTaskId = currentView === 'task' ? taskParams?.taskId : undefined;

  const implementation = {
    'app.settings': () => ({
      execute: () => toggleSettingsView(),
    }),
    'app.library': () => ({
      execute: () => {
        if (viewCatalog.byId(appState.navigation.currentViewId)?.traits.has('library')) {
          appState.navigation.exitLibrary();
        } else {
          appState.navigation.navigate(libraryViewDef());
        }
      },
    }),
    'app.newProject': () => ({
      execute: () => {
        void openModal('addProjectModal', { strategy: 'local', mode: 'pick' });
      },
    }),
    'app.newTask': () => ({
      availability: () => (currentProjectId ? enabled : hidden),
      execute: (input) => {
        const projectId = input?.projectId ?? currentProjectId;
        if (projectId) void openModal('taskModal', { projectId });
      },
    }),
    'app.giveFeedback': () => ({
      execute: () => {
        void openModal('feedbackModal', {});
      },
    }),
    'app.toggleTheme': () => ({
      execute: () => {
        void toggleAppTheme().then((result) => {
          if (result.success) return;
          toast({
            title: 'Theme not changed',
            description: result.error.message,
            variant: 'destructive',
          });
        });
      },
    }),
    'app.navigateBack': () => ({
      availability: () => (appState.history.canGoBack ? enabled : disabled('No previous location')),
      execute: () => appState.history.back(applyHistoryEntry),
    }),
    'app.navigateForward': () => ({
      availability: () => (appState.history.canGoForward ? enabled : disabled('No next location')),
      execute: () => appState.history.forward(applyHistoryEntry),
    }),
    'app.commandPalette': () => ({
      execute: () => {
        const workspaceId =
          currentProjectId && currentTaskId
            ? (getRegisteredTaskData(currentProjectId, currentTaskId)?.workspaceId ?? undefined)
            : undefined;
        void openModal('commandPaletteModal', {
          projectId: currentProjectId,
          taskId: currentTaskId,
          workspaceId,
        });
      },
    }),
    'app.openInEditor': () => ({
      availability: () => (openInCommandRegistry.get() ? enabled : hidden),
      execute: () => openInCommandRegistry.get()?.trigger(),
    }),
    'app.confirm': () => ({
      availability: () => (confirmRegistry.current?.isEnabled() ? enabled : hidden),
      execute: () => confirmRegistry.current?.trigger(),
    }),
    'workbench.toggleLeftSidebar': () => ({
      execute: () => toggleLeft(),
    }),
    'workbench.zenMode': () => ({
      execute: () => {
        const taskView =
          currentProjectId && currentTaskId
            ? getTaskComposition(currentProjectId, currentTaskId)
            : undefined;
        toggleZenMode(
          taskView
            ? {
                isCollapsed: taskView.isSidebarCollapsed,
                setCollapsed: (collapsed) => taskView.setSidebarCollapsed(collapsed),
              }
            : undefined
        );
      },
    }),
  } satisfies ViewScopeImpl<typeof windowScope>;

  const { instance } = useViewScope(windowScope(), implementation);

  useLayoutEffect(() => {
    if (instance) scopes.activate(instance);
  }, [instance]);

  useEffect(() => () => exitZenMode(), [currentProjectId, currentTaskId, currentView, exitZenMode]);

  if (!instance) return null;
  return <ViewScopeInstanceProvider instance={instance}>{children}</ViewScopeInstanceProvider>;
}
