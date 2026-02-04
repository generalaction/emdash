import { useCallback, useEffect, useRef, useState } from "react";

export interface FileChange {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  diff?: string;
}

interface UseFileChangesOptions {
  isActive?: boolean;
  idleIntervalMs?: number;
}

export function useFileChanges(
  workspacePath?: string,
  options: UseFileChangesOptions = {},
) {
  const [fileChanges, setFileChanges] = useState<FileChange[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const fetchFileChanges = useCallback(async (isInitialLoad = false) => {
    const currentPath = workspacePathRef.current;
    if (!currentPath || inFlightRef.current) return;

    inFlightRef.current = true;
    if (isInitialLoad && mountedRef.current) {
      setIsLoading(true);
      setError(null);
    }

    try {
      const result = await window.electronAPI.getGitStatus(currentPath);

      if (!mountedRef.current) return;

      if (result?.success && result.changes && result.changes.length > 0) {
        const changes: FileChange[] = result.changes.map((change: any) => ({
          path: change.path,
          status: change.status,
          additions: change.additions || 0,
          deletions: change.deletions || 0,
          diff: change.diff,
        }));
        setFileChanges(changes);
      } else {
        setFileChanges([]);
      }
    } catch (err) {
      if (!mountedRef.current) return;
      console.error("Failed to fetch file changes:", err);
      if (isInitialLoad) {
        setError("Failed to load file changes");
      }
      setFileChanges([]);
    } finally {
      if (mountedRef.current && isInitialLoad) {
        setIsLoading(false);
      }
      hasLoadedRef.current = true;
      inFlightRef.current = false;
    }
  }, []);

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
      fetchFileChanges(false);
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
  }, [clearIdleHandle, fetchFileChanges, idleIntervalMs]);

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

    fetchFileChanges(!hasLoadedRef.current);
    scheduleIdleRefresh();

    return () => {
      clearIdleHandle();
    };
  }, [
    workspacePath,
    shouldPoll,
    fetchFileChanges,
    scheduleIdleRefresh,
    clearIdleHandle,
  ]);

  const refreshChanges = async () => {
    await fetchFileChanges(true);
  };

  return {
    fileChanges,
    isLoading,
    error,
    refreshChanges,
  };
}
