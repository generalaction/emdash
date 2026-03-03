import { useState, useEffect, useCallback, useRef } from 'react';
import type { TaskNote } from '../types/chat';

export function useTaskNotes(taskId: string | null) {
  const [manualNote, setManualNote] = useState('');
  const [summary, setSummary] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load notes when task changes
  useEffect(() => {
    if (!taskId) {
      setManualNote('');
      setSummary('');
      return;
    }

    let cancelled = false;
    window.electronAPI.taskNotesGet(taskId).then((result) => {
      if (cancelled) return;
      if (result.success && result.notes) {
        const manual = result.notes.find((n: TaskNote) => n.type === 'manual');
        const sum = result.notes.find((n: TaskNote) => n.type === 'summary');
        setManualNote(manual?.content ?? '');
        setSummary(sum?.content ?? '');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [taskId]);

  // Auto-save manual note with debounce
  const saveNote = useCallback(
    (content: string) => {
      if (!taskId) return;
      setManualNote(content);

      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        window.electronAPI.taskNotesUpsert({ taskId, type: 'manual', content });
      }, 500);
    },
    [taskId]
  );

  // Generate summary
  const generateSummary = useCallback(
    async (ptyId: string) => {
      if (!taskId) return;
      setIsGenerating(true);
      setError(null);

      try {
        const result = await window.electronAPI.taskNotesGenerateSummary({ taskId, ptyId });
        if (result.success && result.summary) {
          setSummary(result.summary);
        } else {
          setError(result.error ?? 'Failed to generate summary');
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setIsGenerating(false);
      }
    },
    [taskId]
  );

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  return { manualNote, summary, isGenerating, error, saveNote, generateSummary };
}
