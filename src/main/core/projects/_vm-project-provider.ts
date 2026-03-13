import type { BaseTaskProvisionArgs, ProjectProvider, TaskProvider } from './project-provider';

export class VmEnvironmentProvider implements ProjectProvider {
  readonly type = 'vm';

  async provisionTask(_args: BaseTaskProvisionArgs): Promise<TaskProvider> {
    throw new Error(
      'VmEnvironmentProvider is not yet implemented. ' +
        'Set project.environmentProvider to "local" or "ssh" for now.'
    );
  }

  getTask(_taskId: string): TaskProvider | undefined {
    return undefined;
  }

  async teadownTask(_taskId: string): Promise<void> {
    // No-op until implemented.
  }

  async cleanup(): Promise<void> {
    // No-op until implemented.
  }
}
