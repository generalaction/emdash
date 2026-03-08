import type { EnvironmentProvider, TaskEnvironment, ProvisionArgs } from '../environment-provider';

export class VmEnvironmentProvider implements EnvironmentProvider {
  readonly type = 'vm';

  async provision(_args: ProvisionArgs): Promise<TaskEnvironment> {
    throw new Error(
      'VmEnvironmentProvider is not yet implemented. ' +
        'Set project.environmentProvider to "local" or "ssh" for now.'
    );
  }

  getEnvironment(_taskId: string): TaskEnvironment | undefined {
    return undefined;
  }

  async teardown(_taskId: string): Promise<void> {
    // No-op until implemented.
  }

  async teardownAll(): Promise<void> {
    // No-op until implemented.
  }
}

export const vmEnvironmentProvider = new VmEnvironmentProvider();
