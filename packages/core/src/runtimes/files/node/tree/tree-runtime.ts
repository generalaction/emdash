import { createResourceLiveModelHost, type ResourceLiveModelHost } from '@emdash/wire';
import { filesContract, type FilesContract } from '@runtimes/files/api';
import type { FilesAllocationGraph } from '@runtimes/files/node/allocation/allocation-graph';
import { expectedFsError } from '@runtimes/files/node/api/errors';

type TreeModel = FilesContract['tree']['model'];

export class FileTreeRuntime {
  readonly model: ResourceLiveModelHost<TreeModel>;

  private readonly hosts = new Map<string, ResourceLiveModelHost<TreeModel>>();

  constructor(private readonly allocations: FilesAllocationGraph) {
    this.model = this.modelHost(filesContract.tree.model);
  }

  modelHost(contract: TreeModel = filesContract.tree.model): ResourceLiveModelHost<TreeModel> {
    const existing = this.hosts.get(contract.id);
    if (existing) return existing;
    const host = createResourceLiveModelHost(contract, {
      acquire: (key) => this.allocations.acquireTree(key),
      states: {
        tree: ({ resource }) => resource.source(),
      },
      mutations: {
        expand: (context) => context.resource.expand(context),
        collapse: (context) => context.resource.collapse(context),
        reveal: (context) => context.resource.reveal(context),
      },
      toMutationError: (_name, error) => expectedFsError(error),
    });
    this.hosts.set(contract.id, host);
    return host;
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.hosts.values()].map((host) => host.dispose()));
    this.hosts.clear();
  }
}
