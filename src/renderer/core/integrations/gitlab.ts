export interface GitLabUserRef {
  name?: string | null;
  username?: string | null;
}

export interface GitLabProjectRef {
  name?: string | null;
}

export interface GitLabIssueSummary {
  id: number;
  iid: number;
  title: string;
  description?: string | null;
  webUrl?: string | null;
  state?: string | null;
  project?: GitLabProjectRef | null;
  assignee?: GitLabUserRef | null;
  labels?: string[];
  updatedAt?: string | null;
}
