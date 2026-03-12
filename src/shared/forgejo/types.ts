export interface ForgejoIssueSummary {
  id: number;
  number: number; // repo-scoped issue number
  title: string;
  description?: string | null;
  html_url?: string | null;
  state?: string | null; // "open" | "closed"
  assignee?: { name: string; login: string } | null;
  labels?: string[] | null;
  updated_at?: string | null;
}
