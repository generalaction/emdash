import { useCallback, useEffect, useRef, useState } from "react";
import { getCachedGitStatus } from "../lib/gitStatusCache";
import { useDocumentVisibility } from "./useDocumentVisibility";

export interface FileChange {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  diff?: string;
}

export function useFileChanges(workspacePath: string) {
  const [fileChanges, setFileChanges] = useState<FileChange[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isVisible = useDocumentVisibility();
  const pendingRefreshRef = useRef(false);

  const fetchFileChanges = useCallback(
    async (options?: { showLoading?: boolean; force?: boolean }) => {
      if (!workspacePath) return;
      if (!isVisible) {
        pendingRefreshRef.current = true;
        return;
      }

      const showLoading = options?.showLoading ?? false;
      const force = options?.force ?? false;

      if (showLoading) {
        setIsLoading(true);
        setError(null);
      }

      try {
        const result = await getCachedGitStatus(workspacePath, { force });
        if (result?.success && result.changes) {
          const changes: FileChange[] = result.changes.map((change: any) => ({
            path: change.path,
            status: change.status,
            additions: change.additions || 0,
            deletions: change.deletions || 0,
            diff: change.diff,
          }));
          setFileChanges(changes);
        } else {
          if (showLoading)
            setError(result?.error || "Failed to load file changes");
          setFileChanges([]);
        }
      } catch (err) {
        console.error("Failed to fetch file changes:", err);
        if (showLoading) setError("Failed to load file changes");
        setFileChanges([]);
      } finally {
        if (showLoading) setIsLoading(false);
      }
    },
    [workspacePath, isVisible],
  );

  useEffect(() => {
    fetchFileChanges({ showLoading: true });
  }, [fetchFileChanges]);

  useEffect(() => {
    if (!workspacePath) return;
    const api = window.electronAPI;
    let off: (() => void) | undefined;

    const watchPromise = api.watchGitStatus
      ? api.watchGitStatus(workspacePath)
      : Promise.resolve({ success: false });

    watchPromise
      .catch(() => {})
      .finally(() => {
        if (!api.onGitStatusChanged) return;
        off = api.onGitStatusChanged((event) => {
          if (event?.workspacePath !== workspacePath) return;
          fetchFileChanges({ force: true });
        });
      });

    return () => {
      off?.();
      if (api.unwatchGitStatus) {
        api.unwatchGitStatus(workspacePath).catch(() => {});
      }
    };
  }, [workspacePath, fetchFileChanges]);

  useEffect(() => {
    if (!isVisible || !pendingRefreshRef.current) return;
    pendingRefreshRef.current = false;
    fetchFileChanges({ force: true });
  }, [isVisible, fetchFileChanges]);

  const refreshChanges = async () => {
    await fetchFileChanges({ showLoading: true, force: true });
  };

  return {
    fileChanges,
    isLoading,
    error,
    refreshChanges,
  };
}
