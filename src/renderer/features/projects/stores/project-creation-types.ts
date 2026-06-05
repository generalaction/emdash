interface BaseModeData {
  name: string;
  path: string;
}

export interface PickModeData extends BaseModeData {
  mode: 'pick';
  initGitRepository?: boolean;
}

export interface CloneModeData extends BaseModeData {
  mode: 'clone';
  repositoryUrl: string;
}

export interface NewModeData extends BaseModeData {
  mode: 'new';
  repositoryName: string;
  repositoryOwner: string;
  repositoryVisibility: 'public' | 'private';
  githubAccountId?: string;
}

export type ModeData = PickModeData | CloneModeData | NewModeData;

export type ProjectType = { type: 'local' } | { type: 'ssh'; connectionId: string };

export type StartProjectCreationResult =
  | { kind: 'existing'; projectId: string }
  | { kind: 'creating'; projectId: string; completion: Promise<void> };

export interface StartProjectCreationOptions {
  id?: string;
}
