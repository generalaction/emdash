import { Import } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLegacyPortImport, useLegacyPortPreview } from '@renderer/lib/hooks/useLegacyPort';
import { Button } from '@renderer/lib/ui/button';

const PROGRESS_DURATION_MS = 4000;
const COMPLETE_DELAY_MS = 1000;

export function ImportStep({ onComplete }: { onComplete: () => void }) {
  const { data: preview, isLoading: previewLoading } = useLegacyPortPreview(true);
  const importMutation = useLegacyPortImport();

  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [importError, setImportError] = useState<string | null>(null);

  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

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

  const maybeScheduleComplete = () => {
    if (importDoneRef.current && animationDoneRef.current && completeTimerRef.current === null) {
      completeTimerRef.current = setTimeout(() => {
        onCompleteRef.current();
      }, COMPLETE_DELAY_MS);
    }
  };

  const startAnimation = () => {
    const startTime = performance.now();

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const pct = Math.min(elapsed / PROGRESS_DURATION_MS, 1);
      setProgress(Math.round(pct * 100));

      if (pct < 1) {
        animationRef.current = requestAnimationFrame(tick);
      } else {
        animationRef.current = null;
        animationDoneRef.current = true;
        maybeScheduleComplete();
      }
    };

    animationRef.current = requestAnimationFrame(tick);
  };

  const handleImport = async () => {
    setImportError(null);
    setIsImporting(true);
    setProgress(0);
    importDoneRef.current = false;
    animationDoneRef.current = false;
    completeTimerRef.current = null;

    startAnimation();

    try {
      const result = await importMutation.mutateAsync();
      if (!result.success) {
        if (animationRef.current !== null) {
          cancelAnimationFrame(animationRef.current);
          animationRef.current = null;
        }
        setImportError(result.error ?? 'Import failed');
        setIsImporting(false);
        setProgress(0);
        return;
      }
      importDoneRef.current = true;
      maybeScheduleComplete();
    } catch (err) {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      setImportError(err instanceof Error ? err.message : 'Import failed');
      setIsImporting(false);
      setProgress(0);
    }
  };

  const projectCount = preview?.projects ?? 0;
  const taskCount = preview?.tasks ?? 0;

  return (
    <div className="flex flex-col space-y-8 max-w-sm w-full">
      <div className="flex flex-col items-center justify-center gap-4">
        <div className="flex flex-col items-center justify-center gap-6">
          <Import className="h-10 w-10" absoluteStrokeWidth strokeWidth={1.5} />
          <div className="flex flex-col items-center justify-center gap-2">
            <h1 className="text-xl text-center">Import your Emdash v0 data</h1>
            {previewLoading ? (
              <p className="text-md text-foreground-muted text-center">
                Scanning legacy database...
              </p>
            ) : (
              <p className="text-md text-foreground-muted text-center">
                Found <span className="text-foreground font-medium">{projectCount}</span>{' '}
                {projectCount === 1 ? 'project' : 'projects'} and{' '}
                <span className="text-foreground font-medium">{taskCount}</span>{' '}
                {taskCount === 1 ? 'task' : 'tasks'} from your previous Emdash installation
              </p>
            )}
          </div>
        </div>
      </div>

      {isImporting && (
        <div className="flex flex-col gap-2">
          <div className="w-full h-2 bg-background-1 rounded-full overflow-hidden">
            <div className="h-full bg-foreground rounded-full" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-xs text-foreground-muted text-center">{progress}%</p>
        </div>
      )}

      {importError && <p className="text-sm text-destructive text-center">{importError}</p>}

      <div className="flex flex-col w-full gap-2">
        <Button size={'lg'} onClick={handleImport} disabled={isImporting || previewLoading}>
          {isImporting ? 'Importing...' : 'Import data'}
        </Button>
        <Button variant="ghost" onClick={onComplete} disabled={isImporting}>
          Skip
        </Button>
      </div>
    </div>
  );
}
