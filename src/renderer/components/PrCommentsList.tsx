import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  MessageSquarePlus,
  XCircle,
} from 'lucide-react';
import { useMemo, useState, useSyncExternalStore } from 'react';
import type { PrCommentsStatus, PrComment } from '../lib/prCommentsStatus';
import { formatRelativeTime } from '../lib/prCommentsStatus';
import { selectedPrCommentsStore } from '../lib/selectedPrCommentsStore';

function ReviewBadge({ state }: { state?: PrComment['reviewState'] }) {
  switch (state) {
    case 'APPROVED':
      return (
        <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-3 w-3" />
          Approved
        </span>
      );
    case 'CHANGES_REQUESTED':
      return (
        <span className="flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400">
          <XCircle className="h-3 w-3" />
          Changes requested
        </span>
      );
    default:
      return null;
  }
}

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '') // code blocks
    .replace(/`[^`]*`/g, '') // inline code
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // links/images
    .replace(/<[^>]+>/g, '') // HTML tags
    .replace(/[#*_~>|]/g, '') // markdown symbols
    .replace(/\|[^\n]*\|/g, '') // table rows
    .replace(/:-+/g, '') // table separators
    .replace(/\n{2,}/g, ' ') // collapse newlines
    .replace(/\s+/g, ' ') // collapse whitespace
    .trim();
}

const subscribe = (listener: () => void) => selectedPrCommentsStore.subscribe(listener);

function CommentItem({ comment, prUrl }: { comment: PrComment; prUrl?: string }) {
  const preview = useMemo(() => (comment.body ? stripMarkdown(comment.body) : ''), [comment.body]);
  const hasBody = !!comment.body;
  const [expanded, setExpanded] = useState(false);
  const isSelected = useSyncExternalStore(subscribe, () => selectedPrCommentsStore.has(comment.id));

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    selectedPrCommentsStore.toggle(comment);
  };

  return (
    <div
      className={`group min-w-0 px-4 py-2.5 transition-colors hover:bg-muted/50 ${
        isSelected ? 'bg-primary/10' : ''
      } ${hasBody ? 'cursor-pointer' : ''}`}
      onClick={hasBody ? () => setExpanded((prev) => !prev) : undefined}
    >
      <div className="flex items-center gap-2">
        {hasBody ? (
          expanded ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          )
        ) : (
          <span className="h-3 w-3 shrink-0" />
        )}
        <img
          src={comment.author.avatarUrl || `https://github.com/${comment.author.login}.png?size=40`}
          alt=""
          className="h-5 w-5 shrink-0 rounded-sm"
        />
        <span className="shrink-0 text-sm font-medium text-foreground">{comment.author.login}</span>
        {!expanded && preview && (
          <span className="min-w-0 truncate text-xs text-muted-foreground">{preview}</span>
        )}
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
          {formatRelativeTime(comment.createdAt)}
        </span>
        {comment.type === 'review' && <ReviewBadge state={comment.reviewState} />}
        {hasBody && (
          <button
            className={`shrink-0 rounded p-0.5 transition-colors hover:bg-muted ${
              isSelected ? 'text-primary' : 'text-muted-foreground'
            }`}
            onClick={handleToggle}
            title={isSelected ? 'Remove from chat' : 'Send to chat'}
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
          </button>
        )}
        {prUrl && (
          <button
            className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              window.electronAPI?.openExternal?.(prUrl);
            }}
            title="Open in GitHub"
          >
            <ExternalLink className="h-3 w-3" />
          </button>
        )}
      </div>
      {expanded && comment.body && (
        <div className="mt-2 whitespace-pre-wrap break-words pl-5 text-xs text-foreground">
          {comment.body}
        </div>
      )}
    </div>
  );
}

interface PrCommentsListProps {
  status: PrCommentsStatus | null;
  isLoading: boolean;
  hasPr: boolean;
  prUrl?: string;
}

export function PrCommentsList({ status, isLoading, hasPr, prUrl }: PrCommentsListProps) {
  if (!hasPr) return null;

  if (isLoading && !status) return null;

  if (!status || status.comments.length === 0) return null;

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 px-4 py-1.5">
        <span className="text-sm font-medium text-foreground">Comments</span>
      </div>
      {status.comments.map((comment) => (
        <CommentItem key={`${comment.type}-${comment.id}`} comment={comment} prUrl={prUrl} />
      ))}
    </div>
  );
}
