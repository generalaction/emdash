import { useCallback, useState } from 'react';
import { liveTransformTaskName } from '@renderer/lib/taskNames';

export type TaskNameState = {
  taskName: string;
  handleTaskNameChange: (value: string) => void;
  showSlugHint: boolean;
  isPending: boolean;
};

export function useTaskName(opts?: { generatedName?: string; isPending?: boolean }): TaskNameState {
  const { generatedName, isPending = false } = opts ?? {};
  const [taskName, setTaskName] = useState(generatedName ?? '');
  const [showSlugHint, setShowSlugHint] = useState(false);
  const [prevGeneratedName, setPrevGeneratedName] = useState(generatedName);

  if (generatedName !== prevGeneratedName) {
    setPrevGeneratedName(generatedName);
    if (generatedName !== undefined) {
      setTaskName(generatedName);
      setShowSlugHint(false);
    }
  }

  const handleTaskNameChange = useCallback((value: string) => {
    const transformed = liveTransformTaskName(value);
    setTaskName(transformed);
    const hasDroppedChars = /[^a-z0-9\s-]/i.test(value);
    setShowSlugHint(hasDroppedChars);
  }, []);

  return { taskName, handleTaskNameChange, showSlugHint, isPending };
}
