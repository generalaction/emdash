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

/**
 * GitHub user object returned from `gh api user`
 * https://docs.github.com/en/rest/users/users#get-the-authenticated-user
 */
export interface GithubUser {
  login: string;
  name?: string;
  avatar_url?: string;
  email?: string;
  bio?: string;
  company?: string;
  location?: string;
  [key: string]: unknown;
}
