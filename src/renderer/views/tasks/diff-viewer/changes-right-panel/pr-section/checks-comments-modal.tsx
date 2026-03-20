import {
  ArrowUp,
  ArrowUpRight,
  CheckCircle2,
  ExternalLink,
  Loader2,
  MinusCircle,
  X,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import Markdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import { Badge } from '@renderer/components/ui/badge';
import { Button } from '@renderer/components/ui/button';
import { DialogClose, DialogContent } from '@renderer/components/ui/dialog';
import { Textarea } from '@renderer/components/ui/textarea';
import { rpc } from '@renderer/core/ipc';
import type { BaseModalProps } from '@renderer/core/modal/modal-provider';
import {
  formatCheckDuration,
  formatRelativeTime,
  type CheckRun,
  type CheckRunBucket,
  type PrComment,
} from '@renderer/lib/github';
import { useCheckRuns } from '../../state/use-check-runs';
import { usePrComments } from '../../state/use-pr-comments';

export type ChecksCommentsModalArgs = {
  nameWithOwner: string;
  prNumber: number;
  prUrl?: string;
};

type Props = BaseModalProps<void> & ChecksCommentsModalArgs;

const bucketOrder: Record<CheckRunBucket, number> = {
  fail: 0,
  pending: 1,
  pass: 2,
  skipping: 3,
  cancel: 4,
};

function BucketIcon({ bucket }: { bucket: CheckRunBucket }) {
  switch (bucket) {
    case 'pass':
      return <CheckCircle2 className="size-3.5 text-emerald-500" />;
    case 'fail':
      return <XCircle className="size-3.5 text-red-500" />;
    case 'pending':
      return <Loader2 className="size-3.5 animate-spin text-amber-500" />;
    case 'skipping':
    case 'cancel':
      return <MinusCircle className="size-3.5 text-muted-foreground/60" />;
  }
}

function CheckRunItem({ check }: { check: CheckRun }) {
  const duration = formatCheckDuration(check.startedAt, check.completedAt);
  const subtitle = check.appName ?? check.workflowName;
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <BucketIcon bucket={check.bucket} />
      {check.appLogoUrl ? (
        <img src={check.appLogoUrl} alt={check.appName ?? ''} className="size-4 shrink-0 rounded" />
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{check.name}</div>
        {subtitle && <div className="truncate text-xs text-muted-foreground">{subtitle}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {duration && <span className="text-xs text-muted-foreground">{duration}</span>}
        {check.detailsUrl && (
          <button
            className="text-muted-foreground hover:text-foreground"
            title="Open in GitHub"
            onClick={() => rpc.app.openExternal(check.detailsUrl!)}
          >
            <ExternalLink className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

function ChecksList({ checks, isLoading }: { checks: CheckRun[]; isLoading: boolean }) {
  const sorted = [...checks].sort((a, b) => bucketOrder[a.bucket] - bucketOrder[b.bucket]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (checks.length === 0) {
    return <div className="py-10 text-center text-xs text-muted-foreground">No checks</div>;
  }

  return (
    <div>
      {sorted.map((check, i) => (
        <CheckRunItem key={`${check.name}-${i}`} check={check} />
      ))}
    </div>
  );
}

const reviewBadgeStyles: Record<string, string> = {
  APPROVED: 'text-emerald-600 bg-emerald-500/10',
  CHANGES_REQUESTED: 'text-red-600 bg-red-500/10',
  COMMENTED: 'text-muted-foreground bg-muted',
  DISMISSED: 'text-muted-foreground bg-muted',
};

function CommentItem({ comment }: { comment: PrComment }) {
  return (
    <div className="flex gap-2 px-3 py-2">
      {comment.author.avatarUrl ? (
        <img
          src={comment.author.avatarUrl}
          alt={comment.author.login}
          className="size-5 shrink-0 rounded-full"
        />
      ) : (
        <div className="size-5 shrink-0 rounded-full bg-muted" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{comment.author.login}</span>
          <span className="text-xs text-muted-foreground">
            {formatRelativeTime(comment.createdAt)}
          </span>
          {comment.type === 'review' && comment.reviewState && (
            <span
              className={`rounded px-1.5 py-0.5 text-xs font-medium ${reviewBadgeStyles[comment.reviewState] ?? ''}`}
            >
              {comment.reviewState === 'APPROVED'
                ? 'Approved'
                : comment.reviewState === 'CHANGES_REQUESTED'
                  ? 'Changes requested'
                  : comment.reviewState}
            </span>
          )}
        </div>
        {comment.body && (
          <div className="mt-0.5 text-sm text-foreground/80 [&_p]:my-0.5 [&_a]:text-blue-500 [&_a]:underline [&_strong]:font-semibold [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:text-xs [&_sub]:text-xs [&_sub]:text-muted-foreground">
            <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
              {comment.body.replace(/<!--[\s\S]*?-->/g, '').trim()}
            </Markdown>
          </div>
        )}
      </div>
    </div>
  );
}

function CommentsSection({ nameWithOwner, prNumber }: { nameWithOwner: string; prNumber: number }) {
  const { comments, isLoading } = usePrComments(nameWithOwner, prNumber);

  return (
    <div>
      <div className="sticky -top-px z-10 flex h-11 items-center gap-2 border-t border-b border-border bg-background px-4">
        <span className="text-sm font-medium">Comments</span>
        {!isLoading && comments.length > 0 && (
          <Badge variant="secondary" className="text-xs">
            {comments.length}
          </Badge>
        )}
      </div>
      {isLoading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : comments.length === 0 ? (
        <div className="py-10 text-center text-xs text-muted-foreground">No comments yet</div>
      ) : (
        <div>
          {comments.map((c) => (
            <CommentItem key={c.id} comment={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function CommentInput({ nameWithOwner, prNumber }: { nameWithOwner: string; prNumber: number }) {
  const { addComment, isAddingComment } = usePrComments(nameWithOwner, prNumber);
  const [body, setBody] = useState('');

  const handleSubmit = async () => {
    if (!body.trim() || isAddingComment) return;
    await addComment(body.trim());
    setBody('');
  };

  return (
    <div className="flex items-stretch gap-2 border-t border-border p-3">
      <Textarea
        placeholder="Leave a comment..."
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        className="min-h-0 flex-1 resize-none text-sm"
      />
      <Button
        variant="outline"
        disabled={!body.trim() || isAddingComment}
        onClick={handleSubmit}
        title="Send comment"
        className="w-9 shrink-0 self-stretch p-0"
      >
        {isAddingComment ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <ArrowUp className="size-3.5" />
        )}
      </Button>
    </div>
  );
}

export function ChecksCommentsModal({ nameWithOwner, prNumber, prUrl }: Props) {
  const { checks, summary, isLoading: checksLoading } = useCheckRuns(nameWithOwner, prNumber);

  return (
    <DialogContent
      className="sm:max-w-3xl  max-h-[70vh] flex flex-col gap-0 p-0"
      showCloseButton={false}
    >
      <div className="flex h-11 items-center justify-between border-b border-border px-4 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Checks</span>
          {!checksLoading && checks.length > 0 && (
            <div className="flex items-center gap-1.5">
              {summary.passed > 0 && (
                <Badge variant="outline" className="gap-1 text-xs">
                  <CheckCircle2 className="size-3 text-emerald-500" />
                  {summary.passed} passed
                </Badge>
              )}
              {summary.failed > 0 && (
                <Badge variant="outline" className="gap-1 text-xs">
                  <XCircle className="size-3 text-red-500" />
                  {summary.failed} failed
                </Badge>
              )}
              {summary.pending > 0 && (
                <Badge variant="outline" className="gap-1 text-xs">
                  <Loader2 className="size-3 animate-spin text-amber-500" />
                  {summary.pending} pending
                </Badge>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            title="Open PR in browser"
            onClick={() => prUrl && rpc.app.openExternal(prUrl)}
          >
            <ArrowUpRight className="size-4" />
          </Button>
          <DialogClose render={<Button variant="ghost" size="icon-sm" />}>
            <X className="size-4" />
            <span className="sr-only">Close</span>
          </DialogClose>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ChecksList checks={checks} isLoading={checksLoading} />
        <CommentsSection nameWithOwner={nameWithOwner} prNumber={prNumber} />
      </div>
      <CommentInput nameWithOwner={nameWithOwner} prNumber={prNumber} />
    </DialogContent>
  );
}
