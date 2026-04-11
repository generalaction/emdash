import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { useToast } from './use-toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { ToastAction } from '../components/ui/toast';

interface ShowErrorOptions {
  /**
   * Optional summarizer that turns the raw error into a one-line toast description.
   * If omitted, the first non-empty line of the raw error is used (capped at 120 chars).
   */
  summarize?: (raw: string) => string;
}

interface UseErrorDetailsResult {
  /** Show a destructive toast with a "View details" action that opens a dialog with the full output. */
  showError: (title: string, rawError: string, options?: ShowErrorOptions) => void;
  /** JSX to render somewhere inside the consuming component. */
  errorDialog: React.ReactNode;
}

function defaultSummarize(raw: string): string {
  const firstLine = raw.split('\n').find((l) => l.trim().length > 0) || raw;
  return firstLine.length > 120 ? firstLine.slice(0, 120) + '...' : firstLine;
}

/**
 * Provides a `showError` helper that pairs a friendly destructive toast with a
 * "View details" action button. Clicking the action opens a dialog containing
 * the full multi-line error output, with a copy-to-clipboard button.
 *
 * Use this whenever you want to surface stderr/stdout from an external process
 * (git, hooks, package managers) without losing information to truncation.
 */
export function useErrorDetails(): UseErrorDetailsResult {
  const { toast } = useToast();
  const [details, setDetails] = useState<{ title: string; message: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const showError = useCallback(
    (title: string, rawError: string, options?: ShowErrorOptions) => {
      const fullMessage = rawError?.trim() ? rawError : 'Unknown error';
      const summarize = options?.summarize ?? defaultSummarize;
      toast({
        title,
        description: summarize(fullMessage),
        variant: 'destructive',
        action: (
          <ToastAction
            altText="View full error details"
            onClick={() => {
              setDetails({ title, message: fullMessage });
              setOpen(true);
            }}
          >
            View details
          </ToastAction>
        ),
      });
    },
    [toast]
  );

  const handleCopy = async () => {
    if (!details?.message) return;
    try {
      await navigator.clipboard.writeText(details.message);
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be unavailable; ignore.
    }
  };

  const errorDialog = (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setCopied(false);
      }}
    >
      <DialogContent className="max-w-2xl gap-3">
        <DialogHeader>
          <DialogTitle>{details?.title ?? 'Error'}</DialogTitle>
          <DialogDescription>Full output, including any hook errors.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/50 p-3 pr-10 font-mono text-xs leading-relaxed text-foreground">
            {details?.message ?? ''}
          </pre>
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title={copied ? 'Copied' : 'Copy to clipboard'}
            aria-label={copied ? 'Copied' : 'Copy to clipboard'}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );

  return { showError, errorDialog };
}
