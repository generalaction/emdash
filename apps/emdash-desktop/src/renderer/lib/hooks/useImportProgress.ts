import { useEffect, useRef, useState } from 'react';

const PROGRESS_DURATION_MS = 4000;
const COMPLETE_DELAY_MS = 1000;

type ImportProgressActionResult = { success: boolean; error?: string };

type RunImportProgressOptions = {
  onComplete: () => void;
};

export function useImportProgress() {
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const animationRef = useRef<number | null>(null);
  const completeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const importDoneRef = useRef(false);
  const animationDoneRef = useRef(false);

  useEffect(() => {
    return () => {
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
      if (completeTimerRef.current !== null) clearTimeout(completeTimerRef.current);
    };
  }, []);

  const cancelAnimation = () => {
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
  };

  const clearCompleteTimer = () => {
    if (completeTimerRef.current !== null) {
      clearTimeout(completeTimerRef.current);
      completeTimerRef.current = null;
    }
  };

  const resetRunState = () => {
    cancelAnimation();
    clearCompleteTimer();
    setError(null);
    setIsImporting(true);
    setProgress(0);
    importDoneRef.current = false;
    animationDoneRef.current = false;
  };

  const maybeScheduleComplete = (onComplete: () => void) => {
    if (importDoneRef.current && animationDoneRef.current && completeTimerRef.current === null) {
      completeTimerRef.current = setTimeout(() => {
        onComplete();
      }, COMPLETE_DELAY_MS);
    }
  };

  const startAnimation = (onComplete: () => void) => {
    let startTime: number | null = null;

    const tick = (now: number) => {
      startTime ??= now;
      const elapsed = now - startTime;
      const pct = Math.min(elapsed / PROGRESS_DURATION_MS, 1);
      setProgress(Math.round(pct * 100));

      if (pct < 1) {
        animationRef.current = requestAnimationFrame(tick);
        return;
      }

      animationRef.current = null;
      animationDoneRef.current = true;
      maybeScheduleComplete(onComplete);
    };

    animationRef.current = requestAnimationFrame(tick);
  };

  const run = async (
    action: () => Promise<ImportProgressActionResult>,
    options: RunImportProgressOptions
  ) => {
    resetRunState();
    startAnimation(options.onComplete);

    try {
      const result = await action();
      if (!result.success) {
        cancelAnimation();
        setError(result.error ?? 'Import failed');
        setIsImporting(false);
        setProgress(0);
        return;
      }

      importDoneRef.current = true;
      maybeScheduleComplete(options.onComplete);
    } catch (err) {
      cancelAnimation();
      setError(err instanceof Error ? err.message : 'Import failed');
      setIsImporting(false);
      setProgress(0);
    }
  };

  return { clearError: () => setError(null), error, isImporting, progress, run };
}
