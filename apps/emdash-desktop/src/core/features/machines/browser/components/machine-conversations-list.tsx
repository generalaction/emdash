import { ColumnList, ColumnListCell, type ColumnListColumn } from '@emdash/ui/react/components';
import { Spinner } from '@emdash/ui/react/primitives';
import { useQueryClient } from '@tanstack/react-query';
import { EllipsisIcon, Link2Icon, MessageSquareIcon, Trash2Icon, WifiOffIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import { cn } from '@core/primitives/styling/browser/cn';
import { Button } from '@core/primitives/ui/browser/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@core/primitives/ui/browser/dropdown-menu';
import { SearchInput } from '@core/primitives/ui/browser/search-input';
import { toast } from '@core/primitives/ui/browser/use-toast';
import {
  joinMachineConversationRows,
  type MachineConversationItem,
} from '../machine-conversation-rows';
import {
  deleteMachineConversation,
  linkMachineConversation,
  machineConversationsQueryKey,
  useMachineConversations,
  type MachineConversationsScope,
} from '../use-machine-conversations';
import { useWorkspaceGroups } from '../use-machine-workspaces';

type ConversationListRow = {
  item: MachineConversationItem;
  busy: boolean;
  onLink: () => void;
  onDelete: () => void;
};

const CONVERSATION_COLUMNS: ColumnListColumn<ConversationListRow>[] = [
  {
    id: 'icon',
    width: '2.25rem',
    cell: ({ item }) => (
      <span
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-md bg-background-2 text-foreground-muted',
          item.pendingRemoval && 'opacity-60'
        )}
      >
        <MessageSquareIcon className="size-4" />
      </span>
    ),
  },
  {
    id: 'title',
    width: 'minmax(0, 1fr)',
    cell: ({ item }) => (
      <ColumnListCell
        className={cn(item.pendingRemoval && 'opacity-60')}
        primary={item.conversation.title || 'Untitled'}
        secondary={
          [item.conversation.provider, item.conversation.workspacePath]
            .filter(Boolean)
            .join(' · ') || '-'
        }
      />
    ),
  },
  {
    id: 'status',
    width: 'max-content',
    align: 'center',
    cell: ({ item }) => <ConversationStatusCell item={item} />,
  },
  {
    id: 'actions',
    width: '2.5rem',
    align: 'center',
    cell: (row) => <ConversationActionsCell row={row} />,
  },
];

/**
 * Every cached conversation record of a host (spec §8) — task-linked and
 * orphaned alike — with per-record link and delete affordances. The list reads
 * this device's registry cache, so it keeps serving (labeled) while the host
 * is unreachable.
 */
export function MachineConversationsList({
  scope,
  hostReachable,
}: {
  scope: MachineConversationsScope;
  hostReachable: boolean;
}) {
  const queryClient = useQueryClient();
  const conversationsQuery = useMachineConversations(scope);
  const openLinkModal = useOpenModal('linkConversationModal');
  const openConfirm = useOpenModal('confirmActionModal');
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  // Dangling-path detection is a client presentation over workspace observations
  // (spec §7.5) — only asserted once the workspace listing for this host has loaded.
  // The mirror serves cached rows even while the host is unreachable, so the
  // subscription is always on; missing workspaces stay listed with their last
  // observation instead of being falsely reported as dangling.
  const workspaceGroups = useWorkspaceGroups(
    scope.kind === 'local' ? { kind: 'local' } : { kind: 'machine', machineId: scope.connectionId },
    true
  ).data;
  const knownWorkspacePaths = useMemo(
    () =>
      workspaceGroups === undefined
        ? undefined
        : new Set(
            workspaceGroups.flatMap((group) => group.workspaces.map((workspace) => workspace.path))
          ),
    [workspaceGroups]
  );

  const items = useMemo(
    () =>
      joinMachineConversationRows({
        conversations: conversationsQuery.data ?? [],
        knownWorkspacePaths,
      }),
    [conversationsQuery.data, knownWorkspacePaths]
  );
  const visibleItems = useMemo(() => filterItems(items, search), [items, search]);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: machineConversationsQueryKey(scope) });

  const linkConversation = async (item: MachineConversationItem) => {
    const outcome = await openLinkModal({
      connectionId: scope.kind === 'remote' ? scope.connectionId : null,
      conversationTitle: item.conversation.title,
    });
    if (!outcome.success) return;
    setBusyId(item.conversation.id);
    try {
      await linkMachineConversation({
        conversationId: item.conversation.id,
        projectId: outcome.data.projectId,
        taskId: outcome.data.taskId,
      });
      await refresh();
    } catch (error) {
      toast({
        title: 'Could not link conversation',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setBusyId(null);
    }
  };

  const deleteConversation = async (item: MachineConversationItem) => {
    const outcome = await openConfirm({
      title: 'Delete conversation?',
      description: `This permanently deletes “${item.conversation.title}” from its machine. If the machine is offline, the deletion runs when it reconnects.`,
      confirmLabel: 'Delete',
      variant: 'destructive',
    });
    if (!outcome.success) return;
    setBusyId(item.conversation.id);
    try {
      await deleteMachineConversation(item.conversation.id);
      await refresh();
    } catch (error) {
      toast({
        title: 'Could not delete conversation',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setBusyId(null);
    }
  };

  const rows: ConversationListRow[] = visibleItems.map((item) => ({
    item,
    busy: busyId === item.conversation.id,
    onLink: () => void linkConversation(item),
    onDelete: () => void deleteConversation(item),
  }));

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          containerClassName="min-w-48 flex-1"
          className="h-8"
          placeholder="Search conversations, tasks, workspaces..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <span className="text-xs text-foreground-passive tabular-nums">
          {items.length} {items.length === 1 ? 'conversation' : 'conversations'}
        </span>
        {!hostReachable && (
          <span className="inline-flex items-center gap-1 rounded-full border border-border-warning px-1.5 py-0.5 text-[10px] tracking-wide text-foreground-warning uppercase">
            <WifiOffIcon className="size-3" />
            Offline — showing cached records
          </span>
        )}
      </div>
      {conversationsQuery.isLoading ? (
        <ConversationsLoadingState />
      ) : conversationsQuery.isError ? (
        <ConversationsErrorState error={conversationsQuery.error} />
      ) : (
        <ColumnList
          items={rows}
          columns={CONVERSATION_COLUMNS}
          getItemKey={(row) => row.item.conversation.id}
          emptySlot={<ConversationsEmptyState searching={items.length > 0} />}
        />
      )}
    </div>
  );
}

function ConversationStatusCell({ item }: { item: MachineConversationItem }) {
  const { conversation } = item;
  return (
    <div className={cn('flex items-center gap-2', item.pendingRemoval && 'opacity-60')}>
      {item.linked ? (
        <span
          className="inline-flex max-w-56 shrink-0 items-center gap-1 rounded-full border border-border/70 px-1.5 py-0.5 text-[10px] tracking-wide text-foreground-muted uppercase"
          title={
            conversation.projectName
              ? `${conversation.projectName} / ${conversation.taskName ?? conversation.taskId}`
              : undefined
          }
        >
          <Link2Icon className="size-3" />
          <span className="truncate normal-case">
            {conversation.taskName ?? conversation.taskId}
          </span>
        </span>
      ) : (
        <Pill tone="warning">Not linked</Pill>
      )}
      {item.missing && <Pill tone="destructive">Missing on host</Pill>}
      {item.dangling && !item.missing && <Pill tone="warning">Workspace removed</Pill>}
      {item.pendingRemoval && (
        <Pill tone="warning" pulse>
          Removal pending…
        </Pill>
      )}
    </div>
  );
}

function ConversationActionsCell({ row }: { row: ConversationListRow }) {
  const { item, busy, onLink, onDelete } = row;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={`Actions for ${item.conversation.title || 'conversation'}`}
            disabled={busy || item.pendingRemoval}
          />
        }
      >
        {busy ? <Spinner size="sm" /> : <EllipsisIcon className="size-3.5" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onLink}>
          <Link2Icon />
          {item.linked ? 'Link to another task…' : 'Link to a task…'}
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onClick={onDelete}>
          <Trash2Icon />
          Delete…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Pill({
  children,
  tone,
  pulse,
}: {
  children: React.ReactNode;
  tone: 'warning' | 'destructive';
  pulse?: boolean;
}) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] tracking-wide uppercase',
        tone === 'warning' && 'border-border-warning text-foreground-warning',
        tone === 'destructive' && 'border-border-destructive text-foreground-destructive',
        pulse && 'animate-pulse'
      )}
    >
      {children}
    </span>
  );
}

function ConversationsLoadingState() {
  return (
    <div className="flex h-40 items-center justify-center gap-2 text-sm text-foreground-muted">
      <Spinner size="sm" />
      Loading conversations
    </div>
  );
}

function ConversationsErrorState({ error }: { error: unknown }) {
  return (
    <div className="flex h-40 flex-col items-center justify-center gap-1 text-sm">
      <div className="text-foreground-destructive">Could not load conversations.</div>
      <div className="max-w-md text-center text-xs text-foreground-muted">
        {error instanceof Error ? error.message : String(error)}
      </div>
    </div>
  );
}

function ConversationsEmptyState({ searching }: { searching: boolean }) {
  return (
    <div className="flex h-40 items-center justify-center text-sm text-foreground-muted">
      {searching
        ? 'No conversations match the current search.'
        : 'No conversations on this machine.'}
    </div>
  );
}

function filterItems(items: MachineConversationItem[], search: string): MachineConversationItem[] {
  const query = search.trim().toLowerCase();
  if (!query) return items;
  return items.filter((item) =>
    [
      item.conversation.title,
      item.conversation.provider ?? '',
      item.conversation.workspacePath ?? '',
      item.conversation.taskName ?? '',
      item.conversation.projectName ?? '',
    ].some((value) => value.toLowerCase().includes(query))
  );
}
