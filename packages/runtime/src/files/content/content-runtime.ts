import { filesContract, type FilesContract } from '@emdash/core/files';
import { createResourceLiveModelHost, type ResourceLiveModelHost } from '@emdash/wire';
import type { FilesAllocationGraph } from '../allocation/allocation-graph';
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
      mutations: {},
    });
    this.hosts.set(contract.id, host);
    return host;
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.hosts.values()].map((host) => host.dispose()));
    this.hosts.clear();
  }
}
