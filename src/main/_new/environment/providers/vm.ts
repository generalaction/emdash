import type { EnvironmentProvider, TaskEnvironment } from '../types';
import type { ProjectRow } from '../../db/schema';
import { SshEnvironmentProvider } from './ssh';

/**
 * VmEnvironmentProvider (stub)
 *
 * Future implementation:
 *  1. Call an external API to provision a VM for the task.
 *  2. Wait for the VM to become reachable over SSH.
 *  3. Store the SSH endpoint in `SshConnectionManager`.
 *  4. Delegate to `SshEnvironmentProvider.provision()` using the
 *     VM's connection details.
 *
 * This enables the "create task → spin up VM" workflow without any
 * changes to controllers — they call `taskResourceManager.getOrProvision()`
 * and remain environment-agnostic.
 */
export class VmEnvironmentProvider implements EnvironmentProvider {
  readonly type = 'vm';

  private sshProvider = new SshEnvironmentProvider();

  async provision(
    _project: ProjectRow,
    _task: { id: string; path: string }
  ): Promise<TaskEnvironment> {
    // TODO: call external provisioning API, wait for SSH endpoint,
    // register connection in SshConnectionManager, then delegate:
    //
    //   const vmConfig = await provisionVm(_project, _task);
    //   sshConnectionManager.connect(_task.id, vmConfig.connectConfig);
    //   return this.sshProvider.provision({ ...project, sshConnectionId: _task.id }, _task);

    throw new Error(
      'VmEnvironmentProvider is not yet implemented. ' +
        'Set project.environmentProvider to "local" or "ssh" for now.'
    );
  }

  async teardown(_taskId: string): Promise<void> {
    // TODO: tear down the VM when the task is archived/deleted.
    // The VM's SSH connection in SshConnectionManager should be disconnected here.
  }
}

export const vmEnvironmentProvider = new VmEnvironmentProvider();
