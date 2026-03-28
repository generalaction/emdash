import { useState } from 'react';
import { generateFriendlyTaskName } from '@renderer/lib/taskNames';

export type FromPullRequestModeState = ReturnType<typeof useFromPullRequestMode>;

export function useFromPullRequestMode() {
  const [taskName] = useState(generateFriendlyTaskName());
  return { taskName };
}
