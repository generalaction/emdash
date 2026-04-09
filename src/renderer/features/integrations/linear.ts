export interface LinearUserRef {
  name?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
}

export interface LinearTeamRef {
  name?: string | null;
  key?: string | null;
}

export interface LinearStateRef {
  name?: string | null;
  type?: string | null;
  color?: string | null;
}

export interface LinearProjectRef {
  name?: string | null;
}

export interface LinearIssueSummary {
  id: string;
  identifier: string;
  title: string;
  description?: string | null;
  url?: string | null;
  state?: LinearStateRef | null;
  team?: LinearTeamRef | null;
  project?: LinearProjectRef | null;
  assignee?: LinearUserRef | null;
  updatedAt?: string | null;
}
