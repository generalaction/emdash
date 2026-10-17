export { repositoryPluginRegistry } from './registry';
export {
  defineRepositoryPlugin,
  REPOSITORY_PLUGIN_CAPABILITIES,
  registerRepositoryPluginBehavior,
  type RepositoryCapabilities,
  type RepositoryPluginDefinition,
  type RepositoryPluginMetadata,
  type RepositoryPluginProvider,
} from './plugin';
export type {
  CreatedRepository,
  CreateRepositoryOpts,
  DeleteRepositoryOpts,
  RepositoryError,
  RepositoryHostProbeError,
  RepositoryHostProbeResult,
  RepositoryOwner,
  RepositoryVisibility,
} from './types';
export type { IRepositoryBehavior, RepositoryDescriptor } from './capabilities/repository';
