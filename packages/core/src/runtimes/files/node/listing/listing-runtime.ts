import { err, ok, type Result } from '@emdash/shared';
import type { Scope } from '@emdash/shared/concurrency';
import type { LeasedLiveModelProvider } from '@emdash/wire/rpc';
import { expose, type ExposedMutationContext } from '@emdash/wire/state';
import {
  filesContract,
  type FilesContract,
  type FsError,
  type ListingKey,
} from '#runtimes/files/api';
import type { FilesAllocationGraph } from '#runtimes/files/node/allocation/allocation-graph';
import { expectedFsError } from '#runtimes/files/node/api/errors';

type ListingModel = FilesContract['listing'];

export class FileListingRuntime {
  readonly model: LeasedLiveModelProvider<ListingModel>;

  private readonly hosts = new Map<string, LeasedLiveModelProvider<ListingModel>>();

  constructor(private readonly allocations: FilesAllocationGraph) {
    this.model = this.modelHost(filesContract.listing);
  }

  modelHost(contract: ListingModel = filesContract.listing): LeasedLiveModelProvider<ListingModel> {
    const existing = this.hosts.get(contract.id);
    if (existing) return existing;
    const host = expose(
      contract,
      {
        listing: (key, scope) => this.listingState(key, scope),
      },
      {
        mutations: {
          refresh: (context) => this.refresh(context),
        },
        publish: { listing: 'diff' },
      }
    );
    this.hosts.set(contract.id, host);
    return host;
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.hosts.values()].map((host) => host.dispose()));
    this.hosts.clear();
  }

  private async listingState(key: ListingKey, scope: Scope) {
    const lease = this.allocations.acquireListing(key);
    scope.add(() => lease.release());
    return (await lease.ready()).state;
  }

  private async refresh(
    context: ExposedMutationContext<ListingModel, 'refresh'>
  ): Promise<Result<void, FsError>> {
    const lease = this.allocations.acquireListing(context.key);
    try {
      const folder = await lease.ready();
      await context.observed('listing', await folder.refresh());
      return ok<void>();
    } catch (error) {
      const expected = expectedFsError(error);
      if (expected) return err(expected);
      throw error;
    } finally {
      await lease.release();
    }
  }
}
