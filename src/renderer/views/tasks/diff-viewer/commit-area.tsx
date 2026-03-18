import { ArrowDown, ArrowUp, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { useToast } from '@renderer/hooks/use-toast';
import { useDiffViewContext } from './diff-view-provider';
import { friendlyGitError } from './utils';

export function CommitArea() {
  const {
    fileChanges,
    branchStatus,
    latestCommit,
    refreshBranchAndCommit,
    commitChanges,
    pushChanges,
    pullChanges,
    softResetChanges,
  } = useDiffViewContext();
  const { toast } = useToast();

  const [commitMessage, setCommitMessage] = useState('');
  const [description, setDescription] = useState('');
  const [isCommitting, setIsCommitting] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [isUndoing, setIsUndoing] = useState(false);

  const hasStagedFiles = fileChanges.some((f) => f.isStaged);
  const canCommit = hasStagedFiles && commitMessage.trim().length > 0 && !isCommitting;

  const branch = branchStatus?.branch;
  const aheadCount = branchStatus?.ahead ?? 0;
  const behindCount = branchStatus?.behind ?? 0;
  const hasUnpushed = aheadCount > 0 || (latestCommit != null && !latestCommit.isPushed);

  const handleCommit = async () => {
    if (!canCommit) return;
    setIsCommitting(true);
    try {
      const message = description.trim()
        ? `${commitMessage.trim()}\n\n${description.trim()}`
        : commitMessage.trim();
      const result = await commitChanges(message);
      if (result.success) {
        setCommitMessage('');
        setDescription('');
        refreshBranchAndCommit();
      } else {
        toast({
          title: 'Commit failed',
          description: friendlyGitError(result.error || 'Unknown error'),
          variant: 'destructive',
        });
      }
    } catch (err) {
      toast({
        title: 'Commit failed',
        description: friendlyGitError(err instanceof Error ? err.message : String(err)),
        variant: 'destructive',
      });
    } finally {
      setIsCommitting(false);
    }
  };

  const handlePush = async () => {
    if (!hasUnpushed || isPushing) return;
    setIsPushing(true);
    try {
      const result = await pushChanges();
      if (!result.success) {
        toast({
          title: 'Push failed',
          description: friendlyGitError(result.error || 'Unknown error'),
          variant: 'destructive',
        });
      }
    } catch (err) {
      toast({
        title: 'Push failed',
        description: friendlyGitError(err instanceof Error ? err.message : String(err)),
        variant: 'destructive',
      });
    } finally {
      setIsPushing(false);
    }
  };

  const handlePull = async () => {
    if (isPulling) return;
    setIsPulling(true);
    try {
      const result = await pullChanges();
      if (!result.success) {
        toast({
          title: 'Pull failed',
          description: friendlyGitError(result.error || 'Unknown error'),
          variant: 'destructive',
        });
      }
    } catch (err) {
      toast({
        title: 'Pull failed',
        description: friendlyGitError(err instanceof Error ? err.message : String(err)),
        variant: 'destructive',
      });
    } finally {
      setIsPulling(false);
    }
  };

  const handleUndo = async () => {
    if (isUndoing) return;
    setIsUndoing(true);
    try {
      const result = await softResetChanges();
      if (result.success) {
        if (result.subject) setCommitMessage(result.subject);
        if (result.body) setDescription(result.body);
      } else {
        toast({
          title: 'Undo failed',
          description: friendlyGitError(result.error || 'Unknown error'),
          variant: 'destructive',
        });
      }
    } catch (err) {
      toast({
        title: 'Undo failed',
        description: friendlyGitError(err instanceof Error ? err.message : String(err)),
        variant: 'destructive',
      });
    } finally {
      setIsUndoing(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 border-t border-border p-3">
      {branch && (
        <span className="truncate text-xs text-muted-foreground" title={branch}>
          On branch <span className="font-medium text-foreground">{branch}</span>
        </span>
      )}

      <input
        type="text"
        value={commitMessage}
        onChange={(e) => setCommitMessage(e.target.value)}
        placeholder="Enter commit message"
        className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && canCommit) {
            void handleCommit();
          }
        }}
      />

      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description"
        rows={3}
        className="w-full resize-none rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      />

      <div className="flex gap-2">
        <button
          onClick={() => void handleCommit()}
          disabled={!canCommit}
          className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          Commit
        </button>
        <button
          onClick={() => void handlePush()}
          disabled={!hasUnpushed || isPushing}
          className="flex items-center justify-center gap-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          title={
            hasUnpushed
              ? `Push${aheadCount > 0 ? ` ${aheadCount} commit${aheadCount > 1 ? 's' : ''}` : ''}`
              : 'No unpushed commits'
          }
        >
          <ArrowUp className="h-3 w-3" />
          Push{aheadCount > 0 ? ` (${aheadCount})` : ''}
        </button>
        {behindCount > 0 && (
          <button
            onClick={() => void handlePull()}
            disabled={isPulling}
            className="flex items-center justify-center gap-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            title={`Pull ${behindCount} commit${behindCount > 1 ? 's' : ''} from remote`}
          >
            <ArrowDown className="h-3 w-3" />
            Pull ({behindCount})
          </button>
        )}
      </div>

      <hr className="-mx-3 border-border" />

      {latestCommit && (
        <div className="flex items-center gap-2">
          <span
            className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
            title={latestCommit.subject}
          >
            {latestCommit.subject}
          </span>
          {!latestCommit.isPushed && (
            <button
              onClick={() => void handleUndo()}
              disabled={isUndoing}
              className="flex flex-shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              title="Undo last commit"
            >
              <Undo2 className="h-3 w-3" />
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}
