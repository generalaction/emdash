import { ExternalLink, MessageSquare, Send } from 'lucide-react';
import { useMemo } from 'react';
import { rpc } from '@renderer/lib/ipc';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@renderer/lib/ui/context-menu';
import { MarkdownRenderer } from '@renderer/lib/ui/markdown-renderer';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import {
  isAddressablePullRequestComment,
  sortPullRequestConversationItems,
  type AddressablePullRequestComment,
  type PullRequestConversationItem,
} from './pull-request-conversation';

function commentAuthorLabel(comment: PullRequestConversationItem): string {
  return comment.author?.displayName ?? comment.author?.userName ?? 'Unknown author';
}

function commentLocationLabel(comment: PullRequestConversationItem): string | null {
  if (!comment.path) return null;
  return comment.line ? `${comment.path}:${comment.line}` : comment.path;
}

function isBotAuthor(comment: PullRequestConversationItem): boolean {
  return comment.author?.userName.endsWith('[bot]') ?? false;
}

function CommentItem({
  comment,
  onAddressInActiveChat,
  onAddressInNewChat,
}: {
  comment: PullRequestConversationItem;
  onAddressInActiveChat?: (comment: AddressablePullRequestComment) => void;
  onAddressInNewChat?: (comment: AddressablePullRequestComment) => void;
}) {
  const location = commentLocationLabel(comment);
  const author = commentAuthorLabel(comment);
  const avatarRadiusClass = isBotAuthor(comment) ? 'rounded' : 'rounded-full';
  const addressable = isAddressablePullRequestComment(comment);
  const canAddressInActiveChat = addressable && !!onAddressInActiveChat;
  const canAddressInNewChat = addressable && !!onAddressInNewChat;
  const content = (
    <div className="group relative flex w-full min-w-0 gap-2 rounded-md px-3 py-2 text-left hover:bg-background-1">
      {comment.author?.avatarUrl ? (
        <img
          src={comment.author.avatarUrl}
          alt={author}
          className={cn('mt-0.5 size-5 shrink-0', avatarRadiusClass)}
        />
      ) : (
        <div
          className={cn(
            'mt-0.5 flex size-5 shrink-0 items-center justify-center bg-background-2 text-foreground-muted',
            avatarRadiusClass
          )}
        >
          <MessageSquare className="size-3" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-foreground-muted">
          <span className="truncate font-medium text-foreground">{author}</span>
          <span className="shrink-0 text-foreground-passive">/</span>
          <RelativeTime compact value={comment.createdAt} className="shrink-0" />
          {comment.isResolved && (
            <>
              <span className="shrink-0 text-foreground-passive">/</span>
              <span className="shrink-0 text-foreground-passive">Resolved</span>
            </>
          )}
        </div>
        {location && (
          <div className="mt-0.5 truncate font-mono text-[11px] text-foreground-passive">
            {location}
          </div>
        )}
        <div
          className={cn(
            'mt-1 break-words text-xs leading-relaxed text-foreground-muted [&_*:last-child]:mb-0 [&_p]:mb-1.5',
            comment.isOutdated && 'text-foreground-passive'
          )}
        >
          <MarkdownRenderer content={comment.body} variant="compact" allowHtml />
        </div>
      </div>
      <div className="absolute top-2 right-3 hidden items-center gap-1 group-hover:flex">
        {canAddressInActiveChat && (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  className="flex items-center gap-1 rounded bg-background-1 px-1.5 py-0.5 text-xs text-foreground-muted hover:text-foreground"
                  onClick={() => onAddressInActiveChat(comment)}
                >
                  <Send className="size-3" />
                  Address comment
                </button>
              }
            />
            <TooltipContent>Send this comment to active chat</TooltipContent>
          </Tooltip>
        )}
        <button
          type="button"
          className="flex items-center justify-center rounded bg-background-1 px-1 py-0.5 text-foreground-muted hover:text-foreground"
          onClick={() => void rpc.app.openExternal(comment.url)}
        >
          <ExternalLink className="size-3.5" />
        </button>
      </div>
    </div>
  );

  if (!addressable) return content;

  return (
    <ContextMenu>
      <ContextMenuTrigger>{content}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          disabled={!canAddressInActiveChat}
          onClick={() => {
            if (canAddressInActiveChat) onAddressInActiveChat(comment);
          }}
        >
          Address comment in active chat
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!canAddressInNewChat}
          onClick={() => {
            if (canAddressInNewChat) onAddressInNewChat(comment);
          }}
        >
          Address comment in new chat
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function CommentsList({
  comments,
  isLoading,
  error,
  onAddressInActiveChat,
  onAddressInNewChat,
}: {
  comments: PullRequestConversationItem[];
  isLoading?: boolean;
  error?: Error | null;
  onAddressInActiveChat?: (comment: AddressablePullRequestComment) => void;
  onAddressInNewChat?: (comment: AddressablePullRequestComment) => void;
}) {
  const sorted = useMemo(() => [...comments].sort(sortPullRequestConversationItems), [comments]);

  if (isLoading && sorted.length === 0) {
    return <div className="px-3 py-2 text-xs text-foreground-passive">Loading comments...</div>;
  }

  if (error && sorted.length === 0) {
    return <div className="px-3 py-2 text-xs text-foreground-passive">Unable to load comments</div>;
  }

  if (sorted.length === 0) {
    return <div className="px-3 py-2 text-xs text-foreground-passive">No comments available</div>;
  }

  return (
    <div className="flex flex-col gap-[1px]">
      {sorted.map((comment) => (
        <CommentItem
          key={comment.id}
          comment={comment}
          onAddressInActiveChat={onAddressInActiveChat}
          onAddressInNewChat={onAddressInNewChat}
        />
      ))}
      {isLoading && (
        <div className="px-3 py-2 text-xs text-foreground-passive">Loading comments...</div>
      )}
      {error && (
        <div className="px-3 py-2 text-xs text-foreground-passive">Unable to load comments</div>
      )}
    </div>
  );
}
