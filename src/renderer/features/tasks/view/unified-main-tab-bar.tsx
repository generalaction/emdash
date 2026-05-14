import { useDraggable, useDroppable } from '@dnd-kit/core';
import { useHotkey } from '@tanstack/react-hotkeys';
import { Columns2, FileSearch, Loader2, MessageSquarePlus, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useRef } from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { formatConversationTitleForDisplay } from '@renderer/features/tasks/conversations/conversation-title-utils';
import { GitChangeStatusIcon } from '@renderer/features/tasks/diff-view/changes-panel/components/changes-list-item';
import { useTabGroupContext } from '@renderer/features/tasks/tabs/tab-group-context';
import type {
  ResolvedConversationTab,
  ResolvedDiffTab,
  ResolvedFileTab,
} from '@renderer/features/tasks/tabs/tab-manager-store';
import {
  useTaskViewContext,
  useWorkspaceViewModel,
} from '@renderer/features/tasks/task-view-context';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { FileIcon } from '@renderer/lib/editor/file-icon';
import { useDelayedBoolean } from '@renderer/lib/hooks/use-delay-boolean';
import {
  getEffectiveHotkey,
  getHotkeyRegistration,
} from '@renderer/lib/hooks/useKeyboardShortcuts';
import { useTabShortcuts } from '@renderer/lib/hooks/useTabShortcuts';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import { Button } from '@renderer/lib/ui/button';
import { Separator } from '@renderer/lib/ui/separator';
import { ShortcutHint } from '@renderer/lib/ui/shortcut-hint';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { agentConfig } from '@renderer/utils/agentConfig';
import { cn } from '@renderer/utils/utils';
import { AgentStatusIndicator } from '../components/agent-status-indicator';

function DropIndicator() {
  return <div className="pointer-events-none absolute inset-y-1 left-0 z-10 w-0.5 bg-foreground" />;
}

function PaneDropZone({ groupId }: { groupId: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: `pane-drop-${groupId}` });
  return (
    <div ref={setNodeRef} className="relative h-full flex-1">
      {isOver && <DropIndicator />}
    </div>
  );
}

function DraggableTab({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef: setDragRef } = useDraggable({ id });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={(el) => {
        setDragRef(el);
        setDropRef(el);
      }}
      style={{
        display: 'flex',
        height: '100%',
        alignItems: 'center',
        position: 'relative',
      }}
      {...attributes}
      {...listeners}
    >
      {isOver && <DropIndicator />}
      {children}
    </div>
  );
}

const ConversationTabItem = observer(function ConversationTabItem({
  tab,
  onSelect,
  onPin,
  onClose,
}: {
  tab: ResolvedConversationTab;
  onSelect: () => void;
  onPin: () => void;
  onClose: () => void;
}) {
  const config = agentConfig[tab.store.data.providerId];
  const title = formatConversationTitleForDisplay(tab.store.data.providerId, tab.store.data.title);

  return (
    <>
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
          <span className={cn('max-w-24 truncate p-1', tab.isPreview && 'italic')}>{title}</span>
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
  const fileName = tab.path.split('/').pop() ?? 'Untitled';
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
  const fileName = tab.path.split('/').pop() ?? 'Untitled';
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

/**
 * Floating drag clone rendered inside DragOverlay during a tab drag.
 * Looks up the tab across all groups so it works for cross-pane drags.
 */
export const TabDragPreview = observer(function TabDragPreview({ tabId }: { tabId: string }) {
  const { tabGroupManager } = useWorkspaceViewModel();
  const tab = tabGroupManager.groups
    .flatMap((g) => g.tabManager.resolvedTabs)
    .find((t) => t.tabId === tabId);
  if (!tab) return null;

  let icon: React.ReactNode = null;
  let label = '';

  if (tab.kind === 'conversation') {
    const config = agentConfig[tab.store.data.providerId];
    label = formatConversationTitleForDisplay(tab.store.data.providerId, tab.store.data.title);
    icon = config ? (
      <AgentLogo
        logo={config.logo}
        alt={config.alt}
        isSvg={config.isSvg}
        invertInDark={config.invertInDark}
        className="size-4 shrink-0"
      />
    ) : null;
  } else if (tab.kind === 'file') {
    const fileName = tab.path.split('/').pop() ?? 'Untitled';
    label = fileName;
    icon = (
      <span className="shrink-0 [&>svg]:h-3 [&>svg]:w-3">
        <FileIcon filename={fileName} />
      </span>
    );
  } else {
    const fileName = tab.path.split('/').pop() ?? 'Untitled';
    const suffix = diffGroupSuffix(tab.diffGroup);
    label = `${fileName} ${suffix}`;
    icon = (
      <span className="shrink-0 [&>svg]:h-3 [&>svg]:w-3">
        <FileIcon filename={fileName} />
      </span>
    );
  }

  return (
    <div className="flex cursor-grabbing items-center gap-1.5 bg-background-secondary-1 text-sm shadow-lg px-2 py-1 border border-border rounded-md opacity-80">
      {icon}
      <span className="max-w-[200px] truncate">{label}</span>
    </div>
  );
});

export const UnifiedMainTabBar = observer(function UnifiedMainTabBar() {
  const taskView = useWorkspaceViewModel();
  const { projectId, taskId, workspaceId } = useTaskViewContext();
  const { groupId, tabManager } = useTabGroupContext();
  const { tabGroupManager } = taskView;
  const showCommandPalette = useShowModal('commandPaletteModal');
  const showCreateConversationModal = useShowModal('createConversationModal');

  const isFocusedPane =
    taskView.focusedRegion === 'main' && tabGroupManager.activeGroupId === groupId;

  useTabShortcuts(tabManager, { focused: isFocusedPane });

  const { value: keyboard } = useAppSettingsKey('keyboard');
  const canSplit = tabManager.resolvedTabs.length >= 2 && tabGroupManager.groups.length < 3;
  useHotkey(
    getHotkeyRegistration('splitPane', keyboard),
    (e) => {
      e.preventDefault();
      tabGroupManager.splitRight();
    },
    {
      enabled: isFocusedPane && canSplit && getEffectiveHotkey('splitPane', keyboard) !== null,
      conflictBehavior: 'allow',
    }
  );

  const resolvedTabs = tabManager.resolvedTabs;

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = tabManager.activeTabId;
    if (!id || !scrollContainerRef.current) return;
    const el = scrollContainerRef.current.querySelector<HTMLElement>(
      `[data-tabid="${CSS.escape(id)}"]`
    );
    el?.scrollIntoView({ behavior: 'instant', inline: 'nearest', block: 'nearest' });
  }, [tabManager.activeTabId]);

  return (
    <div className="flex h-[41px] shrink-0 items-center justify-between border-b border-border bg-background-secondary">
      <div ref={scrollContainerRef} className="flex h-full w-full overflow-x-auto">
        {resolvedTabs.map((tab) => {
          if (tab.kind === 'conversation') {
            return (
              <DraggableTab key={tab.tabId} id={tab.tabId}>
                <ConversationTabItem
                  tab={tab}
                  onSelect={() => tabManager.setActiveTab(tab.tabId)}
                  onPin={() => tabManager.openConversation(tab.conversationId)}
                  onClose={() => tabManager.closeTab(tab.tabId)}
                />
              </DraggableTab>
            );
          }
          if (tab.kind === 'diff') {
            return (
              <DraggableTab key={tab.tabId} id={tab.tabId}>
                <DiffTabItem
                  tab={tab}
                  onSelect={() => tabManager.setActiveTab(tab.tabId)}
                  onPin={() => tabManager.pinTab(tab.tabId)}
                  onClose={() => tabManager.closeTab(tab.tabId)}
                />
              </DraggableTab>
            );
          }
          return (
            <DraggableTab key={tab.tabId} id={tab.tabId}>
              <FileTabItem
                tab={tab}
                onSelect={() => tabManager.setActiveTab(tab.tabId)}
                onPin={() => tabManager.pinTab(tab.tabId)}
                onClose={() => tabManager.closeTabWithGuard(tab.tabId)}
              />
            </DraggableTab>
          );
        })}
        <PaneDropZone groupId={groupId} />
      </div>
      <div className="flex h-full shrink-0 items-center px-1">
        <Tooltip>
          <TooltipTrigger>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() =>
                showCreateConversationModal({
                  projectId,
                  taskId,
                  onSuccess: ({ conversationId }) => tabManager.openConversation(conversationId),
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
          onClick={() =>
            showCommandPalette({ projectId, taskId, workspaceId: workspaceId ?? undefined })
          }
          className="flex h-full items-center justify-center px-2 text-foreground-muted hover:text-foreground hover:bg-background-secondary-1/40"
          aria-label="Open files"
          title="Open files"
        >
          <FileSearch className="size-4" />
        </Button>
        {tabGroupManager.groups.length < 3 && (
          <Tooltip>
            <TooltipTrigger>
              <span>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  disabled={!canSplit}
                  onClick={() => tabGroupManager.splitRight()}
                  aria-label="Split pane right"
                >
                  <Columns2 className="size-4" />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {canSplit ? (
                <span className="flex items-center gap-2">
                  Move active tab to a new pane
                  <ShortcutHint settingsKey="splitPane" />
                </span>
              ) : (
                'Open at least 2 tabs to split this pane'
              )}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
});
