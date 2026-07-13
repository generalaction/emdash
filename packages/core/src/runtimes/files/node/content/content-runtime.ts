import { createResourceLiveModelHost, type ResourceLiveModelHost } from '@emdash/wire';
import { filesContract, type FilesContract } from '@runtimes/files/api';
import type { FilesAllocationGraph } from '@runtimes/files/node/allocation/allocation-graph';
import type { ContentResource } from './content-resource';

type ContentModel = FilesContract['content'];

export class FileContentRuntime {
  readonly model: ResourceLiveModelHost<ContentModel>;

  private readonly hosts = new Map<string, ResourceLiveModelHost<ContentModel>>();

  constructor(private readonly allocations: FilesAllocationGraph) {
    this.model = this.modelHost(filesContract.content);
  }

  modelHost(contract: ContentModel = filesContract.content): ResourceLiveModelHost<ContentModel> {
    const existing = this.hosts.get(contract.id);
    if (existing) return existing;
    const host = createResourceLiveModelHost<ContentModel, ContentResource>(contract, {
      acquire: (key) => this.allocations.acquireContent(key),
      states: {
        content: ({ resource }) => resource.state(),
      },
      mutations: {
        write: (context) => context.resource.write(context),
      },
    });
    this.hosts.set(contract.id, host);
    return host;
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.hosts.values()].map((host) => host.dispose()));
    this.hosts.clear();
  }
}
