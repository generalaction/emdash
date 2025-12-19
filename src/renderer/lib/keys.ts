// If providerId is supplied, scope the flag per provider; otherwise fall back to legacy key.
export const initialPromptSentKey = (taskId: string, providerId?: string) =>
  providerId && providerId.trim()
    ? `initialPromptSent:${taskId}:${providerId.trim()}`
    : `initialPromptSent:${taskId}`;
