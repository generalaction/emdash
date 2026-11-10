import { Button } from '@emdash/ui/react/primitives';
import { useRef, useState } from 'react';
import { getIssuesClient } from '../api/browser/client';
import type { JiraSyncResult } from '../api/jira-sync';

export function SyncJiraButton({
  projectId,
  disabledReason,
}: {
  projectId: string;
  disabledReason?: string;
}) {
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<JiraSyncResult | null>(null);

  async function sync() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setResult(null);
    try {
      const client = await getIssuesClient();
      setResult(await client.syncAssignedJiraIssues({ projectId }));
    } catch (error) {
      setResult({
        success: false,
        error: {
          type: 'generic',
          message:
            error instanceof Error ? error.message : 'Unable to sync Jira issues. Please retry.',
        },
      });
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        variant="secondary"
        disabled={busy || !!disabledReason}
        title={disabledReason}
        onClick={() => void sync()}
      >
        {busy ? 'Syncing Jira issues…' : 'Sync assigned Jira issues'}
      </Button>
      {result && (
        <div
          role={result.success && !result.data.failures.length ? 'status' : 'alert'}
          className="max-w-sm text-xs text-foreground-muted"
        >
          {result.success ? (
            <>
              <p>
                {result.data.created} created, {result.data.refreshed} refreshed,{' '}
                {result.data.skipped} skipped.
              </p>
              {result.data.failures.length > 0 && (
                <details>
                  <summary>
                    {result.data.failures.length} issues failed. Expand for details, then retry
                    sync.
                  </summary>
                  <ul className="max-h-48 overflow-auto">
                    {result.data.failures.map((failure, index) => (
                      <li key={`${failure.identifier}-${index}`}>
                        {failure.identifier}: {failure.message}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          ) : (
            result.error.message
          )}
        </div>
      )}
    </div>
  );
}
