import { useCallback, useEffect, useRef, useState } from "react";
import { getCachedGitStatus } from "../lib/gitStatusCache";
import { useDocumentVisibility } from "./useDocumentVisibility";

export interface WorkspaceChange {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  diff?: string;
}

export interface WorkspaceChanges {
  workspaceId: string;
  changes: WorkspaceChange[];
  totalAdditions: number;
  totalDeletions: number;
  isLoading: boolean;
  error?: string;
}

export function useWorkspaceChanges(
  workspacePath: string,
  workspaceId: string,
) {
  const [changes, setChanges] = useState<WorkspaceChanges>({
    workspaceId,
    changes: [],
    totalAdditions: 0,
    totalDeletions: 0,
    isLoading: true,
  });
  const isVisible = useDocumentVisibility();
  const pendingRefreshRef = useRef(false);

  const fetchChanges = useCallback(
    async (options?: { showLoading?: boolean; force?: boolean }) => {
      if (!workspacePath) return;
      if (!isVisible) {
        pendingRefreshRef.current = true;
        return;
      }

      const showLoading = options?.showLoading ?? false;
      const force = options?.force ?? false;

      if (showLoading) {
        setChanges((prev) => ({ ...prev, isLoading: true, error: undefined }));
      }

      try {
        const result = await getCachedGitStatus(workspacePath, { force });
        if (result.success && result.changes) {
          const totalAdditions = result.changes.reduce(
            (sum, change) => sum + change.additions,
            0,
          );
          const totalDeletions = result.changes.reduce(
            (sum, change) => sum + change.deletions,
            0,
          );

          setChanges({
            workspaceId,
            changes: result.changes,
            totalAdditions,
            totalDeletions,
            isLoading: false,
          });
        } else {
          setChanges({
            workspaceId,
            changes: [],
            totalAdditions: 0,
            totalDeletions: 0,
            isLoading: false,
            error: result.error || "Failed to fetch changes",
          });
        }
      } catch (error) {
        setChanges({
          workspaceId,
          changes: [],
          totalAdditions: 0,
          totalDeletions: 0,
          isLoading: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },
    [workspacePath, workspaceId, isVisible],
  );

  useEffect(() => {
    fetchChanges({ showLoading: true });
  }, [fetchChanges]);

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
          fetchChanges({ force: true });
        });
      });

    return () => {
      off?.();
      if (api.unwatchGitStatus) {
        api.unwatchGitStatus(workspacePath).catch(() => {});
      }
    };
  }, [workspacePath, fetchChanges]);

  useEffect(() => {
    if (!isVisible || !pendingRefreshRef.current) return;
    pendingRefreshRef.current = false;
    fetchChanges({ force: true });
  }, [isVisible, fetchChanges]);

  return {
    ...changes,
  };
}
