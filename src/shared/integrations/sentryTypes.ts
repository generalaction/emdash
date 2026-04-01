/** Sentry issue shape returned by the Sentry API. Shared across main & renderer. */
export interface SentryIssue {
  id: string;
  shortId: string;
  title: string;
  culprit: string;
  permalink: string;
  level: string;
  status: string;
  count: string;
  firstSeen: string;
  lastSeen: string;
  project: { id: string; slug: string; name: string };
  metadata: { type?: string; value?: string; filename?: string; function?: string };
  assignedTo?: { name: string; email?: string } | null;
  labels?: string[];
}
