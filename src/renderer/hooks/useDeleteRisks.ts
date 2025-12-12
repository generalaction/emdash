import { useEffect, useMemo, useState } from 'react';

type WorkspaceRef = { id: string; name: string; path: string };

type RiskState = Record<
  string,
  {
    staged: number;
    unstaged: number;
    untracked: number;
    ahead: number;
    behind: number;
    error?: string;
    pr?: {
      number?: number;
      title?: string;
      url?: string;
      state?: string;
      isDraft?: boolean;
    } | null;
  }
>;

export function useDeleteRisks(workspaces: WorkspaceRef[], enabled: boolean) {
  const [risks, setRisks] = useState<RiskState>({});
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!enabled || workspaces.length === 0) {
      setRisks({});
      setLoading(false);
      setLoaded(false);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const next: RiskState = {};
      for (const ws of workspaces) {
        try {
          const [statusRes, infoRes, prRes] = await Promise.allSettled([
            (window as any).electronAPI?.getGitStatus?.(ws.path),
            (window as any).electronAPI?.getGitInfo?.(ws.path),
            (window as any).electronAPI?.getPrStatus?.({ workspacePath: ws.path }),
          ]);

          let staged = 0;
          let unstaged = 0;
          let untracked = 0;
          if (
            statusRes.status === 'fulfilled' &&
            statusRes.value?.success &&
            statusRes.value.changes
          ) {
            for (const change of statusRes.value.changes) {
              if (change.status === 'untracked') {
                untracked += 1;
              } else if (change.isStaged) {
                staged += 1;
              } else {
                unstaged += 1;
              }
            }
          }

          const ahead =
            infoRes.status === 'fulfilled' && typeof infoRes.value?.aheadCount === 'number'
              ? infoRes.value.aheadCount
              : 0;
          const behind =
            infoRes.status === 'fulfilled' && typeof infoRes.value?.behindCount === 'number'
              ? infoRes.value.behindCount
              : 0;
          const pr =
            prRes.status === 'fulfilled' && prRes.value?.success ? (prRes.value.pr ?? null) : null;

          next[ws.id] = {
            staged,
            unstaged,
            untracked,
            ahead,
            behind,
            error:
              statusRes.status === 'fulfilled'
                ? statusRes.value?.error
                : statusRes.reason?.message || String(statusRes.reason || ''),
            pr,
          };
        } catch (error: any) {
          next[ws.id] = {
            staged: 0,
            unstaged: 0,
            untracked: 0,
            ahead: 0,
            behind: 0,
            error: error?.message || String(error),
            pr: null,
          };
        }
      }
      if (!cancelled) {
        setRisks(next);
        setLoading(false);
        setLoaded(true);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [enabled, workspaces]);

  const hasData = loaded && Object.keys(risks).length > 0;
  const summary = useMemo(() => {
    const riskyIds = new Set<string>();
    const summaries: Record<string, string> = {};
    for (const ws of workspaces) {
      const status = risks[ws.id];
      if (!status) continue;
      const dirty =
        status.staged > 0 ||
        status.unstaged > 0 ||
        status.untracked > 0 ||
        status.ahead > 0 ||
        !!status.error ||
        !!status.pr;
      if (dirty) {
        riskyIds.add(ws.id);
        const parts = [
          status.staged > 0
            ? `${status.staged} ${status.staged === 1 ? 'file' : 'files'} staged`
            : null,
          status.unstaged > 0
            ? `${status.unstaged} ${status.unstaged === 1 ? 'file' : 'files'} unstaged`
            : null,
          status.untracked > 0
            ? `${status.untracked} ${status.untracked === 1 ? 'file' : 'files'} untracked`
            : null,
          status.ahead > 0
            ? `ahead by ${status.ahead} ${status.ahead === 1 ? 'commit' : 'commits'}`
            : null,
          status.behind > 0
            ? `behind by ${status.behind} ${status.behind === 1 ? 'commit' : 'commits'}`
            : null,
          status.pr ? 'PR open' : null,
        ]
          .filter(Boolean)
          .join(', ');
        summaries[ws.id] = parts || status.error || 'Status unavailable';
      }
    }
    return { riskyIds, summaries };
  }, [risks, workspaces]);

  return { risks, loading, summary, hasData };
}
