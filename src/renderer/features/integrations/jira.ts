export interface JiraUserRef {
  displayName?: string | null;
  name?: string | null;
}

export interface JiraProjectRef {
  key?: string | null;
  name?: string | null;
}

export interface JiraStatusRef {
  name?: string | null;
}

export interface JiraIssueSummary {
  id: string;
  key: string;
  summary: string;
  description?: string | null;
  url?: string | null;
  status?: JiraStatusRef | null;
  project?: JiraProjectRef | null;
  assignee?: JiraUserRef | null;
  updatedAt?: string | null;
}
