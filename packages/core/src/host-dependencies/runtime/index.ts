export { CORE_DEPENDENCIES, GIT_DEPENDENCY_DESCRIPTOR } from '../core-dependencies';
export type { Platform } from '../capability';
export { INSTALL_METHOD_LOCATION_HINTS, inferMethod } from './location-hints';
export { createInstallMethodDetector, type InstallMethodDetector } from './method-detection';
export { resolveInstallOptions, pickInstallOption, toPlatform } from './install-options';
export {
  deriveHostDependencyStatus,
  hostDependencySelectionSchema,
  installationCanUpdate,
  normalizeSelection,
  resolveActiveInstallation,
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
  type Provenance,
  type SelectedSource,
  type ProbeResult,
} from './types';
export {
  HostDependencyManager,
  type HostDependencyRunOptions,
  type HostDependencyManagerOptions,
  type InstallCommandRunner,
} from './host-dependency-manager';
export {
  resolveAllCommandPaths,
  resolveCommandPath,
  resolveRealpath,
  runVersionProbe,
} from './probe';
export { buildDescriptorFromProvider } from '../descriptor-from-provider';
