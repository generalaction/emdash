import React, { useCallback, useMemo, useState } from 'react';
import { Separator } from './ui/separator';
import { Button } from './ui/button';
import { Input } from './ui/input';
import GithubConnectionCard from './GithubConnectionCard';
import { ExternalLink, GitPullRequest, Search } from 'lucide-react';
import { Spinner } from './ui/spinner';

interface Props {
  projectId: string;
  projectPath: string;
  onOpenWorkspace: (ws: {
    id: string;
    name: string;
    branch: string;
    path: string;
    status: 'active' | 'idle' | 'running';
  }) => void;
}

type RepoChoice = {
  owner: string;
  name: string;
  fullName: string; // owner/name
  url: string; // https url
};

type PullRequest = {
  number: number;
  title: string;
  headRefName: string;
  baseRefName: string;
  url: string;
  isDraft?: boolean;
  updatedAt?: string | null;
};

function parseRepoInput(input: string): RepoChoice | null {
  const s = input.trim();
  if (!s) return null;
  // Accept URL like https://github.com/owner/repo or ssh
  const urlMatch = s.match(/github\.com[/:]([^/]+)\/([^/#\s]+)(?:\.git)?/i);
  if (urlMatch) {
    const owner = urlMatch[1];
    const name = urlMatch[2].replace(/\.git$/i, '');
    return {
      owner,
      name,
      fullName: `${owner}/${name}`,
      url: `https://github.com/${owner}/${name}.git`,
    };
  }
  // Accept owner/repo
  const simple = s.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (simple) {
    const owner = simple[1];
    const name = simple[2];
    return {
      owner,
      name,
      fullName: `${owner}/${name}`,
      url: `https://github.com/${owner}/${name}.git`,
    };
  }
  return null;
}

const GithubPRSection: React.FC<Props> = ({ projectId, projectPath, onOpenWorkspace }) => {
  const [repoInput, setRepoInput] = useState('');
  const [selectedRepo, setSelectedRepo] = useState<RepoChoice | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [prs, setPrs] = useState<PullRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cloneTargetPath = useMemo(() => {
    if (!selectedRepo) return null;
    // Clone under a sibling directory to the current project: ../gh/<owner>-<name>
    const seg = `${selectedRepo.owner}-${selectedRepo.name}`;
    // Normalize simple "../" join without Node path
    const base = projectPath.replace(/[\\/]+$/, '');
    return `${base}/../gh/${seg}`;
  }, [projectPath, selectedRepo]);

  const handleFetchPrs = useCallback(async () => {
    setError(null);
    const parsed = parseRepoInput(repoInput) || selectedRepo;
    if (!parsed) {
      setError('Enter a GitHub repo as owner/repo or full URL');
      return;
    }
    setSelectedRepo(parsed);
    setIsFetching(true);
    try {
      const localPath =
        cloneTargetPath ??
        (() => {
          const seg = `${parsed.owner}-${parsed.name}`;
          const base = projectPath.replace(/[\\/]+$/, '');
          return `${base}/../gh/${seg}`;
        })();
      const cloneRes = await window.electronAPI.githubCloneRepository(parsed.url, localPath);
      if (!cloneRes?.success) {
        setError(cloneRes?.error || 'Clone failed');
        setIsFetching(false);
        return;
      }
      const prRes = await window.electronAPI.githubListPullRequests(localPath);
      if (!prRes?.success) {
        setError(prRes?.error || 'Failed to list PRs');
        setPrs([]);
        setIsFetching(false);
        return;
      }
      setPrs(prRes.prs || []);
    } catch (e: any) {
      setError(e?.message || 'Failed to fetch PRs');
    } finally {
      setIsFetching(false);
    }
  }, [repoInput, selectedRepo, cloneTargetPath, projectPath]);

  const handleCreateWorkspace = useCallback(
    async (pr: PullRequest) => {
      if (!selectedRepo) return;
      const localPath = cloneTargetPath!;
      try {
        const res = await window.electronAPI.githubCreatePullRequestWorktree({
          projectPath: localPath,
          projectId,
          prNumber: pr.number,
          prTitle: pr.title,
        });
        if (!res?.success || !res?.worktree) {
          setError(res?.error || 'Failed to create PR worktree');
          return;
        }
        const worktree = res.worktree as { id: string; path: string; branch: string };
        const ws = {
          id: worktree.id,
          name: `pr-${pr.number}`,
          branch: worktree.branch,
          path: worktree.path,
          status: 'idle' as const,
        };
        await window.electronAPI.saveWorkspace({
          id: ws.id,
          projectId,
          name: ws.name,
          branch: ws.branch,
          path: ws.path,
          status: ws.status,
          agentId: null,
          metadata: { source: 'github-pr', repo: selectedRepo.fullName, prNumber: pr.number },
        });
        onOpenWorkspace(ws);
      } catch (e: any) {
        setError(e?.message || 'Failed to create workspace');
      }
    },
    [cloneTargetPath, onOpenWorkspace, projectId, selectedRepo]
  );

  return (
    <div className="mt-6">
      <Separator className="my-4" />
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">Test GitHub PRs</h3>
          {selectedRepo ? (
            <a
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              href={`https://github.com/${selectedRepo.fullName}`}
              onClick={(e) => {
                e.preventDefault();
                window.electronAPI.openExternal(`https://github.com/${selectedRepo.fullName}`);
              }}
            >
              {selectedRepo.fullName}
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : null}
        </div>

        <GithubConnectionCard />

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex-1">
            <Input
              value={repoInput}
              onChange={(e) => setRepoInput(e.currentTarget.value)}
              placeholder="owner/repo or https://github.com/owner/repo"
              aria-label="GitHub repository"
            />
          </div>
          <Button type="button" onClick={handleFetchPrs} disabled={isFetching}>
            {isFetching ? (
              <Spinner size="sm" className="mr-2" />
            ) : (
              <Search className="mr-2 h-4 w-4" />
            )}
            Fetch PRs
          </Button>
        </div>

        {error ? <div className="text-xs text-destructive">{error}</div> : null}

        {Array.isArray(prs) ? (
          prs.length ? (
            <div className="mt-2 space-y-2">
              {prs.map((pr) => (
                <div
                  key={pr.number}
                  className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <GitPullRequest className="h-4 w-4" />
                      <span className="truncate text-sm font-medium">
                        #{pr.number} {pr.title}
                      </span>
                      {pr.isDraft ? (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          draft
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {pr.headRefName} → {pr.baseRefName}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => handleCreateWorkspace(pr)}
                    >
                      Create Task
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => window.electronAPI.openExternal(pr.url)}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">No open pull requests found.</div>
          )
        ) : null}
      </div>
    </div>
  );
};

export default GithubPRSection;
