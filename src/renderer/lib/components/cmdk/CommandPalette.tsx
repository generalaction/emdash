import { formatForDisplay } from '@tanstack/react-hotkeys';
import { Command } from 'cmdk';
import {
  ArrowDown,
  ArrowUp,
  CornerDownLeft,
  FolderOpen,
  FolderPlus,
  GitBranch,
  Home,
  Import,
  Keyboard,
  Moon,
  PanelLeft,
  PanelRight,
  Search,
  Settings,
} from 'lucide-react';
import React, { useCallback, useMemo, useState } from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import {
  APP_SHORTCUTS,
  getEffectiveHotkey,
  type ShortcutSettingsKey,
} from '@renderer/lib/hooks/useKeyboardShortcuts';
import { cn } from '@renderer/utils/utils';

interface CommandPaletteProps {
  onClose: () => void;
  projects?: Array<{
    id: string;
    name: string;
    path: string;
    tasks?: Array<{
      id: string;
      name: string;
      branch: string;
    }>;
  }>;
  onSelectProject?: (projectId: string) => void;
  onSelectTask?: (projectId: string, taskId: string) => void;
  onOpenSettings?: () => void;
  onOpenKeyboardShortcuts?: () => void;
  onToggleLeftSidebar?: () => void;
  onToggleRightSidebar?: () => void;
  onToggleTheme?: () => void;
  onGoHome?: () => void;
  onAddProject?: () => void;
  onImportProject?: () => void;
}

type CommandItem = {
  id: string;
  label: string;
  description?: string;
  icon: React.ReactNode;
  group: string;
  keywords?: string[];
  shortcut?: string;
  onSelect: () => void;
};

const GROUP_ORDER = ['Projects', 'Tasks', 'Actions', 'Navigation', 'View'] as const;

const CommandPalette: React.FC<CommandPaletteProps> = ({
  onClose,
  projects = [],
  onSelectProject,
  onSelectTask,
  onOpenSettings,
  onOpenKeyboardShortcuts,
  onToggleLeftSidebar,
  onToggleRightSidebar,
  onToggleTheme,
  onGoHome,
  onAddProject,
  onImportProject,
}) => {
  const [search, setSearch] = useState('');
  const { value: keyboard } = useAppSettingsKey('keyboard');

  const shortcutDisplay = useCallback(
    (key: ShortcutSettingsKey) => {
      const hotkey = getEffectiveHotkey(key, keyboard);
      return hotkey ? formatForDisplay(hotkey) : '';
    },
    [keyboard]
  );

  const runCommand = useCallback(
    (command: () => void) => {
      onClose();
      command();
    },
    [onClose]
  );

  const commands = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = [];

    if (onImportProject) {
      items.push({
        id: 'action-import-project',
        label: 'Import project…',
        description: 'Pick a folder and add it as a project',
        icon: <Import className="h-4 w-4" />,
        group: 'Actions',
        keywords: ['import', 'add', 'open', 'folder', 'project', 'pick'],
        onSelect: () => runCommand(onImportProject),
      });
    }

    if (onAddProject) {
      items.push({
        id: 'action-add-project',
        label: 'New project…',
        description: 'Clone, create, or pick a project',
        icon: <FolderPlus className="h-4 w-4" />,
        group: 'Actions',
        keywords: ['new', 'create', 'clone', 'project'],
        shortcut: shortcutDisplay('newProject'),
        onSelect: () => runCommand(onAddProject),
      });
    }

    if (onGoHome) {
      items.push({
        id: 'nav-home',
        label: 'Go home',
        description: 'Return to the home screen',
        icon: <Home className="h-4 w-4" />,
        group: 'Navigation',
        keywords: ['home', 'start', 'main'],
        onSelect: () => runCommand(onGoHome),
      });
    }

    if (onOpenSettings) {
      items.push({
        id: 'nav-settings',
        label: 'Open settings',
        description: APP_SHORTCUTS.settings.description,
        icon: <Settings className="h-4 w-4" />,
        group: 'Navigation',
        keywords: ['settings', 'preferences', 'config'],
        shortcut: shortcutDisplay('settings'),
        onSelect: () => runCommand(onOpenSettings),
      });
    }

    if (onOpenKeyboardShortcuts) {
      items.push({
        id: 'nav-keyboard-shortcuts',
        label: 'Keyboard shortcuts',
        description: 'Customize app shortcuts',
        icon: <Keyboard className="h-4 w-4" />,
        group: 'Navigation',
        keywords: ['keyboard', 'shortcuts', 'keybind', 'hotkey'],
        onSelect: () => runCommand(onOpenKeyboardShortcuts),
      });
    }

    if (onToggleLeftSidebar) {
      items.push({
        id: 'view-toggle-left',
        label: 'Toggle left sidebar',
        description: APP_SHORTCUTS.toggleLeftSidebar.description,
        icon: <PanelLeft className="h-4 w-4" />,
        group: 'View',
        keywords: ['sidebar', 'panel', 'left', 'toggle'],
        shortcut: shortcutDisplay('toggleLeftSidebar'),
        onSelect: () => runCommand(onToggleLeftSidebar),
      });
    }

    if (onToggleRightSidebar) {
      items.push({
        id: 'view-toggle-right',
        label: 'Toggle right sidebar',
        description: APP_SHORTCUTS.toggleRightSidebar.description,
        icon: <PanelRight className="h-4 w-4" />,
        group: 'View',
        keywords: ['sidebar', 'panel', 'right', 'toggle'],
        shortcut: shortcutDisplay('toggleRightSidebar'),
        onSelect: () => runCommand(onToggleRightSidebar),
      });
    }

    if (onToggleTheme) {
      items.push({
        id: 'view-toggle-theme',
        label: 'Toggle theme',
        description: APP_SHORTCUTS.toggleTheme.description,
        icon: <Moon className="h-4 w-4" />,
        group: 'View',
        keywords: ['theme', 'dark', 'light', 'mode', 'toggle'],
        shortcut: shortcutDisplay('toggleTheme'),
        onSelect: () => runCommand(onToggleTheme),
      });
    }

    projects.forEach((project) => {
      if (onSelectProject) {
        items.push({
          id: `project-${project.id}`,
          label: project.name,
          description: project.path,
          icon: <FolderOpen className="h-4 w-4" />,
          group: 'Projects',
          keywords: ['project', project.name.toLowerCase(), project.path.toLowerCase()],
          onSelect: () => runCommand(() => onSelectProject(project.id)),
        });
      }

      if (project.tasks && onSelectTask) {
        project.tasks.forEach((task) => {
          items.push({
            id: `task-${project.id}-${task.id}`,
            label: task.name,
            description: `${project.name} • ${task.branch}`,
            icon: <GitBranch className="h-4 w-4" />,
            group: 'Tasks',
            keywords: [
              'task',
              task.name.toLowerCase(),
              task.branch.toLowerCase(),
              project.name.toLowerCase(),
            ],
            onSelect: () => runCommand(() => onSelectTask(project.id, task.id)),
          });
        });
      }
    });

    return items;
  }, [
    shortcutDisplay,
    projects,
    onGoHome,
    onAddProject,
    onImportProject,
    onOpenSettings,
    onOpenKeyboardShortcuts,
    onSelectProject,
    onSelectTask,
    onToggleLeftSidebar,
    onToggleRightSidebar,
    onToggleTheme,
    runCommand,
  ]);

  const groupedCommands = useMemo(() => {
    const groups = new Map<string, CommandItem[]>();
    commands.forEach((cmd) => {
      const group = groups.get(cmd.group) || [];
      group.push(cmd);
      groups.set(cmd.group, group);
    });
    return groups;
  }, [commands]);

  return (
    <Command
      shouldFilter
      loop
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
      }}
      className={cn(
        'flex h-full w-full flex-col',
        '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1.5',
        '[&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.08em]',
        '[&_[cmdk-group-heading]]:text-foreground-tertiary-muted',
        '[&_[cmdk-group]]:px-2 [&_[cmdk-group]]:pb-1'
      )}
    >
      <div className="flex items-center gap-2.5 border-b border-border px-3.5">
        <Search className="h-3.5 w-3.5 shrink-0 text-foreground-tertiary-muted" />
        <Command.Input
          value={search}
          onValueChange={setSearch}
          placeholder="Search projects, tasks, commands…"
          className="flex h-11 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-foreground-tertiary-muted disabled:cursor-not-allowed disabled:opacity-50"
          autoFocus
        />
      </div>

      <Command.List className="max-h-[55vh] min-h-[120px] overflow-x-hidden overflow-y-auto py-1">
        <Command.Empty className="py-10 text-center text-sm text-foreground-tertiary-muted">
          No results found.
        </Command.Empty>

        {GROUP_ORDER.map((groupName) => {
          const groupItems = groupedCommands.get(groupName);
          if (!groupItems || groupItems.length === 0) return null;

          return (
            <Command.Group key={groupName} heading={groupName}>
              {groupItems.map((item) => (
                <Command.Item
                  key={item.id}
                  value={`${item.label} ${item.description || ''} ${item.keywords?.join(' ') || ''}`}
                  onSelect={() => item.onSelect()}
                  className={cn(
                    'relative flex w-full cursor-pointer select-none items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none transition-colors',
                    'font-normal text-foreground-tertiary-muted',
                    'hover:bg-background-tertiary-1 hover:text-foreground-tertiary',
                    'data-[selected=true]:bg-background-tertiary-2 data-[selected=true]:text-foreground-tertiary'
                  )}
                >
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center [&_svg]:h-3.5 [&_svg]:w-3.5">
                    {item.icon}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.description && (
                    <span className="hidden min-w-0 truncate text-xs text-foreground-tertiary-muted sm:block sm:max-w-[45%]">
                      {item.description}
                    </span>
                  )}
                  {item.shortcut && (
                    <kbd className="ml-1 rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-foreground-tertiary-muted">
                      {item.shortcut}
                    </kbd>
                  )}
                </Command.Item>
              ))}
            </Command.Group>
          );
        })}
      </Command.List>

      <div className="flex items-center justify-between gap-4 border-t border-border px-3 py-2 text-[11px] text-foreground-tertiary-muted">
        <div className="flex items-center gap-3">
          <Hint label="Open">
            <CornerDownLeft className="h-3 w-3" />
          </Hint>
          <Hint label="Navigate">
            <ArrowUp className="h-3 w-3" />
            <ArrowDown className="h-3 w-3" />
          </Hint>
        </div>
        <Hint label="Close">
          <span className="font-mono text-[10px]">ESC</span>
        </Hint>
      </div>
    </Command>
  );
};

function Hint({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span>{label}</span>
      <div className="flex items-center gap-1 rounded-md border border-border bg-background px-1.5 py-0.5">
        {children}
      </div>
    </div>
  );
}

export default CommandPalette;
