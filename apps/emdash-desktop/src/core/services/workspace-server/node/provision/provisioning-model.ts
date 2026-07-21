import { createLiveModelHost, type LiveInstance, type LiveModelHost } from '@emdash/wire';
import {
  workspaceServerDesktopContract,
  type WorkspaceServerProvisioningRuntime,
  type WorkspaceServerProvisioningStatus,
} from '../../api';

export class WorkspaceServerProvisioningModel {
  readonly host: LiveModelHost<typeof workspaceServerDesktopContract.provisioning>;
  readonly instance: LiveInstance<typeof workspaceServerDesktopContract.provisioning>;

  constructor() {
    this.host = createLiveModelHost(workspaceServerDesktopContract.provisioning);
    this.instance = this.host.create(undefined, { runtime: {} });
  }

  set(connectionId: string, status: WorkspaceServerProvisioningStatus): void {
    this.instance.states.runtime.produce((runtime: WorkspaceServerProvisioningRuntime) => {
      runtime[connectionId] = status;
    });
  }

  remove(connectionId: string): void {
    this.instance.states.runtime.produce((runtime: WorkspaceServerProvisioningRuntime) => {
      delete runtime[connectionId];
    });
  }

  dispose(): void {
    this.host.dispose();
  }
}
