import { X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
import { CLISpinner } from '@renderer/features/tasks/components/cliSpinner';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { cn } from '@renderer/utils/utils';
import type { SetupScriptSuggestion } from '@shared/core/projects/setup-suggestion';
import {
  clearSetupSuggestionEligibility,
  dismissSetupSuggestion,
  shouldShowSetupSuggestion,
} from './setup-suggestion-state';

type Phase = 'hidden' | 'visible' | 'applying' | 'applied';

/** Keep the spinner visible long enough to read as deliberate feedback, not a flicker. */
const MIN_APPLYING_MS = 450;

/**
 * A minimal, dismissible suggestion anchored bottom-right of the project view.
 * After a project is added for the first time, we detect its tooling (Bun, pnpm,
 * Cargo, …) and offer the matching install command as a one-click lifecycle setup
 * script if no `scripts.setup` is configured yet.
 */
export function SetupSuggestionToast({ projectId }: { projectId: string }) {
  const [suggestion, setSuggestion] = useState<SetupScriptSuggestion | null>(null);
  const [phase, setPhase] = useState<Phase>('hidden');

  useEffect(() => {
    setSuggestion(null);
    setPhase('hidden');
    if (!shouldShowSetupSuggestion(projectId)) return;

    let cancelled = false;
    void rpc.projects
      .suggestSetupScript(projectId)
      .then((result) => {
        if (cancelled) return;
        if (!result) {
          clearSetupSuggestionEligibility(projectId);
          return;
        }
        setSuggestion(result);
        setPhase('visible');
      })
      .catch(() => {
        // Detection is best-effort; stay silent on failure.
        clearSetupSuggestionEligibility(projectId);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const handleDismiss = useCallback(() => {
    dismissSetupSuggestion(projectId);
    setPhase('hidden');
  }, [projectId]);

  const handleApply = useCallback(async () => {
    if (!suggestion) return;
    setPhase('applying');
    const minVisible = new Promise<void>((resolve) => window.setTimeout(resolve, MIN_APPLYING_MS));

    try {
      const result = await rpc.projects.applySetupScript(projectId, suggestion.command);
      await minVisible;
      if (!result.success) {
        if (result.error.type === 'setup-script-already-configured') {
          setPhase('hidden');
          return;
        }
        toast({ title: 'Could not add setup script', variant: 'destructive' });
        setPhase('visible');
        return;
      }
      dismissSetupSuggestion(projectId);
      setPhase('applied');
      window.setTimeout(() => setPhase('hidden'), 1800);
    } catch {
      await minVisible;
      toast({ title: 'Could not add setup script', variant: 'destructive' });
      setPhase('visible');
    }
  }, [projectId, suggestion]);

  const open = phase !== 'hidden' && suggestion !== null;

  return (
    <AnimatePresence>
      {open && suggestion && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className="fixed right-4 bottom-4 z-50 w-[320px] rounded-xl border border-border bg-background-quaternary p-4 shadow-md"
          role="status"
        >
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Dismiss suggestion"
            className="absolute top-2.5 right-2.5 rounded p-1 text-foreground-tertiary-muted transition-colors hover:text-foreground-tertiary"
          >
            <X className="size-3.5" />
          </button>

          <p className="pr-5 text-sm font-semibold text-foreground">
            Set up your {suggestion.displayName} project
          </p>

          {phase === 'applied' ? (
            <p className="mt-1.5 text-xs leading-relaxed text-foreground-muted">
              Added as a setup script — runs on every new task.
            </p>
          ) : (
            <>
              <p className="mt-1.5 text-xs leading-relaxed text-foreground-muted">
                Run{' '}
                <code className="rounded bg-background-quaternary-1 px-1 py-0.5 font-mono text-[11px] text-foreground">
                  {suggestion.command}
                </code>{' '}
                automatically whenever you create a new task.
              </p>
              <div className="mt-3 flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleDismiss}
                  disabled={phase === 'applying'}
                >
                  Not now
                </Button>
                <Button
                  size="sm"
                  onClick={handleApply}
                  disabled={phase === 'applying'}
                  className="justify-center"
                >
                  <span className="grid items-center">
                    <span
                      className={cn(
                        'col-start-1 row-start-1 flex items-center justify-center gap-1 transition-opacity duration-150',
                        phase === 'applying' ? 'opacity-100' : 'opacity-0'
                      )}
                    >
                      {phase === 'applying' && <CLISpinner />}
                      Adding
                    </span>
                    <span
                      className={cn(
                        'col-start-1 row-start-1 transition-opacity duration-150',
                        phase === 'applying' ? 'opacity-0' : 'opacity-100'
                      )}
                    >
                      Add setup script
                    </span>
                  </span>
                </Button>
              </div>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
