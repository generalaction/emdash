import { useQueryClient } from '@tanstack/react-query';
import { EllipsisIcon, Link2Icon, MessageSquareIcon, Trash2Icon, WifiOffIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import { Button } from '@core/primitives/ui/browser/button';
import { cn } from '@core/primitives/ui/browser/cn';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@core/primitives/ui/browser/dropdown-menu';
import { SearchInput } from '@core/primitives/ui/browser/search-input';
import { Spinner } from '@core/primitives/ui/browser/spinner';
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
import { useLocalWorkspaces, useMachineWorkspaces } from '../use-machine-workspaces';

/**
 * The machine page's Conversations tab (spec §8): every cached conversation record of
 * this host — task-linked and orphaned alike — with per-record link and delete
 * affordances. The list reads this device's registry cache, so it keeps serving
 * (labeled) while the host is unreachable.
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
  const isLocal = scope.kind === 'local';
  const remoteWorkspaces = useMachineWorkspaces(
    isLocal ? undefined : scope.connectionId,
    !isLocal && hostReachable
  );
  const localWorkspaces = useLocalWorkspaces(isLocal);
  const workspaceGroups = (isLocal ? localWorkspaces : remoteWorkspaces).data;
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

  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-md border border-border bg-background-1">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
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
      <div className="min-h-60 flex-1 overflow-y-auto">
        {conversationsQuery.isLoading ? (
          <div className="flex h-40 items-center justify-center gap-2 text-sm text-foreground-muted">
            <Spinner className="size-4" />
            Loading conversations
          </div>
        ) : conversationsQuery.isError ? (
          <div className="flex h-40 flex-col items-center justify-center gap-1 text-sm">
            <div className="text-foreground-destructive">Could not load conversations.</div>
            <div className="max-w-md text-center text-xs text-foreground-muted">
              {conversationsQuery.error instanceof Error
                ? conversationsQuery.error.message
                : String(conversationsQuery.error)}
            </div>
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-sm text-foreground-muted">
            {items.length === 0
              ? 'No conversations on this machine.'
              : 'No conversations match the current search.'}
          </div>
        ) : (
          visibleItems.map((item) => (
            <ConversationRow
              key={item.conversation.id}
              item={item}
              busy={busyId === item.conversation.id}
              onLink={() => void linkConversation(item)}
              onDelete={() => void deleteConversation(item)}
            />
          ))
        )}
      </div>
    </section>
  );
}

function ConversationRow({
  item,
  busy,
  onLink,
  onDelete,
}: {
  item: MachineConversationItem;
  busy: boolean;
  onLink: () => void;
  onDelete: () => void;
}) {
  const { conversation } = item;
  const subtitle = [conversation.provider, conversation.workspacePath].filter(Boolean).join(' · ');

  return (
    <div
      className={cn(
        'flex min-h-12 items-center gap-3 border-b border-border px-3 py-2 text-sm',
        item.pendingRemoval && 'opacity-60'
      )}
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-background-2 text-foreground-muted">
        <MessageSquareIcon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-foreground">{conversation.title || 'Untitled'}</div>
        <div className="truncate text-xs text-foreground-passive">{subtitle}</div>
      </div>
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
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={`Actions for ${conversation.title || 'conversation'}`}
              disabled={busy || item.pendingRemoval}
            />
          }
        >
          {busy ? <Spinner className="size-3.5" /> : <EllipsisIcon className="size-3.5" />}
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
    </div>
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
