// Browser-safe dependency types and pure helpers. The Node-only runtime
// (HostDependencyManager, probing, registry, version fetching) lives in the
// './deps/runtime' entry and must only be imported from main-process code.
export { INSTALL_METHOD_LOCATION_HINTS, inferMethod } from './location-hints';
export { resolveInstallOptions, pickInstallOption, toPlatform } from './install-options';
export {
  consoleLogger,
  noopLogger,
  type DepsLogger,
  type IHostDependencyStore,
  type InstallCommandRunner,
} from './ports';
export {
  deriveHostDependencyStatus,
  hostDependencySelectionSchema,
  type CoreDependencyId,
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
  type DependencyUpdateError,
  type DependencyUpdateResult,
  type HostDependency,
  type HostDependencySelection,
  type InstallCommandError,
  type Installation,
  type InstallationSource,
  type ProbeResult,
} from './types';
