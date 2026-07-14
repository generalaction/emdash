import type {
  HostDependencyDescriptor,
  HostDependencyUpdateCommand,
} from '@primitives/host-dependencies/api';

/** @deprecated Package-manager install options are no longer used by HostDependencies. */
export function homebrewOption(_opts: {
  formula: string;
  cask?: boolean;
  recommended?: boolean;
}): Record<string, never> {
  return {};
}

/** Build a full HostDependencyDescriptor for a globally-installed npm package. */
export function npmDependency(opts: {
  id: string;
  package: string;
  /** Binary names to probe; defaults to [opts.id]. */
  binaryNames?: string[];
  /** @deprecated Package-manager install metadata is no longer used. */
  installFlags?: string;
  /** @deprecated Package-manager install metadata is no longer used. */
  versionSuffix?: string;
  /** @deprecated Package-manager install metadata is no longer used. */
  recommended?: boolean;
  /** Optional link to documentation shown in the UI. */
  installDocs?: string;
  /** @deprecated Version probes are no longer part of HostDependencies. */
  skipVersionProbe?: boolean;
  /** @deprecated Version probes are no longer part of HostDependencies. */
  versionArgs?: string[];
  /** @deprecated Package-manager install metadata is no longer used. */
  extraOptions?: unknown;
  updateCommand?: HostDependencyUpdateCommand;
}): HostDependencyDescriptor {
  return {
    id: opts.id,
    binaryNames: opts.binaryNames ?? [opts.id],
    ...(opts.installDocs ? { installDocs: opts.installDocs } : {}),
    ...(opts.updateCommand ? { updateCommand: opts.updateCommand } : {}),
  };
}
