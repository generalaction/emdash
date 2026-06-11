// Node-only dependency-management runtime. Never import this from renderer
// code — it touches `process`, `node:https`, and spawns commands. Browser-safe
// types and pure helpers live in the './deps' entry (index.ts).
export {
  HostDependencyManager,
  type HostDependencyManagerOptions,
} from './host-dependency-manager';
export { LatestVersionService } from './latest-version-service';
export { resolveCommandPath, resolveRealpath, runVersionProbe } from './probe';
export { DEPENDENCIES, getDependencyDescriptor } from './registry';
