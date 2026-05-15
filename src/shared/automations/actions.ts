export type TaskCreateAction = {
  kind: 'task.create';
  prompt: string;
};

export function isValidAction(action: TaskCreateAction): boolean {
  return action.prompt.trim().length > 0;
}
