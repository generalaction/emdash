import { Loader2, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { formatConversationTitleForDisplay } from '@renderer/features/tasks/conversations/conversation-title-utils';
import type {
  ResolvedConversationTab,
  ResolvedFileTab,
} from '@renderer/features/tasks/stores/tab-manager-store';
import { useProvisionedTask } from '@renderer/features/tasks/task-view-context';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { FileIcon } from '@renderer/lib/editor/file-icon';
import { useDelayedBoolean } from '@renderer/lib/hooks/use-delay-boolean';
import { useModelStatus } from '@renderer/lib/monaco/use-model';
import { Separator } from '@renderer/lib/ui/separator';
import { agentConfig } from '@renderer/utils/agentConfig';
import { cn } from '@renderer/utils/utils';
import { AgentStatusIndicator } from '../components/agent-status-indicator';

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
// Main unified tab bar
// ---------------------------------------------------------------------------

export const UnifiedMainTabBar = observer(function UnifiedMainTabBar() {
  const { taskView } = useProvisionedTask();
  const { tabManager } = taskView;

  const resolvedTabs = tabManager.resolvedTabs;

  return (
    <div className="flex h-[41px] shrink-0 items-center justify-between border-b border-border bg-background-secondary">
      <div className="flex h-full overflow-x-auto">
        {resolvedTabs.map((tab) => {
          if (tab.kind === 'conversation') {
            return (
              <ConversationTabItem
                key={tab.id}
                tab={tab}
                onSelect={() => tabManager.setActiveTab(tab.id)}
                onPin={() => tabManager.openConversation(tab.id)}
                onClose={() => tabManager.closeTab(tab.id)}
              />
            );
          }
          return (
            <FileTabItem
              key={tab.tabId}
              tab={tab}
              onSelect={() => tabManager.setActiveTab(tab.tabId)}
              onPin={() => tabManager.pinTab(tab.tabId)}
              onClose={() => tabManager.closeTab(tab.tabId)}
            />
          );
        })}
      </div>
    </div>
  );
});
