import { useCallback, useState } from 'react';
import { generateFriendlyTaskName, liveTransformTaskName } from '@renderer/lib/taskNames';

export type TaskNameState = ReturnType<typeof useTaskName>;

export function useTaskName(initialName?: string) {
  const [taskName, setTaskName] = useState(initialName ?? generateFriendlyTaskName());
  const [showSlugHint, setShowSlugHint] = useState(false);

  const handleTaskNameChange = useCallback((value: string) => {
    const transformed = liveTransformTaskName(value);
    setTaskName(transformed);
    const hasDroppedChars = /[^a-z0-9\s-]/i.test(value);
    setShowSlugHint(hasDroppedChars);
  }, []);

  return { taskName, handleTaskNameChange, showSlugHint };
}
