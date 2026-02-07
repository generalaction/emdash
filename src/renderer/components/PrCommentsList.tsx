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

const markdownComponents = {
  pre: (props: React.HTMLAttributes<HTMLPreElement>) => (
    <pre {...props} className="my-1.5 overflow-x-auto rounded bg-muted/50 p-2 text-[11px] leading-relaxed" />
  ),
  code: ({ className, children, ...rest }: React.HTMLAttributes<HTMLElement>) => {
    const isBlock = className?.startsWith('language-');
    if (isBlock) {
      return <code className="text-[11px]" {...rest}>{children}</code>;
    }
    return <code className="rounded bg-muted/50 px-1 py-0.5 text-[11px]" {...rest}>{children}</code>;
  },
  table: (props: React.HTMLAttributes<HTMLTableElement>) => (
    <div className="my-1.5 overflow-x-auto">
      <table {...props} className="w-full text-[11px]" />
    </div>
  ),
  th: (props: React.HTMLAttributes<HTMLTableCellElement>) => (
    <th {...props} className="border border-border/50 px-2 py-1 text-left font-medium" />
  ),
  td: (props: React.HTMLAttributes<HTMLTableCellElement>) => (
    <td {...props} className="border border-border/50 px-2 py-1" />
  ),
  img: ({ alt, ...rest }: React.ImgHTMLAttributes<HTMLImageElement>) => (
    <img alt={alt || ''} {...rest} className="max-w-full" />
  ),
  a: ({ href, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a
      {...rest}
      href={href}
      className="text-blue-500 hover:underline"
      onClick={(e) => {
        e.preventDefault();
        if (href) window.electronAPI?.openExternal?.(href);
      }}
    >
      {children}
    </a>
  ),
};

function CommentItem({ comment }: { comment: PrComment }) {
  return (
    <div className="min-w-0 px-4 py-3">
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
        <div className="mt-1.5 min-w-0 overflow-hidden pl-7 text-xs leading-relaxed text-muted-foreground">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeRaw]}
            components={markdownComponents}
          >
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
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 px-4 py-1.5">
        <span className="text-sm font-medium text-foreground">Comments</span>
      </div>
      {status.comments.map((comment) => (
        <CommentItem key={`${comment.type}-${comment.id}`} comment={comment} />
      ))}
    </div>
  );
}
