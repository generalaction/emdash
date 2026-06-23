import { observer } from 'mobx-react-lite';
import { useCallback, useRef, useState } from 'react';
import type { ResolvedTab } from '@renderer/features/tabs/core/tab-provider';
import { TabCloseButton } from '@renderer/features/tabs/tab-bar/tab-close-button';
import { TabDragPreviewShell, TabItemShell } from '@renderer/features/tabs/tab-bar/tab-item-shell';
import { TabTitle } from '@renderer/features/tabs/tab-bar/tab-title';
import { AgentIcon } from '@renderer/lib/components/agent-icon';
import { MAX_CONVERSATION_TITLE_LENGTH } from '@shared/core/conversations/conversations';
import { AgentStatusIndicator } from '../components/agent-status-indicator';
import type { ConversationResolvedData } from './conversation-tab-provider';
import { formatConversationTitleForDisplay } from './conversation-title-utils';

export const ConversationTabItem = observer(function ConversationTabItem({
  tab,
  onSelect,
  onPin,
  onClose,
  onRenameSubmit,
  renameRef,
}: {
  tab: ResolvedTab<ConversationResolvedData>;
  onSelect: () => void;
  onPin: () => void;
  onClose: () => void;
  onRenameSubmit: (newName: string) => void;
  /**
   * Mutable ref that the caller populates with a `startRename` callback.
   * Allows external triggers (e.g. context-menu commands) to start inline editing.
   */
  renameRef?: React.MutableRefObject<(() => void) | null>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const committedRef = useRef(false);

  const title = formatConversationTitleForDisplay(tab.store.data.providerId, tab.store.data.title);
  const rawTitle = tab.store.data.title ?? '';
  const renameInputWidth = `${Math.min(Math.max(rawTitle.length || title.length, 8), 24)}ch`;

  const startRename = useCallback(() => {
    committedRef.current = false;
    window.setTimeout(() => setIsEditing(true), 0);
  }, []);

  // Keep the ref in sync so context menu commands can trigger rename.
  if (renameRef) renameRef.current = startRename;

  const handleDoubleClick = useCallback(() => {
    if (tab.isPreview) onPin();
    startRename();
  }, [startRename, onPin, tab.isPreview]);

  const handleRenameInputRef = useCallback((input: HTMLInputElement | null) => {
    input?.focus();
    input?.select();
  }, []);

  const commitRename = (value: string) => {
    if (committedRef.current) return;
    committedRef.current = true;
    const trimmed = value.trim().slice(0, MAX_CONVERSATION_TITLE_LENGTH);
    if (trimmed && trimmed !== rawTitle) {
      onRenameSubmit(trimmed);
    }
    setIsEditing(false);
  };

  return (
    <TabItemShell
      tabId={tab.tabId}
      isActive={tab.isActive}
      title={tab.isPreview ? `${title} (preview — double-click to keep and rename)` : title}
      onSelect={onSelect}
      onPin={onPin}
      onDoubleClick={handleDoubleClick}
      onClose={onClose}
    >
      <AgentIcon id={tab.store.data.providerId} size={16} />
      {isEditing ? (
        <input
          ref={handleRenameInputRef}
          className="my-1 min-w-0 rounded bg-background-1 px-1.5 text-sm text-foreground ring-1 ring-foreground/20 outline-none focus:ring-foreground/40"
          style={{ width: renameInputWidth }}
          defaultValue={rawTitle}
          maxLength={MAX_CONVERSATION_TITLE_LENGTH}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onBlur={(e) => commitRename(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') commitRename(e.currentTarget.value);
            else if (e.key === 'Escape') {
              committedRef.current = true;
              setIsEditing(false);
            }
          }}
        />
      ) : (
        <TabTitle isActive={tab.isActive} isPreview={tab.isPreview} maxWidth="max-w-24">
          {title}
        </TabTitle>
      )}
      <TabCloseButton
        onClose={onClose}
        ariaLabel={`Close ${title}`}
        statusIndicator={
          <span className="transition-opacity group-hover:opacity-0">
            <AgentStatusIndicator status={tab.store.indicatorStatus} disableTooltip />
          </span>
        }
      />
    </TabItemShell>
  );
});

export const ConversationTabDragPreview = observer(function ConversationTabDragPreview({
  tab,
}: {
  tab: ResolvedTab<ConversationResolvedData>;
}) {
  const label = formatConversationTitleForDisplay(tab.store.data.providerId, tab.store.data.title);
  return (
    <TabDragPreviewShell>
      {tab.store.data.providerId ? (
        <AgentIcon id={tab.store.data.providerId} size={16} className="shrink-0" />
      ) : null}
      <span className="max-w-[200px] truncate">{label}</span>
    </TabDragPreviewShell>
  );
});
