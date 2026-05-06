import { Loader2, Plus, X } from 'lucide-react';
import { observer, Observer } from 'mobx-react-lite';
import { asMounted, getProjectStore } from '@renderer/features/projects/stores/project-selectors';
import { type ConversationStore } from '@renderer/features/tasks/conversations/conversation-manager';
import { formatConversationTitleForDisplay } from '@renderer/features/tasks/conversations/conversation-title-utils';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { FileIcon } from '@renderer/lib/editor/file-icon';
import type { EditorTab } from '@renderer/lib/editor/types';
import { useDelayedBoolean } from '@renderer/lib/hooks/use-delay-boolean';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { useModelStatus } from '@renderer/lib/monaco/use-model';
import { Separator } from '@renderer/lib/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { agentConfig } from '@renderer/utils/agentConfig';
import { cn } from '@renderer/utils/utils';
import { AgentStatusIndicator } from '../components/agent-status-indicator';

type RichEditorTab = EditorTab & { isDirty: boolean; bufferUri: string };

// ---------------------------------------------------------------------------
// Conversation tab item
// ---------------------------------------------------------------------------

const ConversationTabItem = observer(function ConversationTabItem({
  conversation,
  isActive,
  onSelect,
  onRemove,
}: {
  conversation: ConversationStore;
  isActive: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const config = agentConfig[conversation.data.providerId];
  const title = formatConversationTitleForDisplay(
    conversation.data.providerId,
    conversation.data.title
  );

  return (
    <>
      <button
        onClick={onSelect}
        className={cn(
          'group relative flex h-full flex-col bg-background-secondary text-sm text-foreground-muted hover:bg-background-secondary-1/40',
          isActive && 'bg-background-secondary-1 text-foreground hover:bg-background-secondary-1'
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
          <span className="max-w-24 truncate p-1">{title}</span>
          <div className="relative flex size-5 shrink-0 items-center justify-center">
            <span className="transition-opacity group-hover:opacity-0">
              <AgentStatusIndicator status={conversation.indicatorStatus} disableTooltip />
            </span>
            <button
              className="absolute inset-0 flex items-center justify-center rounded-md text-foreground-muted opacity-0 hover:bg-background-2 group-hover:opacity-100 transition-opacity"
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
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
  isActive,
  onSelect,
  onClose,
}: {
  tab: RichEditorTab;
  isActive: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  const fileName = tab.path.split('/').pop() ?? 'Untitled';
  const isMonacoFile = tab.kind === 'text' || tab.kind === 'markdown' || tab.kind === 'svg';
  const modelStatus = useModelStatus(tab.bufferUri);
  const showSpinner = useDelayedBoolean(isMonacoFile && modelStatus === 'loading', 200);

  return (
    <>
      <button
        onClick={onSelect}
        title={tab.isPreview ? `${tab.path} (preview — double-click to keep)` : tab.path}
        className={cn(
          'group relative flex h-full flex-col bg-background-secondary text-sm hover:bg-muted',
          isActive && 'bg-background-secondary-1 [box-shadow:inset_0_1px_0_var(--primary)]'
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
// Main unified tab bar
// ---------------------------------------------------------------------------

export const UnifiedMainTabBar = observer(function UnifiedMainTabBar() {
  const { projectId, taskId } = useTaskViewContext();
  const provisioned = useProvisionedTask();
  const { taskView } = provisioned;
  const conversationTabs = taskView.conversationTabs;
  const editorView = taskView.editorView;
  const showCreateConversationModal = useShowModal('createConversationModal');
  const mountedProject = asMounted(getProjectStore(projectId));
  const connectionId =
    mountedProject?.data.type === 'ssh' ? mountedProject.data.connectionId : undefined;

  const conversationTabList = conversationTabs.tabs;
  const fileTabList = editorView.tabs;

  if (conversationTabList.length === 0 && fileTabList.length === 0) {
    return (
      <div className="flex h-[41px] shrink-0 items-center border-b border-border bg-background-secondary px-2">
        <span className="text-xs text-foreground-passive">No open tabs</span>
      </div>
    );
  }

  return (
    <div className="flex h-[41px] shrink-0 items-center justify-between border-b border-border bg-background-secondary">
      <div className="flex h-full overflow-x-auto">
        {conversationTabList.map((conversation) => (
          <Observer key={conversation.data.id}>
            {() => (
              <ConversationTabItem
                conversation={conversation}
                isActive={
                  taskView.view === 'agents' &&
                  conversationTabs.activeTabId === conversation.data.id
                }
                onSelect={() => {
                  conversationTabs.setActiveTab(conversation.data.id);
                  taskView.setView('agents');
                }}
                onRemove={() => conversationTabs.removeTab(conversation.data.id)}
              />
            )}
          </Observer>
        ))}
        {fileTabList.map((tab) => (
          <Observer key={tab.tabId}>
            {() => (
              <FileTabItem
                tab={tab}
                isActive={taskView.view === 'editor' && editorView.activeTabId === tab.tabId}
                onSelect={() => {
                  editorView.setActiveTab(tab.tabId);
                  taskView.setView('editor');
                }}
                onClose={() => editorView.removeTab(tab.tabId)}
              />
            )}
          </Observer>
        ))}
      </div>
      <div className="shrink-0">
        <Tooltip>
          <TooltipTrigger>
            <button
              className="flex size-10 items-center justify-center border-l text-foreground-muted hover:bg-background hover:text-foreground"
              onClick={() =>
                showCreateConversationModal({
                  connectionId,
                  projectId,
                  taskId,
                  onSuccess: ({ conversationId }) => {
                    conversationTabs.setActiveTab(conversationId);
                    taskView.setView('agents');
                  },
                })
              }
            >
              <Plus className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>New conversation</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
});
