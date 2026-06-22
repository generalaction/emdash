/**
 * PermissionBand — a composer-docked band that surfaces an ACP permission
 * request to the user.
 *
 * Renders flush above the composer input box, styled like NoticeBand but with
 * a SplitButton instead of a dismiss button.  A "1 of N" counter is shown when
 * multiple requests are queued, so the user knows more are coming.
 *
 * Tone mapping from ACP PermissionOption.kind:
 *   allow_*  → accept
 *   reject_* → reject
 *   other    → neutral
 */

import { ShieldAlertIcon } from 'lucide-react';
import * as React from 'react';
import { cn } from '../lib/cn';
import { SplitButton } from '../primitives/split-button';
import type { SplitButtonOption } from '../primitives/split-button';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ComposerPermissionOption = {
  optionId: string;
  name: string;
  kind: string;
};

export type ComposerPermissionRequest = {
  requestId: string;
  /** Pre-formatted action verb, e.g. "Read a File", "Execute". */
  title: string;
  options: ComposerPermissionOption[];
};

export interface PermissionBandProps {
  request: ComposerPermissionRequest;
  /** Total pending count including this one. Used to render "1 of N". */
  queueCount?: number;
  /** Called with the chosen optionId, or null to cancel. */
  onResolve: (optionId: string | null) => void;
  className?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function kindToTone(kind: string): SplitButtonOption['tone'] {
  if (kind.startsWith('allow_')) return 'accept';
  if (kind.startsWith('reject_')) return 'reject';
  return 'neutral';
}

function defaultSelectedId(options: ComposerPermissionOption[]): string | undefined {
  return (
    options.find((o) => o.kind === 'allow_once')?.optionId ??
    options.find((o) => o.kind.startsWith('allow_'))?.optionId ??
    options[0]?.optionId
  );
}

// ── PermissionBand ────────────────────────────────────────────────────────────

export function PermissionBand({
  request,
  queueCount = 1,
  onResolve,
  className,
}: PermissionBandProps) {
  const splitOptions: SplitButtonOption[] = request.options.map((o) => ({
    id: o.optionId,
    label: o.name,
    tone: kindToTone(o.kind),
  }));

  const [selectedId, setSelectedId] = React.useState<string | undefined>(() =>
    defaultSelectedId(request.options)
  );

  // Reset selection when the request changes (a new request came in after resolving).
  // request.options is intentionally excluded: we only want to reset on a new request (new requestId),
  // not every time the options array reference changes while the same request is displayed.
  React.useEffect(() => {
    setSelectedId(defaultSelectedId(request.options));
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [request.requestId]);

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-t-xl border border-b-0 px-3 py-2',
        'bg-surface border-border text-foreground text-xs',
        className
      )}
    >
      <ShieldAlertIcon className="size-3.5 shrink-0 text-foreground-muted" aria-hidden />

      {/* Context label */}
      <span className="flex-1 leading-snug text-foreground-muted">
        <span className="font-medium text-foreground">Allow</span> <span>{request.title}</span>
        {queueCount > 1 && (
          <span className="ml-1.5 opacity-60">
            ({1} of {queueCount})
          </span>
        )}
      </span>

      {/* Split button */}
      <SplitButton
        options={splitOptions}
        selectedId={selectedId}
        onSelectedChange={setSelectedId}
        onAction={onResolve}
        size="sm"
        variant="primary"
      />
    </div>
  );
}
