import type { BoundExec } from '@services/exec/api';
import { createWorkspaceHostGitExec } from './git';

export type GitExecFactory = (cwd: string) => BoundExec;

export const defaultGitExecFactory: GitExecFactory = (cwd) => createWorkspaceHostGitExec(cwd);
