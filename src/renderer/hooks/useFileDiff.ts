import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useDocumentVisibility } from "./useDocumentVisibility";

export type DiffLine = {
  left?: string;
  right?: string;
  type: "context" | "add" | "del";
};

type DiffCacheEntry = {
  lines: DiffLine[];
  error: string | null;
  timestamp: number;
};

const CACHE_TTL_MS = 30000;

const diffCache = new Map<string, DiffCacheEntry>();
const inFlight = new Map<string, Promise<DiffCacheEntry>>();

const buildKey = (workspacePath: string, filePath: string) =>
  `${workspacePath}::${filePath}`;

const fetchDiff = async (
  workspacePath: string,
  filePath: string,
): Promise<DiffCacheEntry> => {
  try {
    const res = await window.electronAPI.getFileDiff({
      workspacePath,
      filePath,
    });
    if (res?.success && res.diff) {
      return { lines: res.diff.lines, error: null, timestamp: Date.now() };
    }
    return {
      lines: [],
      error: res?.error || "Failed to load diff",
      timestamp: Date.now(),
    };
  } catch (e: any) {
    return {
      lines: [],
      error: e?.message || "Failed to load diff",
      timestamp: Date.now(),
    };
  }
};

export function useFileDiff(
  workspacePath: string | undefined,
  filePath: string | undefined,
  options?: { enabled?: boolean },
) {
  const enabled = options?.enabled ?? true;
  const isVisible = useDocumentVisibility();
  const [lines, setLines] = useState<DiffLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshSeq, bumpRefresh] = useReducer((n) => n + 1, 0);
  const refreshSeqRef = useRef(0);

  const refresh = useCallback(() => bumpRefresh(), []);

  useEffect(() => {
    let cancelled = false;
    if (!workspacePath || !filePath) return;
    if (!enabled || !isVisible) return;

    const key = buildKey(workspacePath, filePath);
    const now = Date.now();
    const force = refreshSeqRef.current !== refreshSeq;
    refreshSeqRef.current = refreshSeq;

    const cached = diffCache.get(key);
    if (!force && cached && now - cached.timestamp < CACHE_TTL_MS) {
      setLines(cached.lines);
      setError(cached.error);
      setLoading(false);
      return;
    }

    let pending = inFlight.get(key);
    const isOwner = !pending;
    if (!pending) {
      pending = (async () => {
        const result = await fetchDiff(workspacePath, filePath);
        diffCache.set(key, result);
        return result;
      })();
      inFlight.set(key, pending);
    }

    setLoading(true);
    setError(null);

    pending
      .then((result) => {
        if (cancelled) return;
        setLines(result.lines);
        setError(result.error);
      })
      .catch((e: any) => {
        if (!cancelled) setError(e?.message || "Failed to load diff");
      })
      .finally(() => {
        if (isOwner) inFlight.delete(key);
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [workspacePath, filePath, enabled, isVisible, refreshSeq]);

  return { lines, loading, error, refresh };
}
