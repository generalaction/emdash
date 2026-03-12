export interface PlainCustomerRef {
  id: string;
  fullName?: string | null;
  email?: string | null;
}

export interface PlainLabelRef {
  id: string;
  name?: string | null;
}

export interface PlainThreadSummary {
  id: string;
  ref?: string | null;
  title: string;
  description?: string | null;
  status?: string | null;
  priority?: number | null;
  customer?: PlainCustomerRef | null;
  labels?: PlainLabelRef[] | null;
  updatedAt?: string | null;
  url?: string | null;
}
