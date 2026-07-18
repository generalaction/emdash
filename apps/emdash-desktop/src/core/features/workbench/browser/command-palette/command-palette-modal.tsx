import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Command } from 'cmdk';
import { FolderOpen, GitBranch, MessageSquare, type LucideIcon } from 'lucide-react';
import { useObserver } from 'mobx-react-lite';
import React, { useEffect, useMemo, useState } from 'react';
import { conversationRegistry } from '@core/features/conversations/browser/stores/conversation-registry';
import { projectViewDef } from '@core/features/projects/contributions/views';
import { useAppSettingsKey } from '@core/features/settings/browser/use-app-settings-key';
import { getTaskStore, getTaskView } from '@core/features/tasks/browser/stores/task-selectors';
import { workspaceRegistry } from '@core/features/tasks/browser/stores/workspace-registry';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import { ALL_COMMAND_DEFS, type CommandDef } from '@core/primitives/commands/api/commands';
import { defineModal } from '@core/primitives/modals/react';
import type { SearchItem } from '@core/primitives/search/api';
import { commandRegistry } from '@renderer/lib/commands/registry';
import { FileIcon } from '@renderer/lib/editor/file-icon';
import { useDebounce } from '@renderer/lib/hooks/useDebounce';
import { getEffectiveHotkey } from '@renderer/lib/hooks/useKeyboardShortcuts';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { useModalController } from '@renderer/lib/modal/api';
import { getDesktopWireClient } from '@renderer/lib/runtime/desktop-wire-client';
import { Shortcut } from '@renderer/lib/ui/shortcut';
import { cn } from '@renderer/utils/utils';
import { getCommandIcon } from './command-icons';
import { PaletteConversationItem } from './palette-conversation-item';
import { PALETTE_ITEM_CLASS } from './palette-item-styles';
import { PaletteNotificationsGroup } from './palette-notifications-group';
import { PaletteProjectsGroup } from './palette-projects-group';
import { PaletteTaskItem } from './palette-task-item';
import { applyContextAffinity, getPaletteFileDisplayPath } from './search-utils';

interface CommandPaletteProps {
  projectId?: string;
  taskId?: string;
  workspaceId?: string;
}

interface PaletteAction {
  kind: 'action';
  id: string;
  title: string;
  subtitle?: string;
  shortcut?: ReturnType<typeof getEffectiveHotkey>;
  icon?: LucideIcon;
  execute: () => void;
}

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

// Ordered allowlists for the "Suggested Actions" empty-state group. Defined at
// module scope so the arrays keep stable references across renders.
const TASK_SUGGESTED = [
  'task.newConversation',
  'task.sidebarChanges',
  'task.sidebarFiles',
  'task.sidebarConversations',
  'task.toggleTerminalDrawer',
  'app.giveFeedback',
];
const PROJECT_SUGGESTED = ['app.newTask', 'app.settings', 'app.giveFeedback'];
const APP_SUGGESTED = ['app.newProject', 'app.settings', 'app.giveFeedback'];

function PaletteItem({
  value,
  item,
  onSelect,
}: {
  value: string;
  item: SearchItem | PaletteAction;
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
    <Command.Item value={value} onSelect={onSelect} className={cn(PALETTE_ITEM_CLASS, 'group')}>
      {iconNode}
      <span className="flex-1 truncate">{item.title}</span>
      {action?.shortcut && <Shortcut hotkey={action.shortcut} variant="keycaps" />}
    </Command.Item>
  );
}

function PaletteFileItem({
  value,
  item,
  workspacePath,
  onSelect,
}: {
  value: string;
  item: SearchItem;
  workspacePath?: string;
  onSelect: () => void;
}) {
  const displayPath = getPaletteFileDisplayPath({
    workspacePath,
    filePath: item.id,
    fallback: item.subtitle,
  });

  return (
    <Command.Item value={value} onSelect={onSelect} className={PALETTE_ITEM_CLASS}>
      <FileIcon filename={item.title} size={14} />
      <span className="flex min-w-0 flex-1 items-baseline gap-2 overflow-hidden">
        <span className="shrink-0">{item.title}</span>
        <span className="truncate text-xs text-foreground/40">{displayPath}</span>
      </span>
    </Command.Item>
  );
}

export function CommandPaletteModal({ projectId, taskId, workspaceId }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 100);
  const { navigate } = useNavigate();
  const { value: keyboard } = useAppSettingsKey('keyboard');
  const queryClient = useQueryClient();
  const { dismiss: handleClose } = useModalController('commandPaletteModal');

  // Prefetch recents immediately on mount so the empty-query view is instant.
  useEffect(() => {
    void queryClient.prefetchQuery({
      queryKey: ['cmdk-search', '', projectId, taskId, workspaceId],
      queryFn: () =>
        getDesktopWireClient().then((client) =>
          client.search.commandPalette({
            query: '',
            context: { projectId, taskId, workspaceId },
          })
        ),
      staleTime: 5_000,
    });
    // oxlint-disable-next-line react/exhaustive-deps
  }, []);

  const { data: dbResults = [] } = useQuery({
    queryKey: ['cmdk-search', debouncedQuery, projectId, taskId, workspaceId],
    queryFn: () =>
      getDesktopWireClient().then((client) =>
        client.search.commandPalette({
          query: debouncedQuery,
          context: { projectId, taskId, workspaceId },
        })
      ),
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
          shortcut: cmd.shortcutKey ? getEffectiveHotkey(cmd.shortcutKey, keyboard) : null,
          icon: getCommandIcon(def?.iconKey),
          execute: () => {
            handleClose();
            cmd.execute();
          },
        };
      })
  );

  const actions = useMemo(() => {
    // Empty state: show the ordered context-specific suggested actions only.
    const suggestedIds = taskId ? TASK_SUGGESTED : projectId ? PROJECT_SUGGESTED : APP_SUGGESTED;
    return registryActions
      .filter((a) => suggestedIds.includes(a.id))
      .sort((a, b) => suggestedIds.indexOf(a.id) - suggestedIds.indexOf(b.id))
      .slice(0, 7);
  }, [registryActions, projectId, taskId]);

  const rankedDb = applyContextAffinity(dbResults, { projectId });
  const actionResults = actions;
  const workspacePath =
    projectId && workspaceId ? workspaceRegistry.get(projectId, workspaceId)?.path : undefined;

  const taskResults = rankedDb.filter((r): r is SearchItem => r.kind === 'task');
  const conversationResults = rankedDb.filter((r): r is SearchItem => r.kind === 'conversation');

  const handleNavigateToTask = (item: SearchItem) => {
    if (!item.projectId) return;
    handleClose();
    navigate(taskViewDef({ projectId: item.projectId, taskId: item.id }));
  };

  const handleNavigateToProject = (item: SearchItem) => {
    handleClose();
    navigate(projectViewDef({ projectId: item.id }));
  };

  const handleNavigateToConversation = (item: SearchItem) => {
    if (!item.projectId || !item.taskId) return;
    getTaskView(item.projectId, item.taskId)?.paneLayout.open(
      'conversation',
      { conversationId: item.id },
      { preview: false }
    );
    handleClose();
    navigate(taskViewDef({ projectId: item.projectId, taskId: item.taskId }));
  };

  const handleOpenFile = (item: SearchItem) => {
    if (!item.projectId || !item.taskId) return;
    getTaskView(item.projectId, item.taskId)?.activePane.open(
      'file',
      { path: item.id },
      { preview: false }
    );
    handleClose();
    navigate(taskViewDef({ projectId: item.projectId, taskId: item.taskId }));
  };

  const handleSelect = (item: SearchItem) => {
    if (item.kind === 'task') return handleNavigateToTask(item);
    if (item.kind === 'project') return handleNavigateToProject(item);
    if (item.kind === 'conversation') return handleNavigateToConversation(item);
    if (item.kind === 'file') return handleOpenFile(item);
  };

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
            {rankedDb.map((item) => {
              if (item.kind === 'command') {
                const live = commandRegistry.findById(item.id);
                if (!live || live.enabled === false || live.hideFromPalette) return null;
                const def = ALL_COMMAND_DEFS.find((d) => d.id === item.id) as
                  | CommandDef
                  | undefined;
                const shortcut = def?.shortcutKey
                  ? getEffectiveHotkey(def.shortcutKey, keyboard)
                  : null;
                const displayItem: PaletteAction = {
                  kind: 'action',
                  id: item.id,
                  title: live.label,
                  subtitle: live.description,
                  shortcut,
                  icon: getCommandIcon(def?.iconKey),
                  execute: () => {
                    handleClose();
                    live.execute();
                  },
                };
                return (
                  <PaletteItem
                    key={item.id}
                    value={item.id}
                    item={displayItem}
                    onSelect={() => {
                      handleClose();
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
                const convStore = conversationRegistry.get(item.taskId)?.conversations.get(item.id);
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
              if (item.kind === 'file') {
                return (
                  <PaletteFileItem
                    key={`file:${item.id}`}
                    value={`file:${item.id}`}
                    item={item}
                    workspacePath={workspacePath}
                    onSelect={() => handleOpenFile(item)}
                  />
                );
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
              onClose={handleClose}
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
              <Command.Group heading="Recent Tasks" className={GROUP_CLASS}>
                {taskResults.slice(0, 5).map((item) => {
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
            {!taskId && (
              <PaletteProjectsGroup
                currentProjectId={projectId}
                limit={5}
                onClose={handleClose}
                navigate={navigate}
              />
            )}
            {taskId && conversationResults.length > 0 && (
              <Command.Group heading="Recent Conversations" className={GROUP_CLASS}>
                {conversationResults.slice(0, 5).map((item) => {
                  const convStore = item.taskId
                    ? conversationRegistry.get(item.taskId)?.conversations.get(item.id)
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
          <Shortcut hotkey="ArrowUp" variant="keycaps" />
          <Shortcut hotkey="ArrowDown" variant="keycaps" />
          Navigate
        </span>
        <span className="flex items-center gap-1 text-xs text-foreground/40">
          <Shortcut hotkey="Enter" variant="keycaps" />
          Select
        </span>
        <span className="flex items-center gap-1 text-xs text-foreground/40">
          <Shortcut hotkey="Escape" variant="keycaps" />
          Close
        </span>
      </div>
    </Command>
  );
}

export const commandPaletteModal = defineModal<void>()({
  id: 'commandPaletteModal',
  component: CommandPaletteModal,
  size: 'md',
});
