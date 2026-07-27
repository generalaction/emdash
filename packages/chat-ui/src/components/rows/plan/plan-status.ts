import type { ChatPlan, PlanEntryStatus } from '@/model';

export type VisiblePlanEntryStatus = PlanEntryStatus | 'inactive';

export function planIsActive(plan: ChatPlan): boolean {
  return (
    plan.active ??
    (!!plan.streaming || plan.entries.some((entry) => entry.status === 'in_progress'))
  );
}

export function visiblePlanEntryStatus(
  status: PlanEntryStatus,
  active: boolean
): VisiblePlanEntryStatus {
  return status === 'in_progress' && !active ? 'inactive' : status;
}
