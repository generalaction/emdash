import { Columns2, LayoutGrid, MessageSquare, Pencil, Rows2, Rows3, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import type { AgentLayoutMode } from '@shared/view-state';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { PaneSizingProvider } from '@renderer/lib/pty/pane-sizing-context';
import { PtyPane } from '@renderer/lib/pty/pty-pane';
import { Button } from '@renderer/lib/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@renderer/lib/ui/context-menu';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@renderer/lib/ui/resizable';
import { agentConfig } from '@renderer/utils/agentConfig';
import { cn } from '@renderer/utils/utils';
import { formatConversationTitleForDisplay } from './conversation-title-utils';

const TileCell = observer(function TileCell({ conversationId }: { conversationId: string }) {
  const { projectId, taskId } = useTaskViewContext();
  const provisioned = useProvisionedTask();
  const { taskView } = provisioned;
  const conversation = provisioned.conversations.conversations.get(conversationId);
  const showRenameConversationModal = useShowModal('renameConversationModal');

  if (!conversation) {
    return (
      <div className="flex h-full flex-col bg-background">
        <div className="flex h-7 shrink-0 items-center justify-between border-b border-border bg-background-secondary px-2">
          <span className="text-xs text-foreground-muted">Missing conversation</span>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => taskView.removeConversationFromLayout(conversationId)}
            aria-label="Remove cell"
          >
            <X className="size-3.5" />
          </Button>
        </div>
        <div className="flex flex-1 items-center justify-center text-xs text-foreground-muted">
          Conversation no longer exists
        </div>
      </div>
    );
  }

  const config = agentConfig[conversation.data.providerId];
  const title = formatConversationTitleForDisplay(
    conversation.data.providerId,
    conversation.data.title
  );
  const session = provisioned.conversations.sessions.get(conversationId) ?? null;
  const sessionId = session?.sessionId ?? null;
  const remoteConnectionId = provisioned.workspace.sshConnectionId;
  const onEnterPress = remoteConnectionId
    ? undefined
    : () => {
        conversation.setWorking();
        void provisioned.conversations.touchConversation(conversationId);
      };
  const onInterruptPress = () => conversation.clearWorking();

  return (
    <div className="flex h-full flex-col bg-background">
      <ContextMenu>
        <ContextMenuTrigger className="flex h-7 shrink-0 border-b border-border bg-background-secondary">
          <div className="flex h-full w-full items-center justify-between gap-2 px-2">
            <div className="flex min-w-0 items-center gap-1.5">
              {config ? (
                <AgentLogo
                  logo={config.logo}
                  alt={config.alt}
                  isSvg={config.isSvg}
                  invertInDark={config.invertInDark}
                  className="size-3.5 shrink-0"
                />
              ) : null}
              <span className="truncate text-xs">{title}</span>
            </div>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => taskView.removeConversationFromLayout(conversationId)}
              aria-label={`Remove ${title} from layout`}
              title="Remove from layout"
            >
              <X className="size-3.5" />
            </Button>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            onClick={() =>
              showRenameConversationModal({
                projectId,
                taskId,
                conversationId,
                currentName: conversation.data.title,
              })
            }
          >
            <Pencil className="size-4" />
            Rename
          </ContextMenuItem>
          <ContextMenuItem onClick={() => taskView.removeConversationFromLayout(conversationId)}>
            <X className="size-4" />
            Remove from layout
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <PaneSizingProvider
        paneId={`agent-cell-${conversationId}`}
        sessionIds={sessionId ? [sessionId] : []}
      >
        <div className="relative flex min-h-0 flex-1">
          {sessionId && session?.status === 'ready' && session.pty ? (
            <PtyPane
              sessionId={sessionId}
              pty={session.pty}
              className="h-full w-full"
              onEnterPress={onEnterPress}
              onInterruptPress={onInterruptPress}
              mapShiftEnterToCtrlJ
              remoteConnectionId={remoteConnectionId}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-foreground-muted">
              Connecting…
            </div>
          )}
        </div>
      </PaneSizingProvider>
    </div>
  );
});

export const LAYOUT_MODE_ITEMS: { id: AgentLayoutMode; label: string; Icon: typeof Rows3 }[] = [
  { id: 'tabs', label: 'Tabs', Icon: Rows3 },
  { id: 'side-by-side', label: 'Side by side', Icon: Columns2 },
  { id: 'stacked', label: 'Stacked', Icon: Rows2 },
  { id: 'tile', label: 'Tile', Icon: LayoutGrid },
];

function ResizableCell({
  index,
  count,
  defaultSize,
  children,
}: {
  index: number;
  count: number;
  defaultSize?: string;
  children: React.ReactNode;
}) {
  return (
    <>
      {index > 0 && <ResizableHandle />}
      <ResizablePanel defaultSize={defaultSize ?? `${Math.floor(100 / count)}%`} minSize="10%">
        {children}
      </ResizablePanel>
    </>
  );
}

const LinearLayout = observer(function LinearLayout({
  orientation,
  ids,
  taskId,
}: {
  orientation: 'horizontal' | 'vertical';
  ids: string[];
  taskId: string;
}) {
  return (
    <ResizablePanelGroup
      orientation={orientation}
      id={`agent-grid-${taskId}-${orientation}-${ids.length}`}
    >
      {ids.map((id, idx) => (
        <ResizableCell key={id} index={idx} count={ids.length}>
          <TileCell conversationId={id} />
        </ResizableCell>
      ))}
    </ResizablePanelGroup>
  );
});

const TileLayout = observer(function TileLayout({
  ids,
  taskId,
}: {
  ids: string[];
  taskId: string;
}) {
  // 2-col flow: rows of up to 2 cells. Last row may have 1 cell (full width).
  const rows: string[][] = [];
  for (let i = 0; i < ids.length; i += 2) {
    rows.push(ids.slice(i, i + 2));
  }
  return (
    <ResizablePanelGroup orientation="vertical" id={`agent-grid-${taskId}-tile-${ids.length}`}>
      {rows.map((row, rowIdx) => (
        <ResizableCell key={`row-${rowIdx}`} index={rowIdx} count={rows.length}>
          {row.length === 1 ? (
            <TileCell conversationId={row[0]!} />
          ) : (
            <ResizablePanelGroup
              orientation="horizontal"
              id={`agent-grid-${taskId}-tile-row-${rowIdx}`}
            >
              {row.map((id, colIdx) => (
                <ResizableCell key={id} index={colIdx} count={row.length}>
                  <TileCell conversationId={id} />
                </ResizableCell>
              ))}
            </ResizablePanelGroup>
          )}
        </ResizableCell>
      ))}
    </ResizablePanelGroup>
  );
});

export const ConversationsGridPanel = observer(function ConversationsGridPanel() {
  const { taskId } = useTaskViewContext();
  const provisioned = useProvisionedTask();
  const { taskView } = provisioned;
  const mode = taskView.agentLayoutMode;
  const slots = taskView.agentSlots;

  if (slots.length === 0) {
    return (
      <div className="relative flex h-full flex-col">
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            icon={<MessageSquare className="h-5 w-5 text-muted-foreground" />}
            label="No conversations in layout"
            description="Open a conversation from the sidebar, or switch back to Tabs."
          />
        </div>
      </div>
    );
  }

  let body: React.ReactNode;
  if (mode === 'side-by-side') {
    body = <LinearLayout orientation="horizontal" ids={slots} taskId={taskId} />;
  } else if (mode === 'stacked') {
    body = <LinearLayout orientation="vertical" ids={slots} taskId={taskId} />;
  } else {
    body = <TileLayout ids={slots} taskId={taskId} />;
  }

  return (
    <div className="relative flex h-full flex-col">
      <div className={cn('flex min-h-0 flex-1')}>{body}</div>
    </div>
  );
});
