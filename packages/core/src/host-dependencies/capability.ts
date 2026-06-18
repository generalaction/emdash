import z from 'zod';
import { definePluginCapability } from '../lib/plugins/capability';
import type { DependencyStatus, ProbeResult } from './runtime/types';

export const PLATFORMS = ['macos', 'windows', 'linux'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const INSTALL_METHODS = [
  'installer-macos',
  'installer-windows',
  'installer-linux',
  'homebrew',
  'winget',
  'powershell',
  'npm',
  'apt',
  'curl',
  'pip',
  'cargo',
  'other',
] as const;
export type InstallMethod = (typeof INSTALL_METHODS)[number];

export const installOptionSchema = z.object({
  method: z.enum(INSTALL_METHODS),
  command: z.string(),
  /** Human-readable display name shown in the UI. Defaults to a humanized method label. */
  label: z.string().optional(),
  /** When true this option is preselected and sorted first. */
  recommended: z.boolean().optional(),
  /** Update command for installs made via this method. When absent, falls back to re-running
   *  `command` for package-manager updates or the dependency's own CLI update command. */
  updateCommand: z.string().optional(),
  /** Uninstall command for installs made via this method. Required when the descriptor's
   *  `uninstall.kind` is `'package-manager'`. */
  uninstallCommand: z.string().optional(),
});
export type InstallOption = z.output<typeof installOptionSchema>;

/** Where to look up the latest published version. */
export const releaseSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('npm'), package: z.string() }),
  z.object({ kind: z.literal('github'), repo: z.templateLiteral([z.string(), '/', z.string()]) }),
  z.object({ kind: z.literal('none') }),
]);
export type ReleaseSource = z.output<typeof releaseSourceSchema>;

export const updateStrategySchema = z.discriminatedUnion('kind', [
  /** Re-run the install command for the method that was used, or the first/recommended option. */
  z.object({ kind: z.literal('package-manager') }),
  /** Run the dependency's own update subcommand, e.g. `claude update`. */
  z.object({ kind: z.literal('cli'), args: z.array(z.string()) }),
  /** Dependency manages its own updates; emdash reports the version diff but takes no action. */
  z.object({ kind: z.literal('auto') }),
  z.object({ kind: z.literal('none') }),
]);
export type UpdateStrategy = z.output<typeof updateStrategySchema>;

export const updatesDescriptorSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('supported'),
    releaseSource: releaseSourceSchema,
    update: updateStrategySchema,
  }),
  z.object({ kind: z.literal('none') }),
]);
export type UpdatesDescriptor = z.output<typeof updatesDescriptorSchema>;

export const uninstallStrategySchema = z.discriminatedUnion('kind', [
  /** Run the per-method `uninstallCommand` declared on the matching InstallOption. */
  z.object({ kind: z.literal('package-manager') }),
  /** Run the dependency's own uninstall subcommand, e.g. `claude uninstall`. */
  z.object({ kind: z.literal('cli'), args: z.array(z.string()) }),
  /** Uninstall not supported via emdash; hide the option in the UI. */
  z.object({ kind: z.literal('none') }),
]);
export type UninstallStrategy = z.output<typeof uninstallStrategySchema>;

export const hostDependencyDescriptorSchema = z.object({
  id: z.string(),
  /** Binary names to try in order; first success wins. */
  binaryNames: z.array(z.string()).min(1),
  /** Args passed when probing for a version string. Defaults to ['--version']. */
  versionArgs: z.array(z.string()).optional(),
  /** Skip executing the CLI after resolving its path.
   *  Use for CLIs whose version command has project-local side effects. */
  skipVersionProbe: z.boolean().optional(),
  installCommands: z.partialRecord(z.enum(PLATFORMS), z.array(installOptionSchema)),
  /** Optional link to installation documentation, shown in the dependency detail view. */
  installDocs: z.string().optional(),
  updates: updatesDescriptorSchema,
  /** Uninstall strategy. When absent, uninstall is not supported. */
  uninstall: uninstallStrategySchema.optional(),
});
export type HostDependencyDescriptor = z.output<typeof hostDependencyDescriptorSchema>;

export type IHostDependencyBehavior = {
  /** Override the generic release-source resolution for unusual version feeds. */
  resolveLatestVersion?(): Promise<string | null>;
  /**
   * Override the static UpdateStrategy.cli args with a computed command.
   * Receives the resolved binary path; return { command, args } to run.
   */
  buildUpdateCommand?(binaryPath: string): { command: string; args: string[] };
  /**
   * Override the static UninstallStrategy.cli args with a computed command.
   * Receives the resolved binary path; return { command, args } to run.
   */
  buildUninstallCommand?(binaryPath: string): { command: string; args: string[] };
  /**
   * Override the default status resolution logic.
   * Useful for CLIs that exit non-zero on `--version` but are still available.
   */
  resolveStatus?(result: ProbeResult): DependencyStatus;
};

export const hostDependencyCapability = definePluginCapability<IHostDependencyBehavior>()(
  'host-dependency',
  hostDependencyDescriptorSchema
);
