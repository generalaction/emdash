import { setMarkdownBriefReader } from './impl/markdown';
import { nodeBriefReader } from './impl/markdown/node-reader';

/**
 * Node-only wiring for the issues plugins: providers that read the local
 * filesystem get their bindings here, so `@emdash/plugins/issues` itself
 * remains importable from a browser program.
 *
 * Import this once from the main process before issue providers are used.
 */
export function installNodeIssuePluginBindings(): void {
  setMarkdownBriefReader(nodeBriefReader);
}

export { nodeBriefReader };
export type {
  BriefReaderDependencies,
  GitOutput,
  DirectoryEntry,
} from './impl/markdown/repository';
