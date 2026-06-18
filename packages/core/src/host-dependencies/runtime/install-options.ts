import type { InstallOption, Platform } from '../capability';
import type { DependencyDescriptor } from './types';

/** Map Node.js `process.platform` to the emdash `Platform` type. */
export function toPlatform(p: NodeJS.Platform): Platform {
  if (p === 'darwin') return 'macos';
  if (p === 'win32') return 'windows';
  return 'linux';
}

/**
 * Pick the best InstallOption from the descriptor's installCommands for the given platform.
 * With a method: returns the matching option (or undefined if not found).
 * Without a method: returns the recommended option, or the first one.
 */
export function pickInstallOption(
  descriptor: DependencyDescriptor,
  platform: Platform,
  method?: string
): InstallOption | undefined {
  const options = descriptor.installCommands?.[platform];
  if (!options || options.length === 0) return undefined;
  if (method) return options.find((o) => o.method === method);
  return options.find((o) => o.recommended) ?? options[0];
}

/**
 * Returns the per-platform InstallOption[] with the effective updateCommand filled in.
 * For package-manager strategy: updateCommand defaults to the install command.
 * For cli strategy: updateCommand is built from the binary name + strategy args.
 */
export function resolveInstallOptions(
  descriptor: DependencyDescriptor,
  platform: Platform
): InstallOption[] {
  const options = descriptor.installCommands?.[platform] ?? [];
  const updates = descriptor.updates;

  if (!updates || updates.kind !== 'supported') return options;

  const strategy = updates.update;

  return options.map((opt) => {
    if (strategy.kind === 'package-manager') {
      return { ...opt, updateCommand: opt.updateCommand ?? opt.command };
    }
    if (strategy.kind === 'cli') {
      const binary = descriptor.commands[0] ?? descriptor.id;
      return { ...opt, updateCommand: [binary, ...strategy.args].join(' ') };
    }
    return opt;
  });
}
