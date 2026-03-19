import { err, ok, type Result } from '@main/lib/result';
import type {
  BaseTaskProvisionArgs,
  ProjectProvider,
  ProvisionTaskError,
  TaskProvider,
  TeardownTaskError,
} from '../project-provider';

export class VmEnvironmentProvider implements ProjectProvider {
  readonly type = 'vm';

  async provisionTask(
    _args: BaseTaskProvisionArgs
  ): Promise<Result<TaskProvider, ProvisionTaskError>> {
    return err<ProvisionTaskError>({
      type: 'error',
      message:
        'VmEnvironmentProvider is not yet implemented. ' +
        'Set project.environmentProvider to "local" or "ssh" for now.',
    });
  }

  getTask(_taskId: string): TaskProvider | undefined {
    return undefined;
  }

  async teadownTask(_taskId: string): Promise<Result<void, TeardownTaskError>> {
    return ok();
  }

  async cleanup(): Promise<void> {
    // No-op until implemented.
  }
}
