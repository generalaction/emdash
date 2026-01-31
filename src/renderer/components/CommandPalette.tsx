import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Command } from 'cmdk';
import {
  Search,
  FolderOpen,
  Home,
  Settings,
  PanelLeft,
  PanelRight,
  GitBranch,
  CornerDownLeft,
  ArrowUp,
  ArrowDown,
  Command as CommandIcon,
  Option,
  Palette,
  ArrowRightLeft,
} from 'lucide-react';
import { APP_SHORTCUTS } from '../hooks/useKeyboardShortcuts';
import type { ShortcutModifier } from '../types/shortcuts';

interface CommandPaletteProps {
  isOpen: boolean;
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
  onToggleLeftSidebar?: () => void;
  onToggleRightSidebar?: () => void;
  onToggleTheme?: () => void;
  onGoHome?: () => void;
  onOpenProject?: () => void;
  onNextAgent?: () => void;
  onPrevAgent?: () => void;
}

type CommandItem = {
  id: string;
  label: string;
  description?: string;
  icon: React.ReactNode;
  group: string;
  keywords?: string[];
  shortcut?: {
    key: string;
    modifier?: ShortcutModifier;
  };
  onSelect: () => void;
};

const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  projects = [],
  onSelectProject,
  onSelectTask,
  onOpenSettings,
  onToggleLeftSidebar,
  onToggleRightSidebar,
  onToggleTheme,
  onGoHome,
  onOpenProject,
  onNextAgent,
  onPrevAgent,
}) => {
  const [search, setSearch] = useState('');
  const shouldReduceMotion = useReducedMotion();

  const handleClose = useCallback(() => {
    setSearch(''); // Reset search on close
    onClose();
  }, [onClose]);

  // Window-level capture handler to intercept Escape before xterm processes it
  useEffect(() => {
    if (!isOpen) return;

    const handleEscapeCapture = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        handleClose();
      }
    };

    // Use capture phase at window level to intercept before xterm
    window.addEventListener('keydown', handleEscapeCapture, true);
    return () => window.removeEventListener('keydown', handleEscapeCapture, true);
  }, [isOpen, handleClose]);

  const runCommand = useCallback(
    (command: () => void) => {
      handleClose();
      setTimeout(() => command(), 50);
    },
    [handleClose]
  );

  // Build command items
  const commands = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = [];

    // Navigation commands
    if (onGoHome) {
      items.push({
        id: 'nav-home',
        label: 'Go Home',
        description: 'Return to home screen',
        icon: <Home className="h-4 w-4" />,
        group: 'Navigation',
        keywords: ['home', 'start', 'main'],
        onSelect: () => runCommand(onGoHome),
      });
    }

    if (onOpenProject) {
      items.push({
        id: 'nav-open-project',
        label: 'Open Project',
        description: 'Open a new project folder',
        icon: <FolderOpen className="h-4 w-4" />,
        group: 'Navigation',
        keywords: ['open', 'folder', 'project', 'new'],
        onSelect: () => runCommand(onOpenProject),
      });
    }

    // Settings command
    if (onOpenSettings) {
      items.push({
        id: 'nav-settings',
        label: 'Open Settings',
        description: APP_SHORTCUTS.SETTINGS.description,
        icon: <Settings className="h-4 w-4" />,
        group: 'Navigation',
        keywords: ['settings', 'preferences', 'config'],
        shortcut: { key: APP_SHORTCUTS.SETTINGS.key, modifier: APP_SHORTCUTS.SETTINGS.modifier },
        onSelect: () => runCommand(onOpenSettings),
      });
    }

    // Toggle commands
    if (onToggleLeftSidebar) {
      items.push({
        id: 'toggle-left',
        label: 'Toggle Left Sidebar',
        description: APP_SHORTCUTS.TOGGLE_LEFT_SIDEBAR.description,
        icon: <PanelLeft className="h-4 w-4" />,
        group: 'Toggles',
        keywords: ['sidebar', 'panel', 'left', 'toggle'],
        shortcut: {
          key: APP_SHORTCUTS.TOGGLE_LEFT_SIDEBAR.key.toUpperCase(),
          modifier: APP_SHORTCUTS.TOGGLE_LEFT_SIDEBAR.modifier,
        },
        onSelect: () => runCommand(onToggleLeftSidebar),
      });
    }

    if (onToggleRightSidebar) {
      items.push({
        id: 'toggle-right',
        label: 'Toggle Right Sidebar',
        description: APP_SHORTCUTS.TOGGLE_RIGHT_SIDEBAR.description,
        icon: <PanelRight className="h-4 w-4" />,
        group: 'Toggles',
        keywords: ['sidebar', 'panel', 'right', 'toggle'],
        shortcut: {
          key: APP_SHORTCUTS.TOGGLE_RIGHT_SIDEBAR.key,
          modifier: APP_SHORTCUTS.TOGGLE_RIGHT_SIDEBAR.modifier,
        },
        onSelect: () => runCommand(onToggleRightSidebar),
      });
    }

    if (onToggleTheme) {
      items.push({
        id: 'toggle-theme',
        label: 'Toggle Theme',
        description: APP_SHORTCUTS.TOGGLE_THEME.description,
        icon: <Palette className="h-4 w-4" />,
        group: 'Toggles',
        keywords: ['theme', 'dark', 'light', 'mode', 'toggle'],
        shortcut: {
          key: APP_SHORTCUTS.TOGGLE_THEME.key.toUpperCase(),
          modifier: APP_SHORTCUTS.TOGGLE_THEME.modifier,
        },
        onSelect: () => runCommand(onToggleTheme),
      });
    }

    // Agent switching commands
    if (onNextAgent) {
      items.push({
        id: 'nav-next-agent',
        label: 'Next Agent',
        description: APP_SHORTCUTS.NEXT_AGENT.description,
        icon: <ArrowRightLeft className="h-4 w-4" />,
        group: 'Navigation',
        keywords: ['agent', 'next', 'switch', 'conversation', 'chat'],
        shortcut: {
          key: APP_SHORTCUTS.NEXT_AGENT.key.toUpperCase(),
          modifier: APP_SHORTCUTS.NEXT_AGENT.modifier,
        },
        onSelect: () => runCommand(onNextAgent),
      });
    }

    if (onPrevAgent) {
      items.push({
        id: 'nav-prev-agent',
        label: 'Previous Agent',
        description: APP_SHORTCUTS.PREV_AGENT.description,
        icon: <ArrowRightLeft className="h-4 w-4" />,
        group: 'Navigation',
        keywords: ['agent', 'previous', 'switch', 'conversation', 'chat'],
        shortcut: {
          key: APP_SHORTCUTS.PREV_AGENT.key.toUpperCase(),
          modifier: APP_SHORTCUTS.PREV_AGENT.modifier,
        },
        onSelect: () => runCommand(onPrevAgent),
      });
    }

    // Project commands
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

      // Task commands
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
    projects,
    onGoHome,
    onOpenProject,
    onOpenSettings,
    onSelectProject,
    onSelectTask,
    onToggleLeftSidebar,
    onToggleRightSidebar,
    onToggleTheme,
    onNextAgent,
    onPrevAgent,
    runCommand,
  ]);

  // Group commands
  const groupedCommands = useMemo(() => {
    const groups = new Map<string, CommandItem[]>();
    commands.forEach((cmd) => {
      const group = groups.get(cmd.group) || [];
      group.push(cmd);
      groups.set(cmd.group, group);
    });
    return groups;
  }, [commands]);

  const groupOrder = ['Navigation', 'Toggles', 'Projects', 'Tasks'];

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
          className="fixed inset-0 z-[130] flex items-start justify-center bg-black/60 pt-[15vh] backdrop-blur-sm"
          initial={shouldReduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={shouldReduceMotion ? { opacity: 1 } : { opacity: 0 }}
          transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.12, ease: 'easeOut' }}
          onClick={handleClose}
        >
          <motion.div
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            initial={shouldReduceMotion ? false : { opacity: 0, y: -8, scale: 0.995 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={
              shouldReduceMotion
                ? { opacity: 1, y: 0, scale: 1 }
                : { opacity: 0, y: -6, scale: 0.995 }
            }
            transition={
              shouldReduceMotion ? { duration: 0 } : { duration: 0.18, ease: [0.22, 1, 0.36, 1] }
            }
            className="mx-4 w-full max-w-2xl overflow-hidden rounded-2xl border border-border/50 bg-background shadow-2xl"
          >
            <Command
              shouldFilter={true}
              className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]]:px-2 [&_[cmdk-group]]:pb-2 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-3 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-4 [&_[cmdk-item]_svg]:w-4"
            >
              <div className="flex items-center border-b border-border/60 px-4">
                <Search className="mr-3 h-4 w-4 shrink-0 text-muted-foreground" />
                <Command.Input
                  value={search}
                  onValueChange={setSearch}
                  placeholder="Search commands, projects, tasks..."
                  className="flex h-12 w-full rounded-md bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  autoFocus
                />
              </div>

              <Command.List className="max-h-[400px] overflow-y-auto overflow-x-hidden p-2">
                <Command.Empty className="py-8 text-center text-sm text-muted-foreground">
                  No results found.
                </Command.Empty>

                {groupOrder.map((groupName) => {
                  const groupItems = groupedCommands.get(groupName);
                  if (!groupItems || groupItems.length === 0) return null;

                  return (
                    <Command.Group key={groupName} heading={groupName}>
                      {groupItems.map((item) => (
                        <Command.Item
                          key={item.id}
                          value={`${item.label} ${item.description || ''} ${item.keywords?.join(' ') || ''}`}
                          onSelect={() => item.onSelect()}
                          className="relative flex cursor-pointer select-none items-center gap-3 rounded-lg px-3 py-3 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground aria-selected:bg-accent aria-selected:text-accent-foreground data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
                        >
                          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
                            {item.icon}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium">{item.label}</div>
                            {item.description && (
                              <div className="truncate text-xs text-muted-foreground">
                                {item.description}
                              </div>
                            )}
                          </div>
                          {item.shortcut && (
                            <div className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                              {item.shortcut.modifier === 'cmd' && (
                                <CommandIcon className="h-3 w-3" />
                              )}
                              {item.shortcut.modifier === 'ctrl' && (
                                <span className="font-medium">Ctrl</span>
                              )}
                              {item.shortcut.modifier === 'shift' && (
                                <span className="font-medium">⇧</span>
                              )}
                              {(item.shortcut.modifier === 'option' ||
                                item.shortcut.modifier === 'alt') && <Option className="h-3 w-3" />}
                              <span className="font-medium">{item.shortcut.key}</span>
                            </div>
                          )}
                        </Command.Item>
                      ))}
                    </Command.Group>
                  );
                })}
              </Command.List>

              <div className="flex items-center justify-between border-t border-border/60 bg-muted/20 px-4 py-3">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>Select</span>
                    <div className="flex items-center gap-1 rounded border border-border/60 bg-background px-1.5 py-0.5">
                      <CornerDownLeft className="h-3 w-3" />
                    </div>
                  </div>
                  <div className="h-4 w-px bg-border/60" />
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>Close</span>
                    <div className="flex items-center gap-1 rounded border border-border/60 bg-background px-1.5 py-0.5">
                      <span className="text-xs">ESC</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>Navigate</span>
                  <div className="flex items-center gap-1 rounded border border-border/60 bg-background px-1.5 py-0.5">
                    <ArrowUp className="h-3 w-3" />
                    <ArrowDown className="h-3 w-3" />
                  </div>
                </div>
              </div>
            </Command>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};

export default CommandPalette;
