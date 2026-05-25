export const automationsKey = (projectId?: string) => ['automations', projectId ?? 'all'] as const;

export const runsKey = (automationId: string, limit: number) =>
  ['automations', 'runs', automationId, limit] as const;

export const recentRunsKey = (projectId: string | undefined, limit: number) =>
  ['automations', 'recent-runs', projectId ?? 'all', limit] as const;

export function isAutomationQuery(queryKey: readonly unknown[]): boolean {
  return queryKey[0] === 'automations' && queryKey[1] !== 'catalog';
}
