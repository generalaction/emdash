import type { Result } from '@emdash/shared';
import type { Scope } from '@emdash/shared/concurrency';
import { expose, type LeasedLiveModelProvider } from '@emdash/wire';
import { filesContract, type FilesContract, type FsError } from '@runtimes/files/api';
import type { FilesAllocationGraph } from '@runtimes/files/node/allocation/allocation-graph';
import { expectedFsError } from '@runtimes/files/node/api/errors';
import type { TreeResource } from './tree-resource';

type TreeModel = FilesContract['tree']['model'];

export class FileTreeRuntime {
  readonly model: LeasedLiveModelProvider<TreeModel>;

  private readonly hosts = new Map<string, LeasedLiveModelProvider<TreeModel>>();

  constructor(private readonly allocations: FilesAllocationGraph) {
    this.model = this.modelHost(filesContract.tree.model);
  }

  modelHost(contract: TreeModel = filesContract.tree.model): LeasedLiveModelProvider<TreeModel> {
    const existing = this.hosts.get(contract.id);
    if (existing) return existing;
    const host = expose(
      contract,
      {
        tree: (key, scope) => this.treeState(key, scope),
      },
      {
        mutations: {
          expand: (context) => this.run(context.key, (resource) => resource.expand(context)),
          collapse: (context) => this.run(context.key, (resource) => resource.collapse(context)),
          reveal: (context) => this.run(context.key, (resource) => resource.reveal(context)),
          createFile: (context) =>
            this.run(context.key, (resource) => resource.createFile(context)),
          createDirectory: (context) =>
            this.run(context.key, (resource) => resource.createDirectory(context)),
          delete: (context) => this.run(context.key, (resource) => resource.delete(context)),
          rename: (context) => this.run(context.key, (resource) => resource.rename(context)),
          move: (context) => this.run(context.key, (resource) => resource.move(context)),
          copy: (context) => this.run(context.key, (resource) => resource.copy(context)),
          refresh: (context) => this.run(context.key, (resource) => resource.refresh(context)),
        },
        publish: { tree: 'diff' },
      }
    );
    this.hosts.set(contract.id, host);
    return host;
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.hosts.values()].map((host) => host.dispose()));
    this.hosts.clear();
  }

  private async treeState(key: Parameters<FilesAllocationGraph['acquireTree']>[0], scope: Scope) {
    const lease = this.allocations.acquireTree(key);
    scope.add(() => lease.release());
    const resource = await lease.ready();
    return resource.source();
  }

  private async run<T>(
    key: Parameters<FilesAllocationGraph['acquireTree']>[0],
    work: (resource: TreeResource) => Promise<Result<T, FsError>>
  ): Promise<Result<T, FsError>> {
    const lease = this.allocations.acquireTree(key);
    try {
      return await work(await lease.ready());
    } catch (error) {
      const expected = expectedFsError(error);
      if (expected) return { success: false, error: expected };
      throw error;
    } finally {
      await lease.release();
    }
  }
}
