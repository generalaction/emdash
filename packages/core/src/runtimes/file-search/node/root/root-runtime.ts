import type { Result } from '@emdash/shared';
import type {
  FileSearchRegisterRootError,
  FileSearchRootInput,
  FileSearchUnregisterRootError,
} from '@runtimes/file-search/api';
import type { FileSearchAllocationGraph } from '../allocation/allocation-graph';

/** Public entrypoint for durable root registration. */
export class FileSearchRootRuntime {
  constructor(private readonly allocations: FileSearchAllocationGraph) {}

  registerRoot(input: FileSearchRootInput): Promise<Result<void, FileSearchRegisterRootError>> {
    return this.allocations.registerRoot(input);
  }

  unregisterRoot(input: FileSearchRootInput): Promise<Result<void, FileSearchUnregisterRootError>> {
    return this.allocations.unregisterRoot(input);
  }
}
