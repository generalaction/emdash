import type {
  DependencyStatus,
  HostDependencySelection,
  Installation,
  InstallMethod,
  InstallOption,
} from '@shared/core/agents/agent-payload';
import { humanizeMethod } from './install-command-row';

// ---------------------------------------------------------------------------
// SourceRef — the renderer-local representation of a selected source.
// Mirrors the installation id scheme: auto | method:<m> | path | cli
// ---------------------------------------------------------------------------

export type SourceRef =
  | { kind: 'auto' }
  | { kind: 'method'; method: InstallMethod }
  | { kind: 'path' }
  | { kind: 'cli' };

export function installIdOf(ref: SourceRef): string {
  if (ref.kind === 'method') return `method:${ref.method}`;
  return ref.kind;
}

export function findInstallation(
  installs: Installation[],
  ref: SourceRef
): Installation | undefined {
  return installs.find((i) => i.id === installIdOf(ref));
}

export function toSelection(
  ref: SourceRef,
  overrideValues: { path?: string; cli?: string } = {}
): HostDependencySelection {
  if (ref.kind === 'path') return { usedId: 'path', path: overrideValues.path ?? '' };
  if (ref.kind === 'cli') return { usedId: 'cli', cli: overrideValues.cli ?? '' };
  return { usedId: installIdOf(ref) };
}

export function refLabel(ref: SourceRef, installOptions: InstallOption[]): string {
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
  ref: SourceRef;
  label: string;
  status: DependencyStatus | 'missing';
  recommended?: boolean;
};

/**
 * Merges installOptions (all methods the plugin exposes for this platform) with
 * detected installations, then appends auto + path/cli overrides.
 *
 * Order: auto first, then methods (preserving installOptions order), then overrides.
 */
export function buildSourceRows(
  installOptions: InstallOption[],
  installs: Installation[]
): SourceRow[] {
  const rows: SourceRow[] = [];

  // Auto: the detected installation that doesn't match a known method
  const autoInst = installs.find((i) => i.id === 'auto');
  rows.push({
    ref: { kind: 'auto' },
    label: 'Auto',
    status: autoInst?.status ?? 'missing',
  });

  // Concrete methods from the plugin's install options
  for (const opt of installOptions) {
    const methodInst = installs.find((i) => i.id === `method:${opt.method}`);
    rows.push({
      ref: { kind: 'method', method: opt.method },
      label: opt.label ?? humanizeMethod(opt.method),
      status: methodInst?.status ?? 'missing',
      recommended: opt.recommended,
    });
  }

  // Override rows always present
  const pathInst = installs.find((i) => i.id === 'path');
  rows.push({
    ref: { kind: 'path' },
    label: 'Path Override',
    status: pathInst?.status ?? 'missing',
  });

  const cliInst = installs.find((i) => i.id === 'cli');
  rows.push({
    ref: { kind: 'cli' },
    label: 'CLI Override',
    status: cliInst?.status ?? 'missing',
  });

  return rows;
}

/**
 * Derives a SourceRef from the currently used Installation (if any).
 * Falls back to { kind: 'auto' }.
 */
export function refFromUsed(used: Installation | undefined): SourceRef {
  if (!used) return { kind: 'auto' };
  if (used.id === 'auto') return { kind: 'auto' };
  if (used.id === 'path') return { kind: 'path' };
  if (used.id === 'cli') return { kind: 'cli' };
  if (used.id.startsWith('method:')) {
    const method = used.id.slice('method:'.length) as InstallMethod;
    return { kind: 'method', method };
  }
  return { kind: 'auto' };
}
