import { browserTaskTabContributions } from '@core/features/browser/contributions/tabs';
import { conversationTaskTabContributions } from '@core/features/conversations/contributions/tabs';
import { taskTaskTabContributions } from '@core/features/tasks/contributions/tabs';

export const taskTabContributions = [
  ...conversationTaskTabContributions,
  ...taskTaskTabContributions,
  ...browserTaskTabContributions,
] as const;
