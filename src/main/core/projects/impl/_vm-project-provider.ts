import { Conversation } from '@shared/conversations';
import { Task } from '@shared/tasks';
import { Terminal } from '@shared/terminals';
import { err, ok, type Result } from '@main/lib/result';
import type {
  ProjectProvider,
  ProvisionTaskError,
  TaskProvider,
  TeardownTaskError,
} from '../project-provider';

const VM_NOT_IMPLEMENTED: ProvisionTaskError = {
  type: 'error',
  message:
    'VmEnvironmentProvider is not yet implemented. ' +
    'Set project.environmentProvider to "local" or "ssh" for now.',
};

export class VmEnvironmentProvider implements ProjectProvider {
  readonly type = 'vm';

  async provisionTask(
    _task: Task,
    _conversations: Conversation[],
    _terminals: Terminal[]
  ): Promise<Result<TaskProvider, ProvisionTaskError>> {
    return err<ProvisionTaskError>(VM_NOT_IMPLEMENTED);
  }

  async retryTaskProvision(
    _task: Task,
    _conversations: Conversation[],
    _terminals: Terminal[]
  ): Promise<Result<TaskProvider, ProvisionTaskError>> {
    return err<ProvisionTaskError>(VM_NOT_IMPLEMENTED);
  }

  getTask(_taskId: string): TaskProvider | undefined {
    return undefined;
  }

  async teardownTask(_taskId: string): Promise<Result<void, TeardownTaskError>> {
    return ok();
  }

  async retryTaskTeardown(_taskId: string): Promise<Result<void, TeardownTaskError>> {
    return ok();
  }

  async removeTaskWorktree(_taskBranch: string): Promise<void> {
    // Not implemented for VM providers
  }

  async cleanup(): Promise<void> {
    // No-op until implemented.
  }
}
