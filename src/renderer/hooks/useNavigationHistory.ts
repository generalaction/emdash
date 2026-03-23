import { useState, useCallback, useRef, useEffect } from 'react';
import { useProjectManagementContext } from '../contexts/ProjectManagementProvider';
import { useTaskManagementContext } from '../contexts/TaskManagementContext';
import type { Task } from '../types/app';

type ViewKind = 'home' | 'project' | 'task' | 'skills' | 'mcp';

interface NavigationState {
  projectId: string | null;
  taskId: string | null;
  view: ViewKind;
}

const MAX_HISTORY = 50;

/** Compare two navigation states for equality by projectId, taskId, and view kind. */
function statesEqual(a: NavigationState, b: NavigationState): boolean {
  return a.projectId === b.projectId && a.taskId === b.taskId && a.view === b.view;
}

/**
 * Tracks a browser-style navigation history stack across views (home, project, task,
 * skills, MCP). Provides goBack/goForward and listens for mouse buttons, keyboard
 * shortcuts, and IPC events from the main process (trackpad swipe, app-command).
 */
export function useNavigationHistory(taskLookup?: (taskId: string) => Task | undefined) {
  const {
    selectedProject,
    showHomeView,
    showSkillsView,
    showMcpView,
    activateProjectView,
    handleGoHome,
    handleGoToSkills,
    handleGoToMcp,
    projects,
  } = useProjectManagementContext();

  const { activeTask, handleSelectTask } = useTaskManagementContext();

  // Use refs for history data to avoid batching issues with nested setState
  const historyRef = useRef<NavigationState[]>([]);
  const indexRef = useRef(-1);

  // Derived state for canGoBack/canGoForward (updated via tick)
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);

  /** Sync the canGoBack/canGoForward state flags from the current ref values. */
  const syncCanFlags = useCallback(() => {
    setCanGoBack(indexRef.current > 0);
    setCanGoForward(indexRef.current < historyRef.current.length - 1);
  }, []);

  // Flag to suppress recording when we're navigating via back/forward
  const isRestoringRef = useRef(false);

  // Keep task lookup in a ref so callbacks always see the latest version
  const taskLookupRef = useRef(taskLookup);
  useEffect(() => {
    taskLookupRef.current = taskLookup;
  }, [taskLookup]);

  /** Derive the current navigation state from the active project/task/view flags. */
  const deriveState = useCallback((): NavigationState => {
    if (showHomeView) return { projectId: null, taskId: null, view: 'home' };
    if (showSkillsView) return { projectId: null, taskId: null, view: 'skills' };
    if (showMcpView) return { projectId: null, taskId: null, view: 'mcp' };
    if (activeTask) {
      return {
        projectId: activeTask.projectId ?? selectedProject?.id ?? null,
        taskId: activeTask.id,
        view: 'task',
      };
    }
    if (selectedProject) {
      return { projectId: selectedProject.id, taskId: null, view: 'project' };
    }
    return { projectId: null, taskId: null, view: 'home' };
  }, [showHomeView, showSkillsView, showMcpView, activeTask, selectedProject]);

  // Record state changes into history
  useEffect(() => {
    if (isRestoringRef.current) {
      isRestoringRef.current = false;
      return;
    }

    const state = deriveState();
    const history = historyRef.current;
    const idx = indexRef.current;

    // If identical to current entry, skip
    if (idx >= 0 && idx < history.length && statesEqual(history[idx], state)) {
      return;
    }

    // Truncate forward history and append
    const truncated = history.slice(0, idx + 1);
    truncated.push(state);

    // Trim to max length
    if (truncated.length > MAX_HISTORY) {
      const overflow = truncated.length - MAX_HISTORY;
      truncated.splice(0, overflow);
    }

    historyRef.current = truncated;
    indexRef.current = truncated.length - 1;
    syncCanFlags();
  }, [deriveState, syncCanFlags]);

  /** Restore the app to a given navigation state (navigate to the correct view/project/task). */
  const restoreState = useCallback(
    (state: NavigationState) => {
      isRestoringRef.current = true;

      switch (state.view) {
        case 'home':
          handleGoHome();
          break;
        case 'skills':
          handleGoToSkills();
          break;
        case 'mcp':
          handleGoToMcp();
          break;
        case 'project': {
          const project = projects.find((p) => p.id === state.projectId);
          if (project) {
            activateProjectView(project);
          } else {
            handleGoHome();
          }
          break;
        }
        case 'task': {
          const project = projects.find((p) => p.id === state.projectId);
          if (project) {
            if (state.taskId && taskLookupRef.current) {
              const task = taskLookupRef.current(state.taskId);
              if (task) {
                handleSelectTask(task);
              } else {
                // Task no longer exists, navigate to project instead
                activateProjectView(project);
              }
            } else {
              activateProjectView(project);
            }
          } else {
            handleGoHome();
          }
          break;
        }
      }
    },
    [handleGoHome, handleGoToSkills, handleGoToMcp, activateProjectView, projects, handleSelectTask]
  );

  /** Navigate to the previous entry in the history stack. */
  const goBack = useCallback(() => {
    if (indexRef.current <= 0) return;
    const newIndex = indexRef.current - 1;
    indexRef.current = newIndex;
    syncCanFlags();
    restoreState(historyRef.current[newIndex]);
    // Safety net: if restoreState resolved to the current view (no state change),
    // the recording effect won't fire to clear isRestoringRef. Clear it here so
    // future navigations are still recorded. The statesEqual guard in the effect
    // prevents duplicate entries if the effect does fire.
    queueMicrotask(() => {
      isRestoringRef.current = false;
    });
  }, [restoreState, syncCanFlags]);

  /** Navigate to the next entry in the history stack. */
  const goForward = useCallback(() => {
    if (indexRef.current >= historyRef.current.length - 1) return;
    const newIndex = indexRef.current + 1;
    indexRef.current = newIndex;
    syncCanFlags();
    restoreState(historyRef.current[newIndex]);
    queueMicrotask(() => {
      isRestoringRef.current = false;
    });
  }, [restoreState, syncCanFlags]);

  // Mouse back/forward buttons (buttons 3 and 4 on mice with extra buttons)
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault();
        goBack();
      } else if (e.button === 4) {
        e.preventDefault();
        goForward();
      }
    };
    window.addEventListener('mousedown', handleMouseDown);
    return () => window.removeEventListener('mousedown', handleMouseDown);
  }, [goBack, goForward]);

  // macOS trackpad swipe and Windows/Linux app-command (forwarded from main process)
  useEffect(() => {
    const cleanupBack = window.electronAPI.onNavigateBack(() => goBack());
    const cleanupForward = window.electronAPI.onNavigateForward(() => goForward());
    return () => {
      cleanupBack();
      cleanupForward();
    };
  }, [goBack, goForward]);

  return {
    canGoBack,
    canGoForward,
    goBack,
    goForward,
  };
}
