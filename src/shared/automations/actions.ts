export type TaskCreateAction = {
  kind: 'task.create';
  prompt: string;
};

export function isValidAction(action: unknown): action is TaskCreateAction {
  if (!action || typeof action !== 'object') return false;
  const candidate = action as { kind?: unknown; prompt?: unknown };
  return (
    candidate.kind === 'task.create' &&
    typeof candidate.prompt === 'string' &&
    candidate.prompt.trim().length > 0
  );
}
