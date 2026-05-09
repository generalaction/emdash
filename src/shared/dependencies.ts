import type { AgentProviderId } from '@shared/agent-provider-registry';
import type { Result } from '@shared/result';

export type DependencyCategory = 'core' | 'agent';

export type CoreDependencyId = 'git' | 'gh' | 'tmux' | 'ssh' | 'node';

export type DependencyId = CoreDependencyId | AgentProviderId;

export type DependencyStatus = 'available' | 'missing' | 'error';

export interface DependencyState {
  id: DependencyId;
  category: DependencyCategory;
  status: DependencyStatus;
  version: string | null;
  path: string | null;
  checkedAt: number;
  error?: string;
}

export type DependencyStatusMap = Record<string, DependencyState>;

export type DependencyStatusUpdatedEvent = {
  id: string;
  state: DependencyState;
  connectionId?: string;
};

export type InstallCommandError =
  | { type: 'permission-denied'; message: string; output: string; exitCode?: number }
  | { type: 'command-failed'; message: string; output: string; exitCode?: number }
  | { type: 'pty-open-failed'; message: string };

export type DependencyInstallError =
  | { type: 'unknown-dependency'; id: string }
  | { type: 'no-install-command'; id: string }
  | InstallCommandError
  | { type: 'not-detected-after-install'; id: string };

export type DependencyInstallResult = Result<DependencyState, DependencyInstallError>;
