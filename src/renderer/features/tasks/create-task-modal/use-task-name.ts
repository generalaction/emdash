import { useCallback, useState } from 'react';
import { useTaskSettings } from '@renderer/features/tasks/hooks/useTaskSettings';
import { liveTransformTaskName } from '@renderer/utils/taskNames';

export type TaskNameState = {
  taskName: string;
  handleTaskNameChange: (value: string) => void;
  showSlugHint: boolean;
  isPending: boolean;
};

export function useTaskName(opts?: {
  generatedName?: string;
  isPending?: boolean;
  resetKey?: unknown;
  initialName?: string;
}): TaskNameState {
  const { generatedName, isPending = false, resetKey, initialName } = opts ?? {};
  const { preserveNameCapitalization } = useTaskSettings();
  const [taskName, setTaskName] = useState(generatedName ?? initialName ?? '');
  const [showSlugHint, setShowSlugHint] = useState(false);
  const [prevGeneratedName, setPrevGeneratedName] = useState(generatedName);
  const [prevResetKey, setPrevResetKey] = useState(resetKey);

  if (resetKey !== prevResetKey) {
    setPrevResetKey(resetKey);
    setPrevGeneratedName(generatedName);
    setTaskName(generatedName ?? initialName ?? '');
    setShowSlugHint(false);
  } else if (generatedName !== prevGeneratedName) {
    setPrevGeneratedName(generatedName);
    if (generatedName !== undefined) {
      setTaskName(generatedName);
      setShowSlugHint(false);
    }
  }

  const handleTaskNameChange = useCallback(
    (value: string) => {
      const transformed = liveTransformTaskName(value, {
        preserveCapitalization: preserveNameCapitalization,
      });
      setTaskName(transformed);
      const hasDroppedChars = /[^a-z0-9\s-]/i.test(value);
      setShowSlugHint(hasDroppedChars);
    },
    [preserveNameCapitalization]
  );

  return { taskName, handleTaskNameChange, showSlugHint, isPending };
}
