export { INSTALL_METHOD_LOCATION_HINTS, inferMethod } from './location-hints';
export { resolveInstallOptions, pickInstallOption, toPlatform } from './install-options';
export {
  deriveHostDependencyStatus,
  hostDependencySelectionSchema,
  installationCanUpdate,
  normalizeSelection,
  resolveSelectedSource,
  sourceKey,
  type DependencyCategory,
  type DependencyDescriptor,
  type DependencyId,
  type DependencyInstallError,
  type DependencyInstallResult,
  type DependencyProbeOptions,
  type DependencyState,
  type DependencyStatus,
  type DependencyStatusMap,
  type DependencyStatusUpdatedEvent,
  type DependencyUninstallError,
  type DependencyUninstallResult,
  type DependencyUpdateError,
  type DependencyUpdateResult,
  type HostDependency,
  type HostDependencySelection,
  type InstallCommandError,
  type InstallOverride,
  type Installation,
  type SelectedSource,
  type ProbeResult,
} from './types';
export {
  HostDependencyManager,
  type HostDependencyManagerOptions,
  type InstallCommandRunner,
} from './host-dependency-manager';
export { resolveCommandPath, resolveRealpath, runVersionProbe } from './probe';
