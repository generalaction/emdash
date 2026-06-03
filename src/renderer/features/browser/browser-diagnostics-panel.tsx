import { AlertCircle, Info, TriangleAlert } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { browserDiagnosticsStore } from './browser-diagnostics-store';

export const BrowserDiagnosticsPanel = observer(function BrowserDiagnosticsPanel({
  browserId,
}: {
  browserId: string;
}) {
  const entries = browserDiagnosticsStore.entriesForBrowser(browserId).slice(-50).reverse();

  return (
    <div className="h-32 shrink-0 overflow-hidden border-t border-border bg-background-secondary">
      <div className="flex h-8 items-center justify-between px-3 text-xs text-foreground-muted">
        <span>Diagnostics</span>
        <button
          type="button"
          className="rounded px-2 py-1 hover:bg-background-secondary-1"
          onClick={() => browserDiagnosticsStore.clearBrowser(browserId)}
        >
          Clear
        </button>
      </div>
      <div className="h-24 overflow-auto px-2 pb-2">
        {entries.length === 0 ? (
          <div className="px-1 py-2 text-xs text-foreground-muted">No browser diagnostics</div>
        ) : (
          entries.map((entry) => (
            <div
              key={entry.id}
              className="grid grid-cols-[16px_72px_1fr] items-start gap-2 border-t border-border/60 py-1 text-xs first:border-t-0"
            >
              <DiagnosticIcon level={entry.level} />
              <span className="text-foreground-muted">{entry.source}</span>
              <div className="min-w-0">
                <div className="truncate text-foreground">{entry.message}</div>
                {entry.url && <div className="truncate text-foreground-muted">{entry.url}</div>}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
});

function DiagnosticIcon({ level }: { level: 'info' | 'warning' | 'error' }) {
  if (level === 'error') return <AlertCircle className="text-destructive mt-0.5 size-3.5" />;
  if (level === 'warning') {
    return <TriangleAlert className="mt-0.5 size-3.5 text-yellow-500" />;
  }
  return <Info className="mt-0.5 size-3.5 text-foreground-muted" />;
}
