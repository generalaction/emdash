import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Command } from 'cmdk';
import { Activity, FolderOpen, GitBranch, MessageSquare, type LucideIcon } from 'lucide-react';
import { useObserver } from 'mobx-react-lite';
import React, { useEffect, useMemo, useState } from 'react';
import { ALL_COMMAND_DEFS, type CommandDef } from '@shared/commands';
import type { SearchItem } from '@shared/search';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import {
  asProvisioned,
  getTaskStore,
  getTaskView,
} from '@renderer/features/tasks/stores/task-selectors';
import { commandRegistry } from '@renderer/lib/commands/registry';
import { useDebounce } from '@renderer/lib/hooks/useDebounce';
import { getEffectiveHotkey } from '@renderer/lib/hooks/useKeyboardShortcuts';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { cn } from '@renderer/utils/utils';
import { getCommandIcon } from './command-icons';
import { PaletteConversationItem } from './palette-conversation-item';
import { PaletteNotificationsGroup } from './palette-notifications-group';
import { PaletteTaskItem } from './palette-task-item';
import { ResourceMonitorView } from './resource-monitor-view';
import { applyContextAffinity, rrf } from './rrf';

interface CommandPaletteProps {
  projectId?: string;
  taskId?: string;
}

interface PaletteAction {
  kind: 'action';
  id: string;
  title: string;
  subtitle?: string;
  shortcut?: string;
  score: number;
  icon?: LucideIcon;
  execute: () => void;
}

type MergedResult = SearchItem | PaletteAction;

const KIND_ICON: Record<string, React.ReactNode> = {
  action: null,
  task: <GitBranch size={14} className="shrink-0 text-foreground/40" />,
  project: <FolderOpen size={14} className="shrink-0 text-foreground/40" />,
  conversation: <MessageSquare size={14} className="shrink-0 text-foreground/40" />,
};

const GROUP_CLASS = cn(
  '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5',
  '[&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium',
  '[&_[cmdk-group-heading]]:text-foreground/50'
);

/** Converts a TanStack hotkey string (e.g. 'Mod+Shift+C') to a display label. */
function formatHotkey(hotkey: string | undefined): string | undefined {
  if (!hotkey) return undefined;
  return hotkey.replace('Mod', '⌘').replace('Shift', '⇧').replace('Alt', '⌥').replace(/\+/g, '');
}

function matchesQuery(action: PaletteAction, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = `${action.title} ${action.subtitle ?? ''}`.toLowerCase();
  return q.split(/\s+/).every((token) => haystack.includes(token));
}

function PaletteItem({
  value,
  item,
  onSelect,
}: {
  value: string;
  item: MergedResult;
  onSelect: () => void;
}) {
  const action = item.kind === 'action' ? (item as PaletteAction) : null;
  const ActionIcon = action?.icon;
  const iconNode = ActionIcon ? (
    <ActionIcon size={14} className="shrink-0 text-foreground/40" />
  ) : (
    KIND_ICON[item.kind]
  );

  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2.5 text-foreground-muted aria-selected:text-foreground rounded-md px-2 py-2 text-sm aria-selected:bg-background-2"
    >
      {iconNode}
      <span className="flex-1 truncate">{item.title}</span>
      {action?.shortcut && (
        <kbd className="shrink-0 rounded bg-background-quaternary px-1.5 py-0.5 text-xs text-foreground/60">
          {action.shortcut}
        </kbd>
      )}
    </Command.Item>
  );
}

export function CommandPaletteModal({
  projectId,
  taskId,
  onClose,
}: CommandPaletteProps & BaseModalProps) {
  const [view, setView] = useState<'search' | 'resource-monitor'>('search');
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 100);
  const { navigate } = useNavigate();
  const { value: resourceMonitor } = useAppSettingsKey('resourceMonitor');
  const { value: keyboard } = useAppSettingsKey('keyboard');
  const queryClient = useQueryClient();

  // Prefetch recents immediately on mount so the empty-query view is instant.
  useEffect(() => {
    void queryClient.prefetchQuery({
      queryKey: ['cmdk-search', '', projectId, taskId],
      queryFn: () => rpc.search.commandPalette({ query: '', context: { projectId, taskId } }),
      staleTime: 5_000,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: dbResults = [] } = useQuery({
    queryKey: ['cmdk-search', debouncedQuery, projectId, taskId],
    queryFn: () =>
      rpc.search.commandPalette({ query: debouncedQuery, context: { projectId, taskId } }),
    // Keep results fresh for 5 s — re-opening the palette with the same query
    // returns cached data instantly rather than waiting for a round-trip.
    staleTime: 5_000,
    placeholderData: (prev) => prev,
    // Skip FTS queries that the trigram tokenizer would reject (< 3 chars).
    enabled: debouncedQuery.length === 0 || debouncedQuery.length >= 3,
  });

  const registryActions = useObserver((): PaletteAction[] =>
    commandRegistry.activeCommands
      .filter((cmd) => cmd.enabled !== false && !cmd.hideFromPalette)
      .map((cmd) => {
        const def = ALL_COMMAND_DEFS.find((d) => d.id === cmd.id) as CommandDef | undefined;
        return {
          kind: 'action' as const,
          id: cmd.id,
          title: cmd.label,
          subtitle: cmd.description,
          shortcut: cmd.shortcutKey
            ? formatHotkey(getEffectiveHotkey(cmd.shortcutKey, keyboard) ?? undefined)
            : undefined,
          icon: getCommandIcon(def?.iconKey),
          score: 0,
          execute: () => {
            onClose();
            cmd.execute();
          },
        };
      })
  );

  // Ordered allowlists for the "Suggested Actions" empty-state group.
  const TASK_SUGGESTED = [
    'task.newConversation',
    'task.sidebarChanges',
    'task.sidebarFiles',
    'task.sidebarConversations',
    'task.toggleTerminalDrawer',
  ];
  const PROJECT_SUGGESTED = ['app.newTask', 'app.settings'];
  const APP_SUGGESTED = ['app.newProject', 'app.settings'];

  const actions = useMemo(() => {
    const allActions = [...registryActions];
    if (resourceMonitor?.enabled) {
      allActions.push({
        kind: 'action',
        id: 'resource-monitor',
        title: 'Resource Monitor',
        subtitle: 'Show CPU and memory performance for running agents',
        score: 0,
        icon: Activity,
        execute: () => setView('resource-monitor'),
      });
    }

    if (!debouncedQuery) {
      // Empty state: show the ordered context-specific suggested actions only.
      const suggestedIds = taskId ? TASK_SUGGESTED : projectId ? PROJECT_SUGGESTED : APP_SUGGESTED;
      return allActions
        .filter((a) => suggestedIds.includes(a.id))
        .sort((a, b) => suggestedIds.indexOf(a.id) - suggestedIds.indexOf(b.id))
        .slice(0, 7);
    }

    return allActions.filter((action) => matchesQuery(action, debouncedQuery));
  }, [debouncedQuery, registryActions, resourceMonitor?.enabled, projectId, taskId]);

  const rankedDb = applyContextAffinity(dbResults, { projectId });
  const merged = rrf<MergedResult>([rankedDb as MergedResult[], actions as MergedResult[]]);

  const actionResults = merged.filter((r): r is PaletteAction => r.kind === 'action');
  const taskResults = merged.filter((r): r is SearchItem => r.kind === 'task');
  const projectResults = merged.filter((r): r is SearchItem => r.kind === 'project');
  const conversationResults = merged.filter((r): r is SearchItem => r.kind === 'conversation');

  const handleNavigateToTask = (item: SearchItem) => {
    if (!item.projectId) return;
    onClose();
    navigate('task', { projectId: item.projectId, taskId: item.id });
  };

  const handleNavigateToProject = (item: SearchItem) => {
    onClose();
    navigate('project', { projectId: item.id });
  };

  const handleNavigateToConversation = (item: SearchItem) => {
    if (!item.projectId || !item.taskId) return;
    getTaskView(item.projectId, item.taskId)?.tabManager.openConversation(item.id);
    onClose();
    navigate('task', { projectId: item.projectId, taskId: item.taskId });
  };

  const handleSelect = (item: MergedResult) => {
    if (item.kind === 'action') return (item as PaletteAction).execute();
    if (item.kind === 'task') return handleNavigateToTask(item as SearchItem);
    if (item.kind === 'project') return handleNavigateToProject(item as SearchItem);
    if (item.kind === 'conversation') return handleNavigateToConversation(item as SearchItem);
  };

  useEffect(() => {
    if (view !== 'resource-monitor') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
        setView('search');
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [view]);

  if (view === 'resource-monitor') {
    return (
      <div className="flex flex-col overflow-hidden">
        <ResourceMonitorView onBack={() => setView('search')} />
        <div className="flex items-center gap-4 border-t border-foreground/10 px-3 py-2">
          <span className="flex items-center gap-1 text-xs text-foreground/40">
            <kbd className="rounded bg-background-secondary px-1.5 py-0.5 font-mono text-[10px] text-foreground/50">
              Esc
            </kbd>
            <kbd className="rounded bg-background-secondary px-1.5 py-0.5 font-mono text-[10px] text-foreground/50">
              ⌫
            </kbd>
            Back
          </span>
        </div>
      </div>
    );
  }

  return (
    <Command className="flex flex-col overflow-hidden" shouldFilter={false} loop>
      <div className="border-b border-foreground/10 px-1">
        <Command.Input
          value={query}
          onValueChange={setQuery}
          placeholder="Search tasks, projects, actions…"
          className="w-full bg-transparent px-3 py-3 text-sm outline-none placeholder:text-foreground/40"
          autoFocus
        />
      </div>
      <Command.List className="h-96 overflow-y-auto p-1">
        {query ? (
          <>
            <Command.Empty className="py-8 text-center text-sm text-foreground/40">
              No results for &ldquo;{query}&rdquo;
            </Command.Empty>
            {applyContextAffinity(dbResults, { projectId }).map((item) => {
              if (item.kind === 'command') {
                const live = commandRegistry.findById(item.id);
                if (!live || live.enabled === false) return null;
                const def = ALL_COMMAND_DEFS.find((d) => d.id === item.id) as
                  | CommandDef
                  | undefined;
                const shortcut = def?.shortcutKey
                  ? formatHotkey(getEffectiveHotkey(def.shortcutKey, keyboard) ?? undefined)
                  : undefined;
                const commandAction: PaletteAction = {
                  kind: 'action',
                  id: item.id,
                  title: live.label,
                  subtitle: live.description,
                  shortcut,
                  icon: getCommandIcon(def?.iconKey),
                  score: 0,
                  execute: () => {
                    onClose();
                    live.execute();
                  },
                };
                return (
                  <PaletteItem
                    key={item.id}
                    value={item.id}
                    item={commandAction}
                    onSelect={() => {
                      onClose();
                      live.execute();
                    }}
                  />
                );
              }
              if (item.kind === 'task' && item.projectId) {
                const store = getTaskStore(item.projectId, item.id);
                if (store) {
                  return (
                    <PaletteTaskItem
                      key={`task:${item.id}`}
                      taskStore={store}
                      value={`task:${item.id}`}
                      onSelect={() => handleNavigateToTask(item)}
                    />
                  );
                }
              }
              if (item.kind === 'conversation' && item.projectId && item.taskId) {
                const convStore = asProvisioned(
                  getTaskStore(item.projectId, item.taskId)
                )?.conversations.conversations.get(item.id);
                if (convStore) {
                  return (
                    <PaletteConversationItem
                      key={`conversation:${item.id}`}
                      conv={convStore}
                      value={`conversation:${item.id}`}
                      onSelect={() => handleNavigateToConversation(item)}
                    />
                  );
                }
              }
              return (
                <PaletteItem
                  key={`${item.kind}:${item.id}`}
                  value={`${item.kind}:${item.id}`}
                  item={item}
                  onSelect={() => handleSelect(item)}
                />
              );
            })}
          </>
        ) : (
          <>
            <PaletteNotificationsGroup
              currentProjectId={projectId}
              currentTaskId={taskId}
              onClose={onClose}
              navigate={navigate}
            />
            {actionResults.length > 0 && (
              <Command.Group heading="Suggested Actions" className={GROUP_CLASS}>
                {actionResults.map((item) => (
                  <PaletteItem key={item.id} value={item.id} item={item} onSelect={item.execute} />
                ))}
              </Command.Group>
            )}
            {taskResults.length > 0 && (
              <Command.Group heading="Tasks" className={GROUP_CLASS}>
                {taskResults.map((item) => {
                  const store = item.projectId ? getTaskStore(item.projectId, item.id) : undefined;
                  return store ? (
                    <PaletteTaskItem
                      key={item.id}
                      taskStore={store}
                      value={item.id}
                      onSelect={() => handleNavigateToTask(item)}
                    />
                  ) : (
                    <PaletteItem
                      key={item.id}
                      value={item.id}
                      item={item}
                      onSelect={() => handleNavigateToTask(item)}
                    />
                  );
                })}
              </Command.Group>
            )}
            {projectResults.length > 0 && (
              <Command.Group heading="Projects" className={GROUP_CLASS}>
                {projectResults.map((item) => (
                  <PaletteItem
                    key={item.id}
                    value={item.id}
                    item={item}
                    onSelect={() => handleNavigateToProject(item)}
                  />
                ))}
              </Command.Group>
            )}
            {taskId && conversationResults.length > 0 && (
              <Command.Group heading="Conversations" className={GROUP_CLASS}>
                {conversationResults.map((item) => {
                  const convStore =
                    item.projectId && item.taskId
                      ? asProvisioned(
                          getTaskStore(item.projectId, item.taskId)
                        )?.conversations.conversations.get(item.id)
                      : undefined;
                  return convStore ? (
                    <PaletteConversationItem
                      key={item.id}
                      conv={convStore}
                      value={item.id}
                      onSelect={() => handleNavigateToConversation(item)}
                    />
                  ) : (
                    <PaletteItem
                      key={item.id}
                      value={item.id}
                      item={item}
                      onSelect={() => handleNavigateToConversation(item)}
                    />
                  );
                })}
              </Command.Group>
            )}
          </>
        )}
      </Command.List>

      <div className="flex items-center gap-4 border-t border-foreground/10 px-3 py-2">
        <span className="flex items-center gap-1 text-xs text-foreground/40">
          <kbd className="rounded bg-background-secondary px-1.5 py-0.5 font-mono text-[10px] text-foreground/50">
            ↑
          </kbd>
          <kbd className="rounded bg-background-secondary px-1.5 py-0.5 font-mono text-[10px] text-foreground/50">
            ↓
          </kbd>
          Navigate
        </span>
        <span className="flex items-center gap-1 text-xs text-foreground/40">
          <kbd className="rounded bg-background-secondary px-1.5 py-0.5 font-mono text-[10px] text-foreground/50">
            ↵
          </kbd>
          Select
        </span>
        <span className="flex items-center gap-1 text-xs text-foreground/40">
          <kbd className="rounded bg-background-secondary px-1.5 py-0.5 font-mono text-[10px] text-foreground/50">
            Esc
          </kbd>
          Close
        </span>
      </div>
    </Command>
  );
}
