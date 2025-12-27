import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Switch } from './ui/switch';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';

const ChatUiSettingsCard: React.FC = () => {
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [checkingTasks, setCheckingTasks] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingNext, setPendingNext] = useState<boolean | null>(null);
  const [taskCount, setTaskCount] = useState<number | undefined | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await window.electronAPI.getSettings();
        if (cancelled) return;
        if (result.success) {
          setEnabled(Boolean(result.settings?.chatUi?.enabled ?? true));
        } else {
          setError(result.error || 'Failed to load settings.');
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Failed to load settings.';
          setError(message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateEnabled = async (next: boolean) => {
    const previous = enabled;
    setEnabled(next);
    setError(null);
    setSaving(true);
    try {
      const result = await window.electronAPI.updateSettings({ chatUi: { enabled: next } });
      if (!result.success) {
        throw new Error(result.error || 'Failed to update settings.');
      }
      setEnabled(Boolean(result.settings?.chatUi?.enabled ?? next));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update settings.';
      setEnabled(previous);
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (next: boolean) => {
    if (loading || saving || checkingTasks) return;
    if (next === enabled) return;

    setError(null);
    setCheckingTasks(true);
    let hasTasks = false;
    let count: number | undefined = 0;
    try {
      const tasks = await window.electronAPI.getTasks();
      count = Array.isArray(tasks) ? tasks.length : 0;
      hasTasks = count > 0;
    } catch {
      // Fail-safe: show warning if we can't determine task state
      hasTasks = true;
      count = undefined; // Sentinel to indicate unknown count
    } finally {
      setCheckingTasks(false);
    }

    if (hasTasks) {
      setTaskCount(count);
      setPendingNext(next);
      setConfirmOpen(true);
      return;
    }

    await updateEnabled(next);
  };

  const handleConfirm = async () => {
    if (pendingNext === null) {
      setConfirmOpen(false);
      return;
    }
    setConfirmOpen(false);
    const next = pendingNext;
    setPendingNext(null);
    await updateEnabled(next);
  };

  return (
    <div className="rounded-xl border border-border/60 bg-muted/10 p-4">
      <label className="flex items-center justify-between gap-2">
        <div className="space-y-1">
          <span className="text-sm">Enable chat UI (ACP)</span>
          <div className="text-xs text-muted-foreground/70">Supported by: Codex CLI</div>
        </div>
        <Switch
          checked={enabled}
          disabled={loading || saving || checkingTasks}
          onCheckedChange={handleToggle}
        />
      </label>
      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmOpen(false);
            setPendingNext(null);
          }
        }}
      >
        <AlertDialogContent className="max-w-md space-y-4">
          <AlertDialogHeader>
            <AlertDialogTitle>Switch chat UI?</AlertDialogTitle>
            <AlertDialogDescription>
              {typeof taskCount === 'number' && taskCount > 0
                ? `You currently have ${taskCount} task${taskCount === 1 ? '' : 's'} open.`
                : taskCount === undefined
                  ? 'You currently have an unknown number of tasks open.'
                  : 'You currently have open tasks.'}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-3 text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <div className="space-y-1 text-sm leading-tight">
              <div className="font-semibold">Switching views resets chat history</div>
              <div className="text-xs text-destructive/90">
                Changing between Chat UI and CLI view starts a new agent session. Your current file
                changes will be kept, but all chat history for open tasks will be lost.
              </div>
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Keep current setting</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive px-4 py-2 text-destructive-foreground hover:bg-destructive/90"
              onClick={handleConfirm}
            >
              {pendingNext === true ? 'Enable chat UI' : 'Disable chat UI'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ChatUiSettingsCard;
