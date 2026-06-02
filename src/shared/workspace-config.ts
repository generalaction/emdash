import type { GitSetup, WorkspaceLocation } from '@shared/tasks';

export type WorkspaceConfig = {
  version: '1';
  git: GitSetup;
  workspace: WorkspaceLocation;
};

export function parseWorkspaceConfig(raw: string | null | undefined): WorkspaceConfig | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      (parsed as WorkspaceConfig).version !== '1'
    ) {
      return null;
    }
    return parsed as WorkspaceConfig;
  } catch {
    return null;
  }
}

export function serializeWorkspaceConfig(config: WorkspaceConfig): string {
  return JSON.stringify(config);
}
