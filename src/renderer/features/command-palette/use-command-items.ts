import { formatForDisplay } from '@tanstack/react-hotkeys';
import {
  CogIcon,
  FilePlusIcon,
  FolderIcon,
  FolderPlusIcon,
  HomeIcon,
  ListChecksIcon,
  MoonIcon,
  PanelLeftIcon,
  PanelRightIcon,
  PlugIcon,
  WrenchIcon,
  type LucideIcon,
} from 'lucide-react';
import { getProjectManagerStore } from '@renderer/features/projects/stores/project-selectors';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import {
  getEffectiveHotkey,
  type ShortcutSettingsKey,
} from '@renderer/lib/hooks/useKeyboardShortcuts';

export type CommandGroup = 'Navigation' | 'Actions' | 'Tasks' | 'Projects';

export type CommandItemDef = {
  id: string;
  label: string;
  /** Hidden text appended to label for cmdk fuzzy matching. */
  keywords?: string[];
  icon?: LucideIcon;
  shortcut?: string;
  group: CommandGroup;
  perform: () => void;
};

export type CommandPaletteContext = {
  navigate: {
    home: () => void;
    settings: () => void;
    skills: () => void;
    mcp: () => void;
    project: (projectId: string) => void;
    task: (projectId: string, taskId: string) => void;
  };
  showAddProject: () => void;
  showCreateTask: (projectId: string) => void;
  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
  toggleTheme: () => void;
  currentProjectId?: string;
  currentTaskId?: string;
};

function shortcutDisplay(
  key: ShortcutSettingsKey,
  overrides?: Partial<Record<ShortcutSettingsKey, string | null>>
): string | undefined {
  const hk = getEffectiveHotkey(key, overrides);
  if (!hk) return undefined;
  return formatForDisplay(hk);
}

/**
 * Builds the full command list. Must be called from an `observer` component so
 * MobX project/task store reads (names, task map) stay reactive — the list is
 * intentionally rebuilt every render so renames propagate without a remount.
 */
export function useCommandItems(ctx: CommandPaletteContext): CommandItemDef[] {
  const { value: keyboard } = useAppSettingsKey('keyboard');

  const items: CommandItemDef[] = [];

  // ---------- Navigation ----------
  items.push(
    {
      id: 'nav:home',
      label: 'Go to Home',
      keywords: ['home', 'dashboard'],
      icon: HomeIcon,
      group: 'Navigation',
      perform: ctx.navigate.home,
    },
    {
      id: 'nav:settings',
      label: 'Open Settings',
      keywords: ['settings', 'preferences'],
      icon: CogIcon,
      shortcut: shortcutDisplay('settings', keyboard),
      group: 'Navigation',
      perform: ctx.navigate.settings,
    },
    {
      id: 'nav:skills',
      label: 'Open Skills',
      keywords: ['skills'],
      icon: WrenchIcon,
      group: 'Navigation',
      perform: ctx.navigate.skills,
    },
    {
      id: 'nav:mcp',
      label: 'Open MCP Servers',
      keywords: ['mcp', 'servers', 'integration'],
      icon: PlugIcon,
      group: 'Navigation',
      perform: ctx.navigate.mcp,
    }
  );

  // ---------- Actions ----------
  items.push(
    {
      id: 'action:new-project',
      label: 'New Project',
      icon: FolderPlusIcon,
      shortcut: shortcutDisplay('newProject', keyboard),
      group: 'Actions',
      perform: ctx.showAddProject,
    },
    {
      id: 'action:toggle-left-sidebar',
      label: 'Toggle Left Sidebar',
      icon: PanelLeftIcon,
      shortcut: shortcutDisplay('toggleLeftSidebar', keyboard),
      group: 'Actions',
      perform: ctx.toggleLeftSidebar,
    },
    {
      id: 'action:toggle-right-sidebar',
      label: 'Toggle Right Sidebar',
      icon: PanelRightIcon,
      shortcut: shortcutDisplay('toggleRightSidebar', keyboard),
      group: 'Actions',
      perform: ctx.toggleRightSidebar,
    },
    {
      id: 'action:toggle-theme',
      label: 'Toggle Theme',
      keywords: ['dark', 'light', 'mode'],
      icon: MoonIcon,
      shortcut: shortcutDisplay('toggleTheme', keyboard),
      group: 'Actions',
      perform: ctx.toggleTheme,
    }
  );

  if (ctx.currentProjectId) {
    const projectId = ctx.currentProjectId;
    items.push({
      id: 'action:new-task',
      label: 'New Task',
      icon: FilePlusIcon,
      shortcut: shortcutDisplay('newTask', keyboard),
      group: 'Actions',
      perform: () => ctx.showCreateTask(projectId),
    });
  }

  // ---------- Tasks (in current project) ----------
  if (ctx.currentProjectId) {
    const projectId = ctx.currentProjectId;
    const projectStore = getProjectManagerStore().projects.get(projectId);
    const taskMap = projectStore?.mountedProject?.taskManager.tasks;
    if (taskMap) {
      for (const [, taskStore] of taskMap) {
        const taskId = taskStore.data.id;
        if (!taskId) continue;
        if (taskId === ctx.currentTaskId) continue;
        const name = taskStore.data.name ?? 'Untitled task';
        items.push({
          id: `task:${taskId}`,
          label: name,
          keywords: ['task', 'switch'],
          icon: ListChecksIcon,
          group: 'Tasks',
          perform: () => ctx.navigate.task(projectId, taskId),
        });
      }
    }
  }

  // ---------- Projects ----------
  const projectMap = getProjectManagerStore().projects;
  for (const [, projectStore] of projectMap) {
    const projectId = projectStore.id;
    if (!projectId) continue;
    if (projectId === ctx.currentProjectId) continue;
    const name = projectStore.name ?? 'Untitled project';
    items.push({
      id: `project:${projectId}`,
      label: name,
      keywords: ['project', 'switch'],
      icon: FolderIcon,
      group: 'Projects',
      perform: () => ctx.navigate.project(projectId),
    });
  }

  return items;
}
