export interface GitHubUserRef {
  login?: string | null;
  name?: string | null;
}

export interface GitHubLabelRef {
  name?: string | null;
}

export interface GitHubIssueSummary {
  number: number;
  title: string;
  url?: string | null;
  state?: string | null;
  updatedAt?: string | null;
  assignees?: GitHubUserRef[] | null;
  labels?: GitHubLabelRef[] | null;
  body?: string | null;
}
