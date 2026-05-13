import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { horizontalListSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable';
import { CSS as DndCSS } from '@dnd-kit/utilities';
import { FileSearch, Loader2, MessageSquarePlus, Pencil, Rows3, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useRef } from 'react';
import type { AgentLayoutMode } from '@shared/view-state';
import { formatConversationTitleForDisplay } from '@renderer/features/tasks/conversations/conversation-title-utils';
import { LAYOUT_MODE_ITEMS } from '@renderer/features/tasks/conversations/conversations-grid-panel';
import { GitChangeStatusIcon } from '@renderer/features/tasks/diff-view/changes-panel/components/changes-list-item';
import type {
  ResolvedConversationTab,
  ResolvedDiffTab,
  ResolvedFileTab,
} from '@renderer/features/tasks/tabs/tab-manager-store';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { FileIcon } from '@renderer/lib/editor/file-icon';
import { useDelayedBoolean } from '@renderer/lib/hooks/use-delay-boolean';
import { useTabShortcuts } from '@renderer/lib/hooks/useTabShortcuts';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import { Button } from '@renderer/lib/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@renderer/lib/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { Separator } from '@renderer/lib/ui/separator';
import { ShortcutHint } from '@renderer/lib/ui/shortcut-hint';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { agentConfig } from '@renderer/utils/agentConfig';
import { basenameAny } from '@renderer/utils/path-name';
import { cn } from '@renderer/utils/utils';
import { AgentStatusIndicator } from '../components/agent-status-indicator';

function SortableTabWrapper({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: DndCSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : undefined,
        display: 'flex',
        height: '100%',
        alignItems: 'center',
      }}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}

const ConversationTabItem = observer(function ConversationTabItem({
  tab,
  onSelect,
  onPin,
  onClose,
  onRename,
}: {
  tab: ResolvedConversationTab;
  onSelect: () => void;
  onPin: () => void;
  onClose: () => void;
  onRename: () => void;
}) {
  const config = agentConfig[tab.store.data.providerId];
  const title = formatConversationTitleForDisplay(tab.store.data.providerId, tab.store.data.title);

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger>
          <button
            onClick={onSelect}
            onDoubleClick={onPin}
            title={tab.isPreview ? `${title} (preview — double-click to keep)` : title}
            data-tabid={tab.tabId}
            className={cn(
              'group relative flex h-full flex-col bg-background-secondary text-sm text-foreground-muted hover:bg-background-secondary-1/40',
              tab.isActive &&
                'bg-background-secondary-1 text-foreground hover:bg-background-secondary-1'
            )}
          >
            <div className="flex h-full items-center gap-1.5 pl-3 pr-1">
              {config ? (
                <AgentLogo
                  logo={config.logo}
                  alt={config.alt}
                  isSvg={config.isSvg}
                  invertInDark={config.invertInDark}
                  className="size-4 shrink-0"
                />
              ) : null}
              <span className={cn('max-w-24 truncate p-1', tab.isPreview && 'italic')}>
                {title}
              </span>
              <div className="relative flex size-5 shrink-0 items-center justify-center">
                <span className="transition-opacity group-hover:opacity-0">
                  <AgentStatusIndicator status={tab.store.indicatorStatus} disableTooltip />
                </span>
                <button
                  className="absolute inset-0 flex items-center justify-center rounded-md text-foreground-muted opacity-0 hover:bg-background-2 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose();
                  }}
                  aria-label={`Close ${title}`}
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={onRename}>
            <Pencil className="size-4" />
            Rename
          </ContextMenuItem>
          <ContextMenuItem onClick={onClose}>
            <X className="size-4" />
            Close
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <Separator orientation="vertical" />
    </>
  );
});

function fileTabErrorTooltip(diskStatus: string, diskUri: string): string | undefined {
  if (diskStatus === 'error') return 'File not found';
  if (diskStatus === 'too-large') {
    const bytes = modelRegistry.modelTotalSizes.get(diskUri);
    if (bytes == null) return 'File too large to display';
    if (bytes < 1024) return `File too large to display (${bytes} B)`;
    if (bytes < 1024 * 1024) return `File too large to display (${(bytes / 1024).toFixed(1)} KB)`;
    return `File too large to display (${(bytes / (1024 * 1024)).toFixed(1)} MB)`;
  }
  return undefined;
}

const FileTabItem = observer(function FileTabItem({
  tab,
  onSelect,
  onPin,
  onClose,
}: {
  tab: ResolvedFileTab;
  onSelect: () => void;
  onPin: () => void;
  onClose: () => void;
}) {
  const fileName = basenameAny(tab.path) || 'Untitled';
  const isMonacoFile =
    tab.path.endsWith('.md') ||
    tab.path.endsWith('.svg') ||
    !tab.path.includes('.') ||
    /\.(ts|tsx|js|jsx|json|css|html|py|go|rs|sh|yml|yaml|toml|txt)$/.test(tab.path);

  const diskUri = modelRegistry.toDiskUri(tab.bufferUri);
  const diskStatus = modelRegistry.modelStatus.get(diskUri) ?? 'loading';
  const hasFileIssue = diskStatus === 'error' || diskStatus === 'too-large';
  const showSpinner = useDelayedBoolean(isMonacoFile && diskStatus === 'loading', 200);

  const errorTooltip = hasFileIssue ? fileTabErrorTooltip(diskStatus, diskUri) : undefined;
  const baseTitle = tab.isPreview ? `${tab.path} (preview — double-click to keep)` : tab.path;
  const tabTitle = errorTooltip ? `${tab.path} — ${errorTooltip}` : baseTitle;

  return (
    <>
      <button
        onClick={onSelect}
        onDoubleClick={onPin}
        title={tabTitle}
        data-tabid={tab.tabId}
        className={cn(
          'group relative flex h-full flex-col bg-background-secondary text-sm hover:bg-muted',
          tab.isActive && 'bg-background-secondary-1 [box-shadow:inset_0_1px_0_var(--primary)]'
        )}
      >
        <div className="flex h-full items-center gap-1.5 pl-3 pr-2">
          <span className="shrink-0 [&>svg]:h-3 [&>svg]:w-3">
            {showSpinner ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <FileIcon filename={fileName} />
            )}
          </span>
          <span
            className={cn(
              'max-w-[200px] truncate p-1 text-sm',
              tab.isPreview && 'italic',
              hasFileIssue && 'text-foreground-destructive'
            )}
          >
            {fileName}
          </span>
          <div className="relative flex size-5 shrink-0 items-center justify-center">
            {tab.isDirty && (
              <div
                className="size-2 rounded-full bg-foreground group-hover:opacity-0"
                title="Unsaved changes"
              />
            )}
            <button
              className="absolute inset-0 flex items-center justify-center rounded-md text-foreground-muted opacity-0 hover:bg-background-2 group-hover:opacity-100 transition-opacity"
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              aria-label={`Close ${fileName}`}
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      </button>
      <Separator orientation="vertical" />
    </>
  );
});

function diffGroupSuffix(diffGroup: ResolvedDiffTab['diffGroup']): string {
  switch (diffGroup) {
    case 'disk':
      return '(Working Tree)';
    case 'staged':
      return '(Index)';
    case 'pr':
      return '(PR)';
    case 'git':
      return '(Git)';
  }
}

const DiffTabItem = observer(function DiffTabItem({
  tab,
  onSelect,
  onPin,
  onClose,
}: {
  tab: ResolvedDiffTab;
  onSelect: () => void;
  onPin: () => void;
  onClose: () => void;
}) {
  const fileName = basenameAny(tab.path) || 'Untitled';
  const suffix = diffGroupSuffix(tab.diffGroup);

  return (
    <>
      <button
        onClick={onSelect}
        onDoubleClick={onPin}
        title={
          tab.isPreview
            ? `${tab.path} ${suffix} (preview — double-click to keep)`
            : `${tab.path} ${suffix}`
        }
        data-tabid={tab.tabId}
        className={cn(
          'group relative flex h-full flex-col bg-background-secondary text-sm hover:bg-muted',
          tab.isActive && 'bg-background-secondary-1 [box-shadow:inset_0_1px_0_var(--primary)]'
        )}
      >
        <div className="flex h-full items-center gap-1.5 pl-3 pr-2">
          <span className="shrink-0 [&>svg]:h-3 [&>svg]:w-3">
            <FileIcon filename={fileName} />
          </span>
          <span className={cn('max-w-[200px] truncate p-1 text-sm', tab.isPreview && 'italic')}>
            {fileName}
            <span className="ml-1 text-xs text-foreground-muted">{suffix}</span>
          </span>
          <div className="relative flex size-5 shrink-0 items-center justify-center">
            {tab.status && (
              <span className="transition-opacity group-hover:opacity-0">
                <GitChangeStatusIcon status={tab.status} className="size-4" />
              </span>
            )}
            <button
              className="absolute inset-0 flex items-center justify-center rounded-md text-foreground-muted opacity-0 hover:bg-background-2 group-hover:opacity-100 transition-opacity"
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              aria-label={`Close ${fileName} ${suffix}`}
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      </button>
      <Separator orientation="vertical" />
    </>
  );
});

function CombinedAgentsTabItem({
  isActive,
  layoutMode,
  count,
  onSelect,
  onClose,
}: {
  isActive: boolean;
  layoutMode: AgentLayoutMode;
  count: number;
  onSelect: () => void;
  onClose: () => void;
}) {
  const item = LAYOUT_MODE_ITEMS.find((m) => m.id === layoutMode);
  const Icon = item?.Icon ?? Rows3;
  const tooltip = `Agents — ${item?.label ?? layoutMode} layout`;

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger>
          <button
            onClick={onSelect}
            title={tooltip}
            data-tabid="agents-combined"
            className={cn(
              'group relative flex h-full flex-col bg-background-secondary text-sm text-foreground-muted hover:bg-background-secondary-1/40',
              isActive &&
                'bg-background-secondary-1 text-foreground hover:bg-background-secondary-1'
            )}
          >
            <div className="flex h-full items-center gap-1.5 pl-3 pr-1">
              <Icon className="size-4 shrink-0" />
              <span className="p-1">Agents</span>
              {count > 0 && (
                <span className="rounded bg-background-2 px-1.5 py-0.5 text-xs text-foreground-muted">
                  {count}
                </span>
              )}
              <div className="relative flex size-5 shrink-0 items-center justify-center">
                <button
                  className="absolute inset-0 flex items-center justify-center rounded-md text-foreground-muted opacity-0 hover:bg-background-2 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose();
                  }}
                  aria-label="Close all agents"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={onClose}>
            <X className="size-4" />
            Close all
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <Separator orientation="vertical" />
    </>
  );
}

const AgentLayoutMenu = observer(function AgentLayoutMenu() {
  const { taskView } = useProvisionedTask();
  const current = LAYOUT_MODE_ITEMS.find((m) => m.id === taskView.agentLayoutMode);
  const CurrentIcon = current?.Icon ?? Rows3;
  return (
    <Tooltip>
      <DropdownMenu>
        <TooltipTrigger>
          <DropdownMenuTrigger>
            <Button size="icon-sm" variant="ghost" aria-label="Layout" title="Agent panel layout">
              <CurrentIcon className="size-4" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <DropdownMenuContent align="end">
          {LAYOUT_MODE_ITEMS.map(({ id, label, Icon }) => (
            <DropdownMenuItem key={id} onClick={() => taskView.setAgentLayoutMode(id)}>
              <Icon className="size-4" />
              {label}
              {taskView.agentLayoutMode === id && (
                <span className="ml-auto text-xs text-foreground-muted">●</span>
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <TooltipContent>Agent panel layout</TooltipContent>
    </Tooltip>
  );
});

export const UnifiedMainTabBar = observer(function UnifiedMainTabBar() {
  const { taskView } = useProvisionedTask();
  const { projectId, taskId } = useTaskViewContext();
  const { tabManager } = taskView;
  const showCommandPalette = useShowModal('commandPaletteModal');
  const showCreateConversationModal = useShowModal('createConversationModal');
  const showRenameConversationModal = useShowModal('renameConversationModal');

  useTabShortcuts(tabManager, { focused: taskView.focusedRegion === 'main' });

  const resolvedTabs = tabManager.resolvedTabs;
  const isTabsLayout = taskView.agentLayoutMode === 'tabs';
  const sortableIds = isTabsLayout
    ? resolvedTabs.map((t) => t.tabId)
    : resolvedTabs.filter((t) => t.kind !== 'conversation').map((t) => t.tabId);
  const convTabs = resolvedTabs.filter((t) => t.kind === 'conversation');
  const isAnyConvActive = convTabs.some((t) => t.isActive);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function activateLastConv() {
    const last = convTabs[convTabs.length - 1];
    if (last && !last.isActive) tabManager.setActiveTab(last.tabId);
  }

  function closeAllConvAndClearSlots() {
    for (const t of convTabs) tabManager.closeTab(t.tabId);
    for (const id of [...taskView.agentSlots]) taskView.removeConversationFromLayout(id);
  }

  useEffect(() => {
    const id = tabManager.activeTabId;
    if (!id || !scrollContainerRef.current) return;
    const el = scrollContainerRef.current.querySelector<HTMLElement>(
      `[data-tabid="${CSS.escape(id)}"]`
    );
    el?.scrollIntoView({ behavior: 'instant', inline: 'nearest', block: 'nearest' });
  }, [tabManager.activeTabId]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const allIds = resolvedTabs.map((t) => t.tabId);
    const fromIndex = allIds.indexOf(active.id as string);
    const toIndex = allIds.indexOf(over.id as string);
    if (fromIndex !== -1 && toIndex !== -1) {
      tabManager.reorderTabs(fromIndex, toIndex);
    }
  }

  return (
    <div className="flex h-[41px] shrink-0 items-center justify-between border-b border-border bg-background-secondary">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={sortableIds} strategy={horizontalListSortingStrategy}>
          <div ref={scrollContainerRef} className="flex h-full overflow-x-auto">
            {(() => {
              let combinedRendered = false;
              return resolvedTabs.map((tab) => {
                if (tab.kind === 'conversation') {
                  if (isTabsLayout) {
                    return (
                      <SortableTabWrapper key={tab.tabId} id={tab.tabId}>
                        <ConversationTabItem
                          tab={tab}
                          onSelect={() => tabManager.setActiveTab(tab.tabId)}
                          onPin={() => tabManager.openConversation(tab.conversationId)}
                          onClose={() => tabManager.closeTab(tab.tabId)}
                          onRename={() =>
                            showRenameConversationModal({
                              projectId,
                              taskId,
                              conversationId: tab.conversationId,
                              currentName: tab.store.data.title,
                            })
                          }
                        />
                      </SortableTabWrapper>
                    );
                  }
                  if (combinedRendered) return null;
                  combinedRendered = true;
                  return (
                    <CombinedAgentsTabItem
                      key="agents-combined"
                      isActive={isAnyConvActive}
                      layoutMode={taskView.agentLayoutMode}
                      count={convTabs.length}
                      onSelect={activateLastConv}
                      onClose={closeAllConvAndClearSlots}
                    />
                  );
                }
                if (tab.kind === 'diff') {
                  return (
                    <SortableTabWrapper key={tab.tabId} id={tab.tabId}>
                      <DiffTabItem
                        tab={tab}
                        onSelect={() => tabManager.setActiveTab(tab.tabId)}
                        onPin={() => tabManager.pinTab(tab.tabId)}
                        onClose={() => tabManager.closeTab(tab.tabId)}
                      />
                    </SortableTabWrapper>
                  );
                }
                return (
                  <SortableTabWrapper key={tab.tabId} id={tab.tabId}>
                    <FileTabItem
                      tab={tab}
                      onSelect={() => tabManager.setActiveTab(tab.tabId)}
                      onPin={() => tabManager.pinTab(tab.tabId)}
                      onClose={() => tabManager.closeTabWithGuard(tab.tabId)}
                    />
                  </SortableTabWrapper>
                );
              });
            })()}
              });
            })()}
          </div>
        </SortableContext>
      </DndContext>
      <div className="flex h-full shrink-0 items-center px-1">
        <AgentLayoutMenu />
        <Tooltip>
          <TooltipTrigger>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() =>
                showCreateConversationModal({
                  projectId,
                  taskId,
                  onSuccess: ({ conversationId }) => {
                    tabManager.openConversation(conversationId);
                    taskView.addConversationToLayout(conversationId);
                  },
                })
              }
              aria-label="New conversation"
              title="New conversation"
            >
              <MessageSquarePlus className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            New Conversations <ShortcutHint settingsKey="newConversation" />
          </TooltipContent>
        </Tooltip>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => showCommandPalette({ projectId, taskId })}
          className="flex h-full items-center justify-center px-2 text-foreground-muted hover:text-foreground hover:bg-background-secondary-1/40"
          aria-label="Open files"
          title="Open files"
        >
          <FileSearch className="size-4" />
        </Button>
      </div>
    </div>
  );
});
