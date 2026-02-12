import { CheckCircle2, XCircle, Loader2, MinusCircle, ExternalLink } from 'lucide-react';
import githubIcon from '../../assets/images/github.png';
import type { CheckRunsStatus, CheckRun, CheckRunBucket } from '../lib/checkRunStatus';
import { formatCheckDuration } from '../lib/checkRunStatus';
import { Badge } from './ui/badge';

function BucketIcon({ bucket }: { bucket: CheckRunBucket }) {
  switch (bucket) {
    case 'pass':
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
    case 'fail':
      return <XCircle className="h-3.5 w-3.5 text-red-500" />;
    case 'pending':
      return <span className="inline-block h-3.5 w-3.5 rounded-full bg-amber-500" />;
    case 'skipping':
    case 'cancel':
      return <MinusCircle className="h-3.5 w-3.5 text-muted-foreground/60" />;
  }
}

function CheckRunItem({ check }: { check: CheckRun }) {
  const duration = formatCheckDuration(check.startedAt, check.completedAt);

  return (
    <div className="flex items-center gap-2 px-4 py-2.5">
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
        <div className="flex items-center gap-1.5 border-b border-border px-4 py-2">
          {summary.passed > 0 && (
            <Badge variant="outline">
              <CheckCircle2 className="h-3 w-3 text-emerald-500" />
              {summary.passed} passed
            </Badge>
          )}
          {summary.failed > 0 && (
            <Badge variant="outline">
              <XCircle className="h-3 w-3 text-red-500" />
              {summary.failed} failed
            </Badge>
          )}
          {summary.pending > 0 && (
            <Badge variant="outline">
              <Loader2 className="h-3 w-3 animate-spin" />
              {summary.pending} pending
            </Badge>
          )}
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
