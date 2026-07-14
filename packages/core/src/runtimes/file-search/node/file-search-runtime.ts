import {
  FileSearchAllocationGraph,
  type FileSearchAllocationGraphOptions,
} from './allocation/allocation-graph';
import { ContentSearchRuntime } from './content/content-search-runtime';
import { PathSearchRuntime } from './path/path-search-runtime';
import { FileSearchRootRuntime } from './root/root-runtime';

export type FileSearchRuntimeOptions = FileSearchAllocationGraphOptions;

/** Host-scoped composition root for durable root, path, and content search runtimes. */
export class FileSearchRuntime {
  readonly roots: FileSearchRootRuntime;
  readonly paths: PathSearchRuntime;
  readonly content: ContentSearchRuntime;

  private readonly allocations: FileSearchAllocationGraph;

  constructor(options: FileSearchRuntimeOptions) {
    this.allocations = new FileSearchAllocationGraph(options);
    this.roots = new FileSearchRootRuntime(this.allocations);
    this.paths = new PathSearchRuntime(this.allocations);
    this.content = new ContentSearchRuntime(this.allocations);
  }

  dispose(): Promise<void> {
    return this.allocations.dispose();
  }
}
