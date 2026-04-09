export interface PlainThreadSummary {
  id: string;
  ref: string | null;
  title: string;
  description: string | null;
  status: string | null;
  priority: number | null;
  customer: { id: string; fullName: string | null; email: string | null } | null;
  labels: Array<{ id: string; name: string | null }>;
  updatedAt: string | null;
  url: string | null;
}
