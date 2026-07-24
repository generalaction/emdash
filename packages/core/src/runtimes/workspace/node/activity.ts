import type { Unsubscribe } from '@emdash/shared';
import { resourceKeyFromFileRef, type HostFileRef } from '@primitives/path/api';
import type { WorkspaceActivityResource } from '@runtimes/workspace/api';

export type WorkspaceActivityProvider = {
  attach(
    onActivity: (workspace: HostFileRef, resources: WorkspaceActivityResource[]) => void
  ): Unsubscribe;
};

export class WorkspaceActivityIndex {
  private readonly resources = new Map<string, WorkspaceActivityResource[]>();
  private readonly unsubscribes: Unsubscribe[] = [];

  constructor(private readonly onChange: (workspace: HostFileRef) => void) {}

  addProvider(provider: WorkspaceActivityProvider): Unsubscribe {
    const unsubscribe = provider.attach((workspace, resources) => {
      this.resources.set(resourceKeyFromWorkspace(workspace), resources);
      this.onChange(workspace);
    });
    this.unsubscribes.push(unsubscribe);
    return unsubscribe;
  }

  resourcesFor(workspace: HostFileRef): WorkspaceActivityResource[] {
    return [...(this.resources.get(resourceKeyFromWorkspace(workspace)) ?? [])];
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribes.splice(0)) unsubscribe();
    this.resources.clear();
  }
}

function resourceKeyFromWorkspace(workspace: HostFileRef): string {
  return resourceKeyFromFileRef(workspace);
}
