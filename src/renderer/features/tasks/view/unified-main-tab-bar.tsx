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
import { Loader2, Plus, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useRef } from 'react';
import { formatConversationTitleForDisplay } from '@renderer/features/tasks/conversations/conversation-title-utils';
import { GitChangeStatusIcon } from '@renderer/features/tasks/diff-view/changes-panel/components/changes-list-item';
import type {
  ResolvedConversationTab,
  ResolvedDiffTab,
  ResolvedFileTab,
} from '@renderer/features/tasks/stores/tab-manager-store';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { FileIcon } from '@renderer/lib/editor/file-icon';
import { useDelayedBoolean } from '@renderer/lib/hooks/use-delay-boolean';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { useModelStatus } from '@renderer/lib/monaco/use-model';
import { Separator } from '@renderer/lib/ui/separator';
import { agentConfig } from '@renderer/utils/agentConfig';
import { cn } from '@renderer/utils/utils';
import { AgentStatusIndicator } from '../components/agent-status-indicator';

// ---------------------------------------------------------------------------
// Sortable wrapper — gives any tab item drag-and-drop behaviour
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Conversation tab item
// ---------------------------------------------------------------------------

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
        data-tabid={tab.id}
        className={cn(
          'group relative flex h-full flex-col bg-background-secondary text-sm text-foreground-muted hover:bg-background-secondary-1/40',
          tab.isActive &&
            'bg-background-secondary-1 text-foreground hover:bg-background-secondary-1'
        )}
      >
        <div className="flex h-full items-center gap-1.5 pl-3 pr-1">
          <AgentLogo
            logo={config.logo}
            alt={config.alt}
            isSvg={config.isSvg}
            invertInDark={config.invertInDark}
            className="size-4 shrink-0"
          />
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

// ---------------------------------------------------------------------------
// File tab item
// ---------------------------------------------------------------------------

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
  const modelStatus = useModelStatus(tab.bufferUri);
  const showSpinner = useDelayedBoolean(isMonacoFile && modelStatus === 'loading', 200);

  return (
    <>
      <button
        onClick={onSelect}
        onDoubleClick={onPin}
        title={tab.isPreview ? `${tab.path} (preview — double-click to keep)` : tab.path}
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
          <span className={cn('max-w-[200px] truncate p-1 text-sm', tab.isPreview && 'italic')}>
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

// ---------------------------------------------------------------------------
// Diff tab item
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Main unified tab bar
// ---------------------------------------------------------------------------

export const UnifiedMainTabBar = observer(function UnifiedMainTabBar() {
  const { taskView } = useProvisionedTask();
  const { projectId, taskId } = useTaskViewContext();
  const { tabManager } = taskView;
  const showCommandPalette = useShowModal('commandPaletteModal');

  const resolvedTabs = tabManager.resolvedTabs;
  const tabIds = resolvedTabs.map((t) => (t.kind === 'conversation' ? t.id : t.tabId));

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

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
    const fromIndex = tabIds.indexOf(active.id as string);
    const toIndex = tabIds.indexOf(over.id as string);
    if (fromIndex !== -1 && toIndex !== -1) {
      tabManager.reorderTabs(fromIndex, toIndex);
    }
  }

  return (
    <div className="flex h-[41px] shrink-0 items-center justify-between border-b border-border bg-background-secondary">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={tabIds} strategy={horizontalListSortingStrategy}>
          <div ref={scrollContainerRef} className="flex h-full overflow-x-auto">
            {resolvedTabs.map((tab) => {
              if (tab.kind === 'conversation') {
                return (
                  <SortableTabWrapper key={tab.id} id={tab.id}>
                    <ConversationTabItem
                      tab={tab}
                      onSelect={() => tabManager.setActiveTab(tab.id)}
                      onPin={() => tabManager.openConversation(tab.id)}
                      onClose={() => tabManager.closeTab(tab.id)}
                    />
                  </SortableTabWrapper>
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
                    onClose={() => tabManager.closeTab(tab.tabId)}
                  />
                </SortableTabWrapper>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
      <button
        onClick={() => showCommandPalette({ projectId, taskId })}
        className="flex h-full shrink-0 items-center justify-center px-2 text-foreground-muted hover:text-foreground hover:bg-background-secondary-1/40"
        aria-label="Open command palette"
      >
        <Plus className="size-4" />
      </button>
    </div>
  );
});
