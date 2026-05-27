import { Pencil } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useRef, useState } from 'react';
import AgentLogo from '@renderer/lib/components/agent-logo';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@renderer/lib/ui/context-menu';
import { Separator } from '@renderer/lib/ui/separator';
import { agentConfig } from '@renderer/utils/agentConfig';
import { AgentStatusIndicator } from '../../components/agent-status-indicator';
import { formatConversationTitleForDisplay } from '../../conversations/conversation-title-utils';
import type { ResolvedConversationTab } from '../../tabs/tab-manager-store';
import { TabCloseButton } from './tab-close-button';
import { TabDragPreviewShell, TabItemShell } from './tab-item-shell';
import { TabTitle } from './tab-title';

export const ConversationTabItem = observer(function ConversationTabItem({
  tab,
  onSelect,
  onPin,
  onClose,
  onRenameSubmit,
}: {
  tab: ResolvedConversationTab;
  onSelect: () => void;
  onPin: () => void;
  onClose: () => void;
  onRenameSubmit: (newName: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const pendingRenameRef = useRef(false);
  const committedRef = useRef(false);

  const config = agentConfig[tab.store.data.providerId];
  const title = formatConversationTitleForDisplay(tab.store.data.providerId, tab.store.data.title);
  const rawTitle = tab.store.data.title ?? '';

  const handleRename = useCallback(() => {
    pendingRenameRef.current = true;
  }, []);

  const handleContextMenuOpenChangeComplete = useCallback((open: boolean) => {
    if (!open && pendingRenameRef.current) {
      pendingRenameRef.current = false;
      committedRef.current = false;
      setIsEditing(true);
    }
  }, []);

  const commitRename = (value: string) => {
    if (committedRef.current) return;
    committedRef.current = true;
    const trimmed = value.trim();
    if (trimmed && trimmed !== rawTitle) {
      onRenameSubmit(trimmed);
    }
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div className="flex h-full items-center gap-1.5 bg-background-secondary-1 pr-2 pl-3">
        {config ? (
          <AgentLogo
            logo={config.logo}
            logoDark={config.logoDark}
            alt={config.alt}
            isSvg={config.isSvg}
            invertInDark={config.invertInDark}
            className="size-4 shrink-0"
          />
        ) : null}
        <input
          ref={(el) => {
            el?.focus();
            el?.select();
          }}
          className="max-w-24 rounded bg-background-1 px-1 py-0.5 text-sm text-foreground ring-1 ring-foreground/20 outline-none focus:ring-foreground/40"
          defaultValue={rawTitle}
          onBlur={(e) => commitRename(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename(e.currentTarget.value);
            else if (e.key === 'Escape') {
              committedRef.current = true;
              setIsEditing(false);
            }
          }}
        />
        <Separator orientation="vertical" />
      </div>
    );
  }

  return (
    <ContextMenu onOpenChangeComplete={handleContextMenuOpenChangeComplete}>
      <ContextMenuTrigger>
        <TabItemShell
          tabId={tab.tabId}
          isActive={tab.isActive}
          title={tab.isPreview ? `${title} (preview — double-click to keep)` : title}
          onSelect={onSelect}
          onPin={onPin}
          onClose={onClose}
        >
          {config ? (
            <AgentLogo
              logo={config.logo}
              logoDark={config.logoDark}
              alt={config.alt}
              isSvg={config.isSvg}
              invertInDark={config.invertInDark}
              className="size-4 shrink-0"
            />
          ) : null}
          <TabTitle isActive={tab.isActive} isPreview={tab.isPreview} maxWidth="max-w-24">
            {title}
          </TabTitle>
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
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={handleRename}>
          <Pencil className="size-4" />
          Rename
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});

export const ConversationTabDragPreview = observer(function ConversationTabDragPreview({
  tab,
}: {
  tab: ResolvedConversationTab;
}) {
  const config = agentConfig[tab.store.data.providerId];
  const label = formatConversationTitleForDisplay(tab.store.data.providerId, tab.store.data.title);
  return (
    <TabDragPreviewShell>
      {config ? (
        <AgentLogo
          logo={config.logo}
          logoDark={config.logoDark}
          alt={config.alt}
          isSvg={config.isSvg}
          invertInDark={config.invertInDark}
          className="size-4 shrink-0"
        />
      ) : null}
      <span className="max-w-[200px] truncate">{label}</span>
    </TabDragPreviewShell>
  );
});
