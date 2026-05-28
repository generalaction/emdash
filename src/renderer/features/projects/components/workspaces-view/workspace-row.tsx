import { observer } from 'mobx-react-lite';
import { ChevronRight, FolderGit2, GitBranch, Globe, GithubIcon, Laptop, CopyIcon, Folder, TreePine } from 'lucide-react';
import { rpc } from '@renderer/lib/ipc';
import { cn } from '@renderer/utils/utils';
import { getRepositoryStore } from '@renderer/features/projects/stores/project-selectors';
import { isGitHubDotComHost, parseRepositoryRef } from '@shared/repository-ref';
import type { WorktreeEntry } from '@shared/workspaces';

export const ROW_HEIGHT = 64;

export type FlatItem =
  | {
      type: 'main';
      entry: WorktreeEntry;
      isExpanded: boolean;
      worktreeCount: number;
      taskCount: number;
      username: string;
      projectId: string;
    }
  | { type: 'worktree'; entry: WorktreeEntry; taskCount: number; repoName: string };


export function splitWorkspacePath(absPath: string): string[] {
  const segments = absPath.split('/').filter(Boolean);
  return segments
}

function WorkspaceRowShell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (

      <div className={cn('flex h-16 items-center hover:bg-background-1 border-b border-border', className)}>
        {children}
      </div>

  );
}

function BranchLabel({ text, className }: { text: string; className?: string }) {
  return (
    <span className={cn('flex items-center gap-1', className)}>
      <GitBranch
        absoluteStrokeWidth
        strokeWidth={2}
        className="size-3 shrink-0 text-foreground-muted"
      />
      <span className="truncate">{text}</span>
    </span>
  );
}

function CopyPathButton({ path }: { path: string }) {
  return (
    <button
      type="button"
      title="Copy full path"
      className="opacity-0 group-hover:opacity-100 transition-opacity duration-150 rounded p-0.5 hover:bg-background-2 text-foreground-muted hover:text-foreground"
      onClick={async (e) => {
        e.stopPropagation();
        await rpc.app.clipboardWriteText(path);
      }}
    >
      <CopyIcon className="size-2.5" />
    </button>
  );
}

const MainRepoRow = observer(function MainRepoRow({
  item,
  onToggle,
}: {
  item: Extract<FlatItem, { type: 'main' }>;
  onToggle: () => void;
}) {
  const repo = getRepositoryStore(item.projectId);
  const repositoryUrl = repo?.canonicalRepositoryUrl ?? null;
  const parsed = parseRepositoryRef(repositoryUrl);
  const isGithub = parsed ? isGitHubDotComHost(parsed.host) : false;
  const remoteUrl = repo?.baseRemote.url;
  const repoLabel =
    parsed?.nameWithOwner ?? remoteUrl?.replace(/^https?:\/\//, '') ?? null;

  const displayPath = splitWorkspacePath(item.entry.path);
  const branchText = item.entry.branch ?? 'detached HEAD';
  const taskLabel =
    item.taskCount === 0
      ? null
      : item.taskCount === 1
        ? '1 task'
        : `${item.taskCount} tasks`;

  return (
    <WorkspaceRowShell className="group gap-2 p-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={item.isExpanded}
        aria-label={item.isExpanded ? 'Collapse worktrees' : 'Expand worktrees'}
        className="relative flex size-8 shrink-0 items-center justify-center rounded-lg hover:bg-background-2"
      >
        <FolderGit2
          absoluteStrokeWidth
          strokeWidth={1.5}
          className="absolute size-5 text-foreground-muted opacity-100 transition-opacity duration-150 group-hover:opacity-0"
        />
        <ChevronRight
          absoluteStrokeWidth
          strokeWidth={2}
          className={cn(
            'absolute size-4 text-foreground-muted opacity-0 transition-all duration-150 group-hover:opacity-100',
            item.isExpanded && 'rotate-90'
          )}
        />
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-sm text-foreground">
            {displayPath[displayPath.length - 1]}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1 text-xs text-foreground-passive">
              <Folder className='size-3' />
              {displayPath[displayPath.length - 2]}
            {/* <CopyPathButton path={item.entry.path} /> */}
            </span>
          <span className="flex shrink-0 items-center gap-1 text-xs text-foreground-passive">
            <Laptop absoluteStrokeWidth strokeWidth={2} className="size-3.5" />
            <span>{item.username}</span>
          </span>
          </div>
        </div>

        {/* Bottom row: branch + remote repo + task count + worktree count */}
        <div className="flex items-center justify-between gap-2 text-xs">
          <div className="flex shrink-0 items-center gap-2 text-foreground-passive">
            <BranchLabel text={branchText} className="text-foreground-muted" />
            {taskLabel && <span className="text-foreground-info">{taskLabel}</span>}
          </div>
          <div className="flex min-w-0 items-center gap-2">
            {repoLabel && (
              <span className="flex items-center gap-1 text-foreground-muted">
                {isGithub ? (
                  <GithubIcon absoluteStrokeWidth strokeWidth={2} className="size-3" />
                ) : (
                  <Globe absoluteStrokeWidth strokeWidth={2} className="size-3" />
                )}
                <span className="truncate">{repoLabel}</span>
              </span>
            )}
            {item.worktreeCount > 0 && (
              <span className="flex items-center gap-1 text-foreground-muted">
                <TreePine className='size-3' />
                {item.worktreeCount} {item.worktreeCount === 1 ? 'worktree' : 'worktrees'}
              </span>
            )}
          </div>
        </div>
      </div>
    </WorkspaceRowShell>
  );
});

function WorktreeRow({ item }: { item: Extract<FlatItem, { type: 'worktree' }> }) {
  const displayPath = splitWorkspacePath(item.entry.path);
  const taskLabel =
    item.taskCount === 0
      ? null
      : item.taskCount === 1
        ? '1 task'
        : `${item.taskCount} tasks`;

  return (
    <WorkspaceRowShell className="group px-2 gap-2">
      <div className="flex size-8 h-full items-center">
        <div className="h-full w-px bg-border mx-auto opacity-20" />

      </div>
      <div className="flex size-8 items-center justify-center">
        <TreePine className='size-5 text-foreground-muted' absoluteStrokeWidth strokeWidth={1.5} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center justify-between gap-2">
          <span
            className="truncate text-sm text-foreground"
            title={item.entry.path}
          >
            {displayPath[displayPath.length -1]}
          </span>
          <span className='flex items-center text-xs gap-1 text-foreground-passive'>
            <Folder className='size-3' />
            {displayPath[displayPath.length - 2]}
          </span>
        </div>
        <div className="flex items-center gap-1 justify-between">
          <div className='flex items-center gap-2'>
          <BranchLabel text={item.entry.branch ?? 'detached HEAD'} className="text-foreground-muted text-xs" />
          {taskLabel && <span className="shrink-0 text-xs text-foreground-info">{taskLabel}</span>}
          </div>
          <span className='flex items-center text-xs gap-1 text-foreground-passive'>
            <FolderGit2 className='size-3' />
            {item.repoName}
          </span>
        </div>
      </div>
    </WorkspaceRowShell>
  );
}

export function WorkspaceRow({ item, onToggle }: { item: FlatItem; onToggle: () => void }) {
  if (item.type === 'main') {
    return <MainRepoRow item={item} onToggle={onToggle} />;
  }
  return <WorktreeRow item={item} />;
}
