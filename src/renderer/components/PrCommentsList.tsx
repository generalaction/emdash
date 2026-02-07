import { CheckCircle2, XCircle } from 'lucide-react';
import type { PrCommentsStatus, PrComment } from '../lib/prCommentsStatus';
import { formatRelativeTime } from '../lib/prCommentsStatus';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';

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

function CommentItem({ comment }: { comment: PrComment }) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-2">
        <img
          src={comment.author.avatarUrl || `https://github.com/${comment.author.login}.png?size=40`}
          alt=""
          className="h-5 w-5 shrink-0 rounded-full"
        />
        <span className="truncate text-sm font-medium text-foreground">
          {comment.author.login}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatRelativeTime(comment.createdAt)}
        </span>
        {comment.type === 'review' && <ReviewBadge state={comment.reviewState} />}
      </div>
      {comment.body && (
        <div className="mt-1.5 pl-7 text-xs leading-relaxed text-muted-foreground prose-sm prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0">
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
            {comment.body}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
}

interface PrCommentsListProps {
  status: PrCommentsStatus | null;
  isLoading: boolean;
  hasPr: boolean;
}

export function PrCommentsList({ status, isLoading, hasPr }: PrCommentsListProps) {
  if (!hasPr) return null;

  if (isLoading && !status) return null;

  if (!status || status.comments.length === 0) return null;

  return (
    <div>
      <div className="flex items-center gap-1.5 px-4 py-1.5">
        <span className="text-sm font-medium text-foreground">Comments</span>
      </div>
      {status.comments.map((comment) => (
        <CommentItem key={`${comment.type}-${comment.id}`} comment={comment} />
      ))}
    </div>
  );
}
