import { useCallback, useEffect, useRef, useState } from "react";

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

interface UseWorkspaceChangesOptions {
  isActive?: boolean;
  idleIntervalMs?: number;
}

export function useWorkspaceChanges(
  workspacePath: string,
  workspaceId: string,
  options: UseWorkspaceChangesOptions = {},
) {
  const [changes, setChanges] = useState<WorkspaceChanges>({
    workspaceId,
    changes: [],
    totalAdditions: 0,
    totalDeletions: 0,
    isLoading: true,
  });
  const [isDocumentVisible, setIsDocumentVisible] = useState(() => {
    if (typeof document === "undefined") return true;
    return document.visibilityState === "visible";
  });
  const [isWindowFocused, setIsWindowFocused] = useState(() => {
    if (typeof document === "undefined") return true;
    return document.hasFocus();
  });

  const { isActive = true, idleIntervalMs = 60000 } = options;
  const workspacePathRef = useRef(workspacePath);
  const inFlightRef = useRef(false);
  const hasLoadedRef = useRef(false);
  const shouldPollRef = useRef(false);
  const idleHandleRef = useRef<number | null>(null);
  const idleHandleModeRef = useRef<"idle" | "timeout" | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    workspacePathRef.current = workspacePath;
    hasLoadedRef.current = false;
  }, [workspacePath]);

  useEffect(() => {
    if (typeof document === "undefined" || typeof window === "undefined")
      return;

    const handleVisibility = () => {
      setIsDocumentVisible(document.visibilityState === "visible");
    };
    const handleFocus = () => setIsWindowFocused(true);
    const handleBlur = () => setIsWindowFocused(false);

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  const fetchChanges = useCallback(
    async (isInitialLoad = false) => {
      const currentPath = workspacePathRef.current;
      if (!currentPath || inFlightRef.current) return;

      inFlightRef.current = true;
      try {
        if (isInitialLoad) {
          setChanges((prev) => ({
            ...prev,
            isLoading: true,
            error: undefined,
          }));
        }

        const result = await window.electronAPI.getGitStatus(currentPath);

        if (!mountedRef.current) return;

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
        if (!mountedRef.current) return;
        setChanges({
          workspaceId,
          changes: [],
          totalAdditions: 0,
          totalDeletions: 0,
          isLoading: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      } finally {
        hasLoadedRef.current = true;
        inFlightRef.current = false;
      }
    },
    [workspaceId],
  );

  const clearIdleHandle = useCallback(() => {
    if (idleHandleRef.current === null) return;
    if (idleHandleModeRef.current === "idle") {
      const cancelIdle = (window as any).cancelIdleCallback as
        | ((id: number) => void)
        | undefined;
      cancelIdle?.(idleHandleRef.current);
    } else {
      clearTimeout(idleHandleRef.current);
    }
    idleHandleRef.current = null;
    idleHandleModeRef.current = null;
  }, []);

  const scheduleIdleRefresh = useCallback(() => {
    if (!shouldPollRef.current) return;
    clearIdleHandle();

    const run = () => {
      if (!shouldPollRef.current) return;
      fetchChanges(false);
      scheduleIdleRefresh();
    };

    const requestIdle = (window as any).requestIdleCallback as
      | ((cb: () => void, options?: { timeout: number }) => number)
      | undefined;

    if (requestIdle) {
      idleHandleModeRef.current = "idle";
      idleHandleRef.current = requestIdle(run, { timeout: idleIntervalMs });
    } else {
      idleHandleModeRef.current = "timeout";
      idleHandleRef.current = window.setTimeout(run, idleIntervalMs);
    }
  }, [clearIdleHandle, fetchChanges, idleIntervalMs]);

  const shouldPoll =
    Boolean(workspacePath) && isActive && isDocumentVisible && isWindowFocused;

  useEffect(() => {
    shouldPollRef.current = shouldPoll;
  }, [shouldPoll]);

  useEffect(() => {
    if (!workspacePath || !shouldPoll) {
      clearIdleHandle();
      return;
    }

    fetchChanges(!hasLoadedRef.current);
    scheduleIdleRefresh();

    return () => {
      clearIdleHandle();
    };
  }, [
    workspacePath,
    shouldPoll,
    fetchChanges,
    scheduleIdleRefresh,
    clearIdleHandle,
  ]);

  return {
    ...changes,
  };
}
