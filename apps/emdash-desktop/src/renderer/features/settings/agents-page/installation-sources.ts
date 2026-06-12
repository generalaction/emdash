import type {
  DependencyStatus,
  HostDependencySelection,
  Installation,
  InstallMethod,
  InstallOption,
  SelectedSource,
} from '@shared/core/agents/agent-payload';
import { sourceKey } from '@shared/core/agents/agent-payload';
import { humanizeMethod } from './install-command-row';

// Re-export shared SelectedSource as SourceRef for backward compat with callers.
export type { SelectedSource as SourceRef };
export { sourceKey as installIdOf };

export function findInstallation(
  installs: Installation[],
  ref: SelectedSource
): Installation | undefined {
  return installs.find((i) => i.id === sourceKey(ref));
}

export function toSelection(
  ref: SelectedSource,
  overrideValues: { path?: string; cli?: string } = {}
): HostDependencySelection {
  if (ref.kind === 'path') return { kind: 'path', path: overrideValues.path ?? '' };
  if (ref.kind === 'cli') return { kind: 'cli', command: overrideValues.cli ?? '' };
  if (ref.kind === 'method') return { kind: 'method', method: ref.method };
  // auto → null (clear override)
  return null;
}

export function refLabel(ref: SelectedSource, installOptions: InstallOption[]): string {
  if (ref.kind === 'auto') return 'Auto';
  if (ref.kind === 'path') return 'Path Override';
  if (ref.kind === 'cli') return 'CLI Override';
  const opt = installOptions.find((o) => o.method === ref.method);
  return opt?.label ?? humanizeMethod(ref.method);
}

// ---------------------------------------------------------------------------
// SourceRow — a flattened entry for the source-switcher menu
// ---------------------------------------------------------------------------

export type SourceRow = {
  ref: SelectedSource;
  label: string;
  status: DependencyStatus | 'missing';
  recommended?: boolean;
};

/**
 * Merges installOptions (all methods the plugin exposes for this platform) with
 * detected installations, then appends auto + path/cli overrides.
 *
 * Order: auto first, then methods (preserving installOptions order), then overrides.
 *
 * Method rows show 'available' only when the auto installation's inferredMethod matches.
 */
export function buildSourceRows(
  installOptions: InstallOption[],
  installs: Installation[]
): SourceRow[] {
  const rows: SourceRow[] = [];

  const autoInst = installs.find((i) => i.id === 'auto');

  rows.push({
    ref: { kind: 'auto' },
    label: 'Auto',
    status: autoInst?.status ?? 'missing',
  });

  for (const opt of installOptions) {
    const methodInst = installs.find((i) => i.id === `method:${opt.method}`);
    // Show 'available' only when explicitly probed or inferredMethod matches the auto install
    const methodStatus =
      methodInst?.status ??
      (autoInst?.inferredMethod === opt.method && autoInst?.status === 'available'
        ? 'available'
        : 'missing');
    rows.push({
      ref: { kind: 'method', method: opt.method as InstallMethod },
      label: opt.label ?? humanizeMethod(opt.method as InstallMethod),
      status: methodStatus,
      recommended: opt.recommended,
    });
  }

  const pathInst = installs.find((i) => i.id === 'path');
  rows.push({
    ref: { kind: 'path', path: pathInst?.source.kind === 'path' ? pathInst.source.path : '' },
    label: 'Path Override',
    status: pathInst?.status ?? 'missing',
  });

  const cliInst = installs.find((i) => i.id === 'cli');
  rows.push({
    ref: { kind: 'cli', command: cliInst?.source.kind === 'cli' ? cliInst.source.command : '' },
    label: 'CLI Override',
    status: cliInst?.status ?? 'missing',
  });

  return rows;
}

/**
 * Derives a SelectedSource from the current `used` value.
 * Falls back to { kind: 'auto' } when undefined.
 */
export function refFromUsed(used: SelectedSource | undefined): SelectedSource {
  return used ?? { kind: 'auto' };
}
