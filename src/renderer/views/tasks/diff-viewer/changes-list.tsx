import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  File,
  History,
  Minus,
  Plus,
  Tag,
  Undo2,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GitChange } from '@shared/git';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@renderer/components/ui/alert-dialog';
import { Checkbox } from '@renderer/components/ui/checkbox';
import { Toggle } from '@renderer/components/ui/toggle';
import { rpc } from '@renderer/core/ipc';
import { useToast } from '@renderer/hooks/use-toast';
import { cn } from '@renderer/lib/utils';
import { useDiffViewContext } from './diff-view-provider';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function splitPath(filePath: string): { filename: string; directory: string } {
  const parts = filePath.split('/');
  const filename = parts.pop() || filePath;
  const directory = parts.length > 0 ? parts.join('/') + '/' : '';
  return { filename, directory };
}

function friendlyGitError(raw: string): string {
  const s = raw.toLowerCase();
  if (s.includes('non-fast-forward') || s.includes('tip of your current branch is behind'))
    return 'Remote has new commits. Pull before pushing.';
  if (s.includes('merge conflict') || s.includes('fix conflicts'))
    return 'Merge conflicts detected. Resolve them in your editor.';
  if (s.includes('permission denied') || s.includes('authentication'))
    return 'Authentication failed. Check your credentials.';
  if (s.includes('could not resolve host') || s.includes('unable to access'))
    return 'Cannot reach remote. Check your network connection.';
  if (s.includes('no such remote')) return 'No remote configured for this repository.';
  if (s.includes('cannot undo the initial commit')) return 'Cannot undo the initial commit.';
  if (s.includes('nothing to commit')) return 'Nothing to commit.';
  const firstLine = raw.split('\n').find((l) => l.trim().length > 0) || raw;
  return firstLine.length > 120 ? firstLine.slice(0, 120) + '...' : firstLine;
}

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr || '';
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHr / 24);
  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? '' : 's'} ago`;
  if (diffDays < 30) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `${diffMonths} month${diffMonths === 1 ? '' : 's'} ago`;
  const diffYears = Math.floor(diffDays / 365);
  return `${diffYears} year${diffYears === 1 ? '' : 's'} ago`;
}

// ---------------------------------------------------------------------------
// FileList
// ---------------------------------------------------------------------------

function FileList() {
  const {
    fileChanges,
    selectedFile,
    setSelectedFile,
    stageFile,
    unstageFile,
    stageAll,
    revertFile,
  } = useDiffViewContext();

  const [restoreTarget, setRestoreTarget] = useState<string | null>(null);

  const tracked = fileChanges
    .filter((f) => f.status !== 'added')
    .sort((a, b) => a.path.localeCompare(b.path));
  const untracked = fileChanges
    .filter((f) => f.status === 'added')
    .sort((a, b) => a.path.localeCompare(b.path));

  const allStaged = fileChanges.length > 0 && fileChanges.every((f) => f.isStaged);
  const trackedAllStaged = tracked.length > 0 && tracked.every((f) => f.isStaged);
  const untrackedAllStaged = untracked.length > 0 && untracked.every((f) => f.isStaged);

  const handleStageAll = async (checked: boolean) => {
    try {
      if (checked) {
        await stageAll();
      } else {
        await Promise.all(fileChanges.filter((f) => f.isStaged).map((f) => unstageFile(f.path)));
      }
    } catch (err) {
      console.error('Staging failed:', err);
    }
  };

  const handleGroupStage = async (files: GitChange[], checked: boolean) => {
    try {
      await Promise.all(
        files.map((file) => {
          if (checked && !file.isStaged) return stageFile(file.path);
          if (!checked && file.isStaged) return unstageFile(file.path);
          return Promise.resolve();
        })
      );
    } catch (err) {
      console.error('Staging failed:', err);
    }
  };

  const handleFileStage = async (filePath: string, checked: boolean) => {
    try {
      if (checked) {
        await stageFile(filePath);
      } else {
        await unstageFile(filePath);
      }
    } catch (err) {
      console.error('Staging failed:', err);
    }
  };

  const executeRestore = async () => {
    if (!restoreTarget) return;
    try {
      await revertFile(restoreTarget);
      setRestoreTarget(null);
    } catch (err) {
      console.error('Restore failed:', err);
      setRestoreTarget(null);
    }
  };

  const renderFileRow = (file: GitChange, dotColor: string) => {
    const { filename, directory } = splitPath(file.path);
    return (
      <div
        key={file.path}
        className={`group/file flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm transition-colors hover:bg-accent/50 ${
          selectedFile === file.path ? 'bg-accent' : ''
        }`}
        onClick={() => setSelectedFile(file.path)}
      >
        <span className={`h-2 w-2 flex-shrink-0 rounded-full ${dotColor}`} />
        <div className="min-w-0 flex-1 truncate">
          <span className="font-medium text-foreground">{filename}</span>
          {directory && <span className="ml-1 text-muted-foreground">{directory}</span>}
        </div>
        <button
          className="flex-shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover/file:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            setRestoreTarget(file.path);
          }}
          title="Restore file"
        >
          <Undo2 className="h-3.5 w-3.5" />
        </button>
        <Checkbox
          checked={file.isStaged}
          onCheckedChange={(checked) => {
            void handleFileStage(file.path, checked === true);
          }}
          onClick={(e) => e.stopPropagation()}
          className={`flex-shrink-0 transition-opacity ${file.isStaged ? '' : 'opacity-0 group-hover/file:opacity-100'}`}
        />
      </div>
    );
  };

  if (fileChanges.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-muted-foreground">
        No changes
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col">
        <div className="flex h-9 items-center gap-2 border-b border-border px-3">
          <Checkbox
            checked={allStaged}
            onCheckedChange={(checked) => void handleStageAll(checked === true)}
          />
          <span className="text-xs font-medium text-muted-foreground">Stage All</span>
        </div>

        {tracked.length > 0 && (
          <div className="mt-4">
            <div className="flex items-center gap-2 px-3 py-1.5">
              <Checkbox
                checked={trackedAllStaged}
                onCheckedChange={(checked) => void handleGroupStage(tracked, checked === true)}
              />
              <span className="text-xs font-medium tracking-wide text-muted-foreground">
                Tracked
              </span>
              <span className="text-xs text-muted-foreground">({tracked.length})</span>
            </div>
            {tracked.map((file) => renderFileRow(file, 'bg-blue-500'))}
          </div>
        )}

        {untracked.length > 0 && (
          <div className={tracked.length > 0 ? 'mt-3 pt-1' : ''}>
            <div className="flex items-center gap-2 px-3 py-1.5">
              <Checkbox
                checked={untrackedAllStaged}
                onCheckedChange={(checked) => void handleGroupStage(untracked, checked === true)}
              />
              <span className="text-xs font-medium tracking-wide text-muted-foreground">
                Untracked
              </span>
              <span className="text-xs text-muted-foreground">({untracked.length})</span>
            </div>
            {untracked.map((file) => renderFileRow(file, 'bg-green-500'))}
          </div>
        )}
      </div>

      <AlertDialog open={!!restoreTarget} onOpenChange={(open) => !open && setRestoreTarget(null)}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-lg">Restore file?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogDescription className="text-sm">
            This will discard all uncommitted changes to{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              {restoreTarget?.split('/').pop()}
            </code>{' '}
            and restore it to the last committed version. This action cannot be undone.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void executeRestore()}
              className="bg-destructive px-4 py-2 text-destructive-foreground hover:bg-destructive/90"
            >
              <Undo2 className="mr-2 h-4 w-4" />
              Restore
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// CommitArea
// ---------------------------------------------------------------------------

function CommitArea() {
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

// ---------------------------------------------------------------------------
// CommitFileList (for History tab)
// ---------------------------------------------------------------------------

interface CommitFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
}

function CommitFileListSection({ commitHash }: { commitHash: string }) {
  const { projectId, taskId, selectedCommitFile, setSelectedCommitFile } = useDiffViewContext();
  const [files, setFiles] = useState<CommitFile[]>([]);
  const [loading, setLoading] = useState(false);

  const setSelectedCommitFileRef = useRef(setSelectedCommitFile);
  setSelectedCommitFileRef.current = setSelectedCommitFile;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const load = async () => {
      try {
        const res = await rpc.git.getCommitFiles(projectId, taskId, commitHash);
        if (!cancelled && res?.success && res.data?.files) {
          const commitFiles = res.data.files as CommitFile[];
          setFiles(commitFiles);
          if (commitFiles.length > 0 && !selectedCommitFile) {
            setSelectedCommitFileRef.current(commitFiles[0].path);
          }
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, taskId, commitHash]);

  if (loading) {
    return (
      <div className="flex h-20 items-center justify-center text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="flex h-20 items-center justify-center text-sm text-muted-foreground">
        No files
      </div>
    );
  }

  return (
    <div>
      <div className="flex h-8 items-center border-b border-border px-3 text-xs font-medium text-muted-foreground">
        {files.length} changed file{files.length !== 1 ? 's' : ''}
      </div>
      {files.map((file) => {
        const { filename, directory } = splitPath(file.path);
        const dotColor =
          file.status === 'added'
            ? 'bg-green-500'
            : file.status === 'deleted'
              ? 'bg-red-500'
              : 'bg-blue-500';
        return (
          <button
            key={file.path}
            className={`w-full cursor-pointer border-b border-border/50 px-3 py-2 text-left ${
              selectedCommitFile === file.path ? 'bg-accent' : 'hover:bg-muted/50'
            }`}
            onClick={() => setSelectedCommitFile(file.path)}
          >
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 flex-shrink-0 rounded-full ${dotColor}`} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{filename}</div>
                {directory && (
                  <div className="truncate text-xs text-muted-foreground">{directory}</div>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CommitList (for History tab)
// ---------------------------------------------------------------------------

interface CommitEntry {
  hash: string;
  subject: string;
  body: string;
  author: string;
  date: string;
  isPushed: boolean;
  tags: string[];
}

const PAGE_SIZE = 50;

function CommitListSection() {
  const { projectId, taskId, selectedCommit, setSelectedCommit } = useDiffViewContext();
  const [commits, setCommits] = useState<CommitEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [aheadCount, setAheadCount] = useState<number | undefined>(undefined);

  const setSelectedCommitRef = useRef(setSelectedCommit);
  setSelectedCommitRef.current = setSelectedCommit;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const load = async () => {
      try {
        const res = await rpc.git.getLog(projectId, taskId, PAGE_SIZE);
        if (!cancelled && res?.success && res.data?.commits) {
          const fetched = res.data.commits as CommitEntry[];
          setCommits(fetched);
          setAheadCount(res.data.aheadCount as number | undefined);
          setHasMore(fetched.length >= PAGE_SIZE);
          if (fetched.length > 0 && !selectedCommit) {
            const c = fetched[0];
            setSelectedCommitRef.current({
              hash: c.hash,
              subject: c.subject,
              body: c.body,
              author: c.author,
            });
          }
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, taskId]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const res = await rpc.git.getLog(projectId, taskId, PAGE_SIZE, commits.length, aheadCount);
      if (res?.success && res.data?.commits) {
        const newCommits = res.data.commits as CommitEntry[];
        setCommits((prev) => [...prev, ...newCommits]);
        setHasMore(newCommits.length >= PAGE_SIZE);
      } else {
        setHasMore(false);
      }
    } catch {
      // ignore
    } finally {
      setLoadingMore(false);
    }
  }, [projectId, taskId, loadingMore, hasMore, commits.length, aheadCount]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (commits.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No commits
      </div>
    );
  }

  return (
    <div className="overflow-y-auto">
      {commits.map((commit) => (
        <button
          key={commit.hash}
          className={`w-full cursor-pointer border-b border-border/50 px-3 py-2 text-left ${
            selectedCommit?.hash === commit.hash ? 'bg-accent' : 'hover:bg-muted/50'
          }`}
          onClick={() =>
            setSelectedCommit({
              hash: commit.hash,
              subject: commit.subject,
              body: commit.body,
              author: commit.author,
            })
          }
        >
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              {commit.subject ? <div className="truncate text-sm">{commit.subject}</div> : null}
              <div className="text-xs text-muted-foreground">
                {commit.author} &middot; {formatRelativeDate(commit.date)}
              </div>
            </div>
            {commit.tags.length > 0 &&
              commit.tags.map((tag) => (
                <span
                  key={tag}
                  className="flex shrink-0 items-center gap-0.5 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                >
                  <Tag className="h-2.5 w-2.5" />
                  {tag}
                </span>
              ))}
            {!commit.isPushed && (
              <span title="Not yet pushed to remote">
                <ArrowUp className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={2.5} />
              </span>
            )}
          </div>
        </button>
      ))}
      {hasMore && (
        <button
          onClick={() => void loadMore()}
          disabled={loadingMore}
          className="w-full px-3 py-2.5 text-center text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
        >
          {loadingMore ? 'Loading...' : 'Load more'}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// HistoryTab
// ---------------------------------------------------------------------------

function HistoryTab() {
  const { selectedCommit, setSelectedCommit } = useDiffViewContext();
  const [detailExpanded, setDetailExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Reset expanded state when commit changes
  useEffect(() => {
    setDetailExpanded(false);
    setCopied(false);
  }, [selectedCommit?.hash]);

  useEffect(() => {
    return () => clearTimeout(copyTimerRef.current);
  }, []);

  const handleCopyHash = async () => {
    if (!selectedCommit) return;
    try {
      await navigator.clipboard.writeText(selectedCommit.hash);
      setCopied(true);
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard API not available
    }
  };

  const bodyTrimmed = selectedCommit?.body?.trim() || '';
  const hasExpandableContent = bodyTrimmed.length > 0 || !!selectedCommit?.author;

  return (
    <div className="flex h-full flex-col">
      {/* Commit list — scrollable upper section */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <CommitListSection />
      </div>

      {/* Commit detail + file list — capped lower section so the list above stays scrollable */}
      {selectedCommit && (
        <div className="flex max-h-[40%] flex-col border-t border-border">
          <div className="shrink-0 border-b border-border px-3 py-2">
            <div className="flex items-center gap-1">
              <div className="min-w-0 flex-1 truncate text-sm font-medium leading-snug">
                {selectedCommit.subject}
              </div>
              {hasExpandableContent && (
                <button
                  className="flex-shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => setDetailExpanded((prev) => !prev)}
                >
                  {detailExpanded ? (
                    <ChevronUp className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                </button>
              )}
            </div>
            {detailExpanded && (
              <div className="mt-1.5">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{selectedCommit.author}</span>
                  <button
                    className="flex items-center gap-1 rounded px-1 py-0.5 font-mono hover:bg-muted hover:text-foreground"
                    onClick={() => void handleCopyHash()}
                    title="Copy commit hash"
                  >
                    {selectedCommit.hash.slice(0, 7)}
                    {copied ? (
                      <Check className="h-3 w-3 text-green-500" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                  </button>
                </div>
                {bodyTrimmed && (
                  <div className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                    {bodyTrimmed}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <CommitFileListSection commitHash={selectedCommit.hash} />
          </div>
        </div>
      )}
    </div>
  );
}

export function ChangesList() {
  const { activeTab, setActiveTab, fileChanges, totalLinesAdded, totalLinesDeleted } =
    useDiffViewContext();
  const fileCount = fileChanges.length;

  return (
    <div className="flex h-full flex-col">
      {/* Tab header */}
      <div className="flex   gap-2 p-2">
        <button
          onClick={() => setActiveTab('changes')}
          className={cn(
            'flex-1 text-center text-xs  transition-colors rounded-lg border border-border h-7 flex items-center justify-center gap-2',
            activeTab === 'changes'
              ? 'text-foreground bg-muted'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <span className="flex items-center justify-center gap-0.5 text-muted-foreground">
            <File className="size-3" />
            {fileCount}
          </span>
          {totalLinesAdded > 0 && (
            <span className="flex items-center justify-center gap-0.5  text-green-600">
              <Plus className="size-3" />
              {totalLinesAdded}
            </span>
          )}
          {totalLinesDeleted > 0 && (
            <span className="flex items-center justify-center gap-0.5 text-red-600">
              <Minus className="size-3" />
              {totalLinesDeleted}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={cn(
            'text-center text-xs  transition-colors rounded-lg border border-border size-7 flex items-center justify-center',
            activeTab === 'history'
              ? 'text-foreground bg-muted'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <History className="size-3.5" />
        </button>
      </div>

      {/* Tab content */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === 'changes' ? (
          <div className="flex h-full flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto">
              <FileList />
            </div>
            <CommitArea />
          </div>
        ) : (
          <HistoryTab />
        )}
      </div>
    </div>
  );
}
