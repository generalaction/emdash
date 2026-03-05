import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isActivePr, type PrInfo } from '../lib/prStatus';
import { getCachedPrStatus, refreshPrStatus } from '../lib/prStatusStore';
import { getCachedGitStatus } from '../lib/gitStatusCache';

type TaskRef = { id: string; name: string; path: string };

type RiskState = Record<
  string,
  {
    staged: number;
    unstaged: number;
    untracked: number;
    ahead: number;
    behind: number;
    error?: string;
    pr?: PrInfo | null;
    prKnown: boolean;
  }
>;

export const DELETE_RISK_SCAN_FRESH_MS = 10_000;

function hasDeleteRisk(status?: {
  staged: number;
  unstaged: number;
  untracked: number;
  ahead: number;
  behind: number;
  error?: string;
  pr?: PrInfo | null;
}) {
  if (!status) return false;
  return (
    status.staged > 0 ||
    status.unstaged > 0 ||
    status.untracked > 0 ||
    status.ahead > 0 ||
    !!status.error ||
    !!(status.pr && isActivePr(status.pr))
  );
}

type UseDeleteRisksOptions = {
  eagerPrRefresh?: boolean;
};

export function useDeleteRisks(
  tasks: TaskRef[],
  enabled: boolean,
  options?: UseDeleteRisksOptions
) {
  const [risks, setRisks] = useState<RiskState>({});
  const [scannedAtById, setScannedAtById] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const requestIdRef = useRef(0);
  const inFlightCountRef = useRef(0);
  const eagerPrRefresh = options?.eagerPrRefresh ?? true;

  const scanRisks = useCallback(
    async (options?: { force?: boolean }): Promise<RiskState> => {
      if (!enabled || tasks.length === 0) {
        requestIdRef.current += 1;
        inFlightCountRef.current = 0;
        setRisks({});
        setScannedAtById({});
        setLoading(false);
        setLoaded(false);
        return {};
      }

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      inFlightCountRef.current += 1;
      setLoading(true);

      try {
        const includePr = options?.force || eagerPrRefresh;
        try {
          const bulkRes = await (window as any).electronAPI?.getDeleteRisks?.({
            targets: tasks.map((task) => ({ id: task.id, taskPath: task.path })),
            includePr,
          });

          if (bulkRes?.success && bulkRes.risks && typeof bulkRes.risks === 'object') {
            const entries = tasks.map((task) => {
              const item = bulkRes.risks[task.id] || {};
              return [
                task.id,
                {
                  staged: typeof item.staged === 'number' ? item.staged : 0,
                  unstaged: typeof item.unstaged === 'number' ? item.unstaged : 0,
                  untracked: typeof item.untracked === 'number' ? item.untracked : 0,
                  ahead: typeof item.ahead === 'number' ? item.ahead : 0,
                  behind: typeof item.behind === 'number' ? item.behind : 0,
                  error: typeof item.error === 'string' ? item.error : undefined,
                  pr: item.pr ?? null,
                  prKnown: item.prKnown === true,
                },
              ] as const;
            });

            const next = Object.fromEntries(entries);
            if (requestIdRef.current === requestId) {
              setRisks(next);
              const scannedAt = Date.now();
              setScannedAtById(
                Object.fromEntries(entries.map(([id]) => [id, scannedAt])) as Record<string, number>
              );
              setLoaded(true);
            }

            return next;
          }
        } catch {
          // Fallback to per-task scan below
        }

        const entries = await Promise.all(
          tasks.map(async (ws) => {
            try {
              const [statusRes, infoRes, rawPr] = await Promise.allSettled([
                getCachedGitStatus(ws.path, { force: options?.force }),
                (window as any).electronAPI?.getGitInfo?.(ws.path),
                options?.force || eagerPrRefresh
                  ? refreshPrStatus(ws.path)
                  : Promise.resolve(getCachedPrStatus(ws.path)),
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
              const prKnown = rawPr.status === 'fulfilled' && rawPr.value !== undefined;
              const prValue = prKnown ? rawPr.value : null;
              const pr = isActivePr(prValue) ? prValue : null;

              return [
                ws.id,
                {
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
                  prKnown,
                },
              ] as const;
            } catch (error: any) {
              return [
                ws.id,
                {
                  staged: 0,
                  unstaged: 0,
                  untracked: 0,
                  ahead: 0,
                  behind: 0,
                  error: error?.message || String(error),
                  pr: null,
                  prKnown: false,
                },
              ] as const;
            }
          })
        );

        const next = Object.fromEntries(entries);
        if (requestIdRef.current === requestId) {
          setRisks(next);
          const scannedAt = Date.now();
          setScannedAtById(
            Object.fromEntries(entries.map(([id]) => [id, scannedAt])) as Record<string, number>
          );
          setLoaded(true);
        }

        return next;
      } finally {
        inFlightCountRef.current = Math.max(0, inFlightCountRef.current - 1);
        setLoading(inFlightCountRef.current > 0);
      }
    },
    [eagerPrRefresh, enabled, tasks]
  );

  useEffect(() => {
    if (!enabled || tasks.length === 0) {
      requestIdRef.current += 1;
      inFlightCountRef.current = 0;
      setRisks({});
      setScannedAtById({});
      setLoading(false);
      setLoaded(false);
      return;
    }
    void scanRisks();
    return () => {
      requestIdRef.current += 1;
    };
  }, [enabled, tasks, scanRisks]);

  const hasData = loaded && Object.keys(risks).length > 0;
  const summary = useMemo(() => {
    const riskyIds = new Set<string>();
    const summaries: Record<string, string> = {};
    for (const ws of tasks) {
      const status = risks[ws.id];
      if (!status) continue;
      if (hasDeleteRisk(status)) {
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
          status.pr && isActivePr(status.pr) ? 'PR open' : null,
        ]
          .filter(Boolean)
          .join(', ');
        summaries[ws.id] = parts || status.error || 'Status unavailable';
      }
    }
    return { riskyIds, summaries };
  }, [risks, tasks]);

  const refresh = useCallback(
    async (options?: { force?: boolean }) => scanRisks({ force: options?.force ?? true }),
    [scanRisks]
  );

  return { risks, scannedAtById, loading, summary, hasData, refresh };
}
