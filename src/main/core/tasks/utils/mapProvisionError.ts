import { CreateTaskError } from "@shared/tasks";
import { ProvisionTaskError } from "../provision-task-error";

export function mapProvisionError(error: ProvisionTaskError): CreateTaskError {
    switch (error.type) {
      case 'branch-not-found':
        return { type: 'branch-not-found', branch: error.branch };
      case 'worktree-setup-failed':
        return { type: 'worktree-setup-failed', branch: error.branch, message: error.message };
      case 'timeout':
        return { type: 'provision-timeout', timeoutMs: error.timeout, step: error.step };
      default:
        return { type: 'provision-failed', message: error.message };
    }
  }