export { issuesPluginRegistry } from './registry';
export {
  defineIssuesPlugin,
  ISSUES_PLUGIN_CAPABILITIES,
  registerIssuesPluginBehavior,
  type IssuesCapabilities,
  type IssuesPluginDefinition,
  type IssuesPluginMetadata,
  type IssuesPluginProvider,
} from './plugin';
export type {
  IssueData,
  IssueDetail,
  IssueError,
  IssueGetOpts,
  IssueGetResult,
  IssueListResult,
  IssueQueryOpts,
  IssueSearchOpts,
} from './types';
export type { IIssuesBehavior, IssuesDescriptor } from './capabilities/issues';
