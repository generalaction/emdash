export const TITLEBAR_HEIGHT = '36px';
export const PANEL_LAYOUT_STORAGE_KEY = 'emdash.layout.left-main-right.v2';
export const DEFAULT_PANEL_LAYOUT: [number, number, number] = [20, 60, 20];
export const LEFT_SIDEBAR_MIN_SIZE = 16;
export const LEFT_SIDEBAR_MAX_SIZE = 30;
export const FIRST_LAUNCH_KEY = 'emdash:first-launch:v1';
export const RIGHT_SIDEBAR_MIN_SIZE = 16;
export const RIGHT_SIDEBAR_MAX_SIZE = 50;
export const ACTIVE_PROJECT_KEY = 'emdash:activeProjectId';
export const ACTIVE_TASK_KEY = 'emdash:activeTaskId';
export const MAIN_PANEL_MIN_SIZE = 30;
export const RIGHT_SIDEBAR_VERTICAL_STORAGE_KEY = 'emdash.layout.right-sidebar-vertical';
export const DEFAULT_RIGHT_SIDEBAR_VERTICAL_LAYOUT: [number, number] = [50, 50];

export const getStoredActiveIds = (): { projectId: string | null; taskId: string | null } => {
  try {
    return {
      projectId: localStorage.getItem(ACTIVE_PROJECT_KEY),
      taskId: localStorage.getItem(ACTIVE_TASK_KEY),
    };
  } catch {
    return { projectId: null, taskId: null };
  }
};

export const saveActiveIds = (projectId: string | null, taskId: string | null): void => {
  try {
    if (projectId) {
      localStorage.setItem(ACTIVE_PROJECT_KEY, projectId);
    } else {
      localStorage.removeItem(ACTIVE_PROJECT_KEY);
    }
    if (taskId) {
      localStorage.setItem(ACTIVE_TASK_KEY, taskId);
    } else {
      localStorage.removeItem(ACTIVE_TASK_KEY);
    }
  } catch {}
};

export const clampLeftSidebarSize = (value: number) =>
  Math.min(
    Math.max(Number.isFinite(value) ? value : DEFAULT_PANEL_LAYOUT[0], LEFT_SIDEBAR_MIN_SIZE),
    LEFT_SIDEBAR_MAX_SIZE
  );

export const clampRightSidebarSize = (value: number) =>
  Math.min(
    Math.max(Number.isFinite(value) ? value : DEFAULT_PANEL_LAYOUT[2], RIGHT_SIDEBAR_MIN_SIZE),
    RIGHT_SIDEBAR_MAX_SIZE
  );
