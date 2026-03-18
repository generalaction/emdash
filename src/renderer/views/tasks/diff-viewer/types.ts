export interface CommitFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
}

// ---------------------------------------------------------------------------
// CommitList (for History tab)
// ---------------------------------------------------------------------------

export interface CommitEntry {
  hash: string;
  subject: string;
  body: string;
  author: string;
  date: string;
  isPushed: boolean;
  tags: string[];
}
