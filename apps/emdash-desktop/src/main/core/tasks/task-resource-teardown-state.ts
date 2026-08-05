type CompletedTaskResourceTeardown = {
  lifecycle: boolean;
  providerDestroy: boolean;
};

const completedTeardowns = new Map<string, CompletedTaskResourceTeardown>();

export function hasCompletedTaskLifecycleTeardown(taskId: string): boolean {
  return completedTeardowns.get(taskId)?.lifecycle ?? false;
}

export function hasCompletedTaskProviderDestroy(taskId: string): boolean {
  return completedTeardowns.get(taskId)?.providerDestroy ?? false;
}

export function markTaskLifecycleTeardownCompleted(taskId: string): void {
  const completed = completedTeardowns.get(taskId);
  completedTeardowns.set(taskId, {
    lifecycle: true,
    providerDestroy: completed?.providerDestroy ?? false,
  });
}

export function markTaskProviderDestroyCompleted(taskId: string): void {
  completedTeardowns.set(taskId, { lifecycle: true, providerDestroy: true });
}

export function clearTaskResourceTeardown(taskId: string): void {
  completedTeardowns.delete(taskId);
}
