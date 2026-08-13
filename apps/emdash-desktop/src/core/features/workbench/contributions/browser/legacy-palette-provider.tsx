import { Command } from 'cmdk';
import { FolderOpen, GitBranch, MessageSquare, type LucideIcon } from 'lucide-react';
import React from 'react';
import { conversationRegistry } from '@core/features/conversations/api/browser/stores/conversation-registry';
import { FileIcon } from '@core/features/editor/contributions/browser/file-icon';
import {
  asMounted,
  getProjectManagerStore,
} from '@core/features/projects/api/browser/stores/project-selectors';
import { projectViewDef } from '@core/features/projects/contributions/views';
import { getSearchClient } from '@core/features/search/api/client';
import type { TaskStore } from '@core/features/tasks/api/browser/stores/task-store';
import { getTaskStore } from '@core/features/tasks/api/browser/task-state/task-selectors';
import { taskManagerStoreToken } from '@core/features/tasks/contributions/browser/project-store-tokens';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import { getTaskComposition } from '@core/features/workbench/api/browser/task-composition-selectors';
import { workspaceRegistry } from '@core/features/workspaces/api/browser/stores/workspace-registry';
import { PALETTE_CATALOG } from '@core/manifests/shared/palette-catalog';
import { keybindingService } from '@core/primitives/keybindings/browser';
import { Shortcut } from '@core/primitives/keybindings/browser/shortcut';
import { useNavigate } from '@core/primitives/navigation/browser/navigation-hooks';
import type {
  PaletteContext,
  PaletteItemDef,
  PaletteProviderDef,
  PaletteProviderMatch,
  PaletteProviderRenderProps,
} from '@core/primitives/palette/api';
import { getPaletteRenderer } from '@core/primitives/palette/browser';
import type { SearchItem } from '@core/primitives/search/api';
import { cn } from '@core/primitives/styling/browser/cn';
import { isRegistered } from '@core/primitives/task-state/browser/task-state';
import type { BoundCommand } from '@core/primitives/view-scopes/api';
import { scopes } from '@core/primitives/view-scopes/browser';
import { getCommandIcon } from '../../browser/command-palette/command-icons';
import { openCommandPaletteFile } from '../../browser/command-palette/open-command-palette-file';
import { PaletteConversationItem } from '../../browser/command-palette/palette-conversation-item';
import { PALETTE_ITEM_CLASS } from '../../browser/command-palette/palette-item-styles';
import { PaletteTaskItem } from '../../browser/command-palette/palette-task-item';
import {
  applyContextAffinity,
  getPaletteFileDisplayPath,
} from '../../browser/command-palette/search-utils';

interface PaletteAction {
  readonly kind: 'action';
  readonly id: string;
  readonly item: PaletteItemDef;
  readonly bound: BoundCommand;
  readonly title: string;
  readonly subtitle?: string;
  readonly chord: ReturnType<typeof keybindingService.chordFor>;
  readonly icon?: LucideIcon;
  readonly disabled: boolean;
  readonly disabledReason?: string;
}

interface LegacyPaletteMatch extends PaletteProviderMatch {
  readonly item: SearchItem | PaletteAction;
  readonly workspacePath?: string;
  readonly keepCurrentTask?: boolean;
}

const LEGACY_RELEVANCE = { band: 'fuzzy', score: 0 } as const;

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

const KIND_ICON: Record<string, React.ReactNode> = {
  action: null,
  task: <GitBranch size={14} className="shrink-0 text-foreground/40" />,
  project: <FolderOpen size={14} className="shrink-0 text-foreground/40" />,
  conversation: <MessageSquare size={14} className="shrink-0 text-foreground/40" />,
};

function resolvePaletteAction(item: PaletteItemDef): PaletteAction | undefined {
  const bound = scopes.getActiveCommand(item.command, { fromCaptureOrigin: true });
  if (!bound || bound.availability.kind === 'hidden') return undefined;

  const presentation = bound.presentation;
  const availability = bound.availability;
  return {
    kind: 'action',
    id: item.command.id,
    item,
    bound,
    title: presentation?.title ?? item.command.title,
    subtitle: presentation?.description ?? item.command.description,
    chord: keybindingService.chordFor(item.command.id),
    icon: getCommandIcon(presentation?.icon ?? item.command.icon),
    disabled: availability.kind === 'disabled',
    disabledReason: availability.kind === 'disabled' ? availability.reason : undefined,
  };
}

function toSearchItem({
  kind,
  id,
  projectId = null,
  taskId = null,
  title,
}: Pick<SearchItem, 'kind' | 'id' | 'title'> &
  Partial<Pick<SearchItem, 'projectId' | 'taskId'>>): SearchItem {
  return {
    kind,
    id,
    projectId,
    taskId,
    title,
    subtitle: '',
    score: 0,
  };
}

function toMatch(
  id: string,
  item: SearchItem | PaletteAction,
  options: Pick<LegacyPaletteMatch, 'section' | 'workspacePath' | 'keepCurrentTask'> = {}
): LegacyPaletteMatch {
  return {
    id,
    item,
    title: item.title,
    subtitle: item.subtitle,
    relevance: LEGACY_RELEVANCE,
    ...options,
  };
}

function collectNotificationMatches(context: PaletteContext): LegacyPaletteMatch[] {
  const matches: LegacyPaletteMatch[] = [];

  for (const projectStore of getProjectManagerStore().projects.values()) {
    const mounted = asMounted(projectStore);
    if (!mounted) continue;
    const projectId = mounted.data.id;

    for (const [taskId, taskStore] of mounted.get(taskManagerStoreToken).tasks) {
      if (!isRegistered(taskStore)) continue;
      const conversations = conversationRegistry.get(taskId);
      if (!conversations) continue;

      const status = conversations.taskStatus;
      if (!status || status === 'idle' || status === 'working') continue;

      if (projectId === context.projectId && taskId === context.taskId) {
        for (const conversation of conversations.conversations.values()) {
          if (conversation.seen || !conversation.indicatorStatus) continue;
          const item = toSearchItem({
            kind: 'conversation',
            id: conversation.data.id,
            projectId,
            taskId,
            title: conversation.data.title ?? '',
          });
          matches.push(
            toMatch(`notification:conversation:${conversation.data.id}`, item, {
              section: 'Notifications',
              keepCurrentTask: true,
            })
          );
        }
      } else {
        const item = toSearchItem({
          kind: 'task',
          id: taskStore.data.id,
          projectId,
          title: taskStore.data.name,
        });
        matches.push(
          toMatch(`notification:task:${projectId}:${taskStore.data.id}`, item, {
            section: 'Notifications',
          })
        );
      }
    }
  }

  return matches;
}

function collectSuggestedActionMatches(context: PaletteContext): LegacyPaletteMatch[] {
  const suggestedIds = context.taskId
    ? TASK_SUGGESTED
    : context.projectId
      ? PROJECT_SUGGESTED
      : APP_SUGGESTED;
  const actions = PALETTE_CATALOG.items
    .flatMap((item) => {
      const action = resolvePaletteAction(item);
      return action ? [action] : [];
    })
    .filter((action) => suggestedIds.includes(action.id))
    .sort((a, b) => (a.item.rank ?? 0) - (b.item.rank ?? 0))
    .slice(0, 7);
  const groups = new Map<string, PaletteAction[]>();

  for (const action of actions) {
    const group = action.item.group ?? action.item.command.category;
    const entries = groups.get(group) ?? [];
    entries.push(action);
    groups.set(group, entries);
  }

  return [...groups].flatMap(([section, entries]) =>
    entries.map((action) => toMatch(`action:${action.id}`, action, { section }))
  );
}

function collectProjectMatches(context: PaletteContext): LegacyPaletteMatch[] {
  if (context.taskId) return [];

  const matches: LegacyPaletteMatch[] = [];
  for (const projectStore of getProjectManagerStore().projects.values()) {
    const mounted = asMounted(projectStore);
    if (!mounted || mounted.data.id === context.projectId) continue;
    const item = toSearchItem({
      kind: 'project',
      id: mounted.data.id,
      title: projectStore.name ?? mounted.data.id,
    });
    matches.push(toMatch(`idle:project:${mounted.data.id}`, item, { section: 'Projects' }));
    if (matches.length === 5) break;
  }
  return matches;
}

async function getLegacySearchResults(
  query: string,
  context: PaletteContext
): Promise<SearchItem[]> {
  try {
    const client = await getSearchClient();
    const results = await client.commandPalette({ query, context });
    return applyContextAffinity(results, { projectId: context.projectId });
  } catch {
    return [];
  }
}

function toTypedMatch(item: SearchItem, context: PaletteContext): LegacyPaletteMatch | undefined {
  if (item.kind === 'command') {
    const definition = PALETTE_CATALOG.byCommandId(item.id);
    if (!definition) return undefined;
    const action = resolvePaletteAction(definition);
    return action ? toMatch(`typed:command:${item.id}`, action) : undefined;
  }

  const workspacePath =
    item.kind === 'file' && context.workspaceId
      ? workspaceRegistry.get(context.workspaceId)?.path
      : undefined;
  return toMatch(`typed:${item.kind}:${item.id}`, item, { workspacePath });
}

async function getLegacyIdleMatches(context: PaletteContext): Promise<LegacyPaletteMatch[]> {
  const rankedDb = await getLegacySearchResults('', context);
  const taskMatches = rankedDb
    .filter((item) => item.kind === 'task')
    .slice(0, 5)
    .map((item) => toMatch(`recent:task:${item.id}`, item, { section: 'Recent Tasks' }));
  const conversationMatches = context.taskId
    ? rankedDb
        .filter((item) => item.kind === 'conversation')
        .slice(0, 5)
        .map((item) =>
          toMatch(`recent:conversation:${item.id}`, item, {
            section: 'Recent Conversations',
          })
        )
    : [];

  return [
    ...collectNotificationMatches(context),
    ...collectSuggestedActionMatches(context),
    ...taskMatches,
    ...collectProjectMatches(context),
    ...conversationMatches,
  ];
}

async function searchLegacyMatches({
  query,
  context,
}: {
  query: string;
  context: PaletteContext;
}): Promise<LegacyPaletteMatch[]> {
  if (query.length < 3) return [];
  const results = await getLegacySearchResults(query, context);
  return results.flatMap((item) => {
    const match = toTypedMatch(item, context);
    return match ? [match] : [];
  });
}

function LegacyPaletteItem({
  value,
  item,
  onSelect,
}: {
  value: string;
  item: SearchItem | PaletteAction;
  onSelect: () => void;
}) {
  const action = item.kind === 'action' ? item : undefined;
  if (action) {
    const Renderer = getPaletteRenderer(action.item.command);
    if (Renderer) {
      return (
        <Renderer
          item={action.item}
          bound={action.bound}
          chord={action.chord}
          onSelect={action.disabled ? () => {} : onSelect}
        />
      );
    }
  }

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
      disabled={action?.disabled}
      title={action?.disabledReason}
      className={cn(
        PALETTE_ITEM_CLASS,
        'group',
        action?.disabled && 'cursor-not-allowed opacity-50'
      )}
    >
      {iconNode}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{item.title}</span>
        {(action?.disabledReason ?? action?.subtitle) && (
          <span className="truncate text-xs text-foreground/40">
            {action?.disabledReason ?? action?.subtitle}
          </span>
        )}
      </span>
      {action?.chord && <Shortcut hotkey={action.chord} variant="keycaps" />}
    </Command.Item>
  );
}

function LegacyPaletteFileItem({
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

function LegacyPaletteProviderRow({
  match,
  value,
  onSelect,
}: PaletteProviderRenderProps<LegacyPaletteMatch>) {
  const { navigate } = useNavigate();
  const item = match.item;

  if (item.kind === 'action') {
    const handleAction = () => {
      if (item.bound.availability.kind !== 'enabled') return;
      onSelect();
      item.bound.execute(undefined, 'palette');
    };
    return (
      <LegacyPaletteItem
        value={value}
        item={item}
        onSelect={item.disabled ? () => {} : handleAction}
      />
    );
  }

  const handleItem = () => {
    if (item.kind === 'task') {
      if (!item.projectId) return;
      onSelect();
      navigate(taskViewDef({ projectId: item.projectId, taskId: item.id }));
      return;
    }
    if (item.kind === 'project') {
      onSelect();
      navigate(projectViewDef({ projectId: item.id }));
      return;
    }
    if (item.kind === 'conversation') {
      if (!item.projectId || !item.taskId) return;
      getTaskComposition(item.projectId, item.taskId)?.paneLayout.open(
        'conversation',
        { conversationId: item.id },
        { preview: false }
      );
      onSelect();
      if (!match.keepCurrentTask) {
        navigate(taskViewDef({ projectId: item.projectId, taskId: item.taskId }));
      }
      return;
    }
    if (item.kind === 'file') {
      openCommandPaletteFile(item, onSelect, navigate);
    }
  };

  if (item.kind === 'task' && item.projectId) {
    const taskStore: TaskStore | undefined = getTaskStore(item.projectId, item.id);
    if (taskStore) {
      return <PaletteTaskItem taskStore={taskStore} value={value} onSelect={handleItem} />;
    }
  }
  if (item.kind === 'conversation' && item.taskId) {
    const conversation = conversationRegistry.get(item.taskId)?.conversations.get(item.id);
    if (conversation) {
      return <PaletteConversationItem conv={conversation} value={value} onSelect={handleItem} />;
    }
  }
  if (item.kind === 'file') {
    return (
      <LegacyPaletteFileItem
        value={value}
        item={item}
        workspacePath={match.workspacePath}
        onSelect={handleItem}
      />
    );
  }
  return <LegacyPaletteItem value={value} item={item} onSelect={handleItem} />;
}

const legacyPaletteProviderDef: PaletteProviderDef = {
  kind: 'legacy',
  keyword: '@legacy',
  minQueryLength: 1,
  idle: getLegacyIdleMatches,
  search: searchLegacyMatches,
  render: ({ match, value, onSelect }) => (
    <LegacyPaletteProviderRow
      match={match as LegacyPaletteMatch}
      value={value}
      onSelect={onSelect}
    />
  ),
};

export const workbenchPaletteProviderDefs = [legacyPaletteProviderDef] as const;
