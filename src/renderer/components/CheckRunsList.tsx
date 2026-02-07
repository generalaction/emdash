import { CheckCircle2, XCircle, Loader2, MinusCircle, ExternalLink } from 'lucide-react';
import githubIcon from '../../assets/images/github.png';
import type { CheckRunsStatus, CheckRun, CheckRunBucket } from '../lib/checkRunStatus';
import { formatCheckDuration } from '../lib/checkRunStatus';

function BucketIcon({ bucket }: { bucket: CheckRunBucket }) {
  switch (bucket) {
    case 'pass':
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
    case 'fail':
      return <XCircle className="h-3.5 w-3.5 text-red-500" />;
    case 'pending':
      return <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-500" />;
    case 'skipping':
    case 'cancel':
      return <MinusCircle className="h-3.5 w-3.5 text-muted-foreground/60" />;
  }
}

function CheckRunItem({ check }: { check: CheckRun }) {
  const duration = formatCheckDuration(check.startedAt, check.completedAt);

  return (
    <div className="flex items-center gap-2 border-b border-border/50 px-4 py-2.5 last:border-b-0">
      <span className="shrink-0">
        <BucketIcon bucket={check.bucket} />
      </span>
      <img src={githubIcon} alt="" className="h-3.5 w-3.5 shrink-0 dark:invert" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-foreground">{check.name}</div>
        {check.workflow && (
          <div className="truncate text-xs text-muted-foreground">{check.workflow}</div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {duration && <span className="text-xs text-muted-foreground">{duration}</span>}
        {check.link && (
          <button
            type="button"
            className="text-muted-foreground transition-colors hover:text-foreground"
            title="Open in GitHub"
            onClick={() => check.link && window.electronAPI?.openExternal?.(check.link)}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

interface ChecksPanelProps {
  status: CheckRunsStatus | null;
  isLoading: boolean;
  hasPr: boolean;
  hideSummary?: boolean;
}

export function ChecksPanel({ status, isLoading, hasPr, hideSummary }: ChecksPanelProps) {
  if (!hasPr) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center">
        <p className="text-sm text-muted-foreground">No PR exists for this branch.</p>
      </div>
    );
  }

  if (isLoading && !status) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!status || !status.checks || status.checks.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center">
        <div>
          <p className="text-sm text-muted-foreground">No CI checks found for this repository</p>
        </div>
      </div>
    );
  }

  const { summary } = status;

  return (
    <div className="flex flex-col">
      {!hideSummary && (
        <div className="flex items-center gap-2 border-b border-border px-4 py-2">
          <div className="flex items-center gap-1.5 text-xs">
            {summary.passed > 0 && (
              <span className="font-medium text-emerald-600 dark:text-emerald-400">
                {summary.passed} passed
              </span>
            )}
            {summary.failed > 0 && (
              <>
                {summary.passed > 0 && <span className="text-muted-foreground">/</span>}
                <span className="font-medium text-red-600 dark:text-red-400">
                  {summary.failed} failed
                </span>
              </>
            )}
            {summary.pending > 0 && (
              <>
                {(summary.passed > 0 || summary.failed > 0) && (
                  <span className="text-muted-foreground">/</span>
                )}
                <span className="font-medium text-amber-600 dark:text-amber-400">
                  {summary.pending} pending
                </span>
              </>
            )}
          </div>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {status.checks.map((check, i) => (
          <CheckRunItem key={`${check.name}-${i}`} check={check} />
        ))}
      </div>
    </div>
  );
}
