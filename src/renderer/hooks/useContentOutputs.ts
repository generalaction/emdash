import { useState, useEffect, useCallback } from 'react';
import type { ContentOutput } from '@/types/electron-api';

export interface UseContentOutputsResult {
  outputs: ContentOutput[];
  selectedOutput: ContentOutput | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  saveOutput: (
    agentId: string,
    content: string,
    metadata?: Record<string, unknown>
  ) => Promise<ContentOutput | null>;
  selectOutput: (id: string) => Promise<boolean>;
  updateOutput: (
    id: string,
    content: string,
    metadata?: Record<string, unknown>
  ) => Promise<ContentOutput | null>;
  deleteOutput: (id: string) => Promise<boolean>;
  refresh: () => Promise<void>;
}

/**
 * Hook for managing content outputs for a task.
 * Provides CRUD operations and tracks selected/preferred output.
 */
export function useContentOutputs(taskId: string | null | undefined): UseContentOutputsResult {
  const [outputs, setOutputs] = useState<ContentOutput[]>([]);
  const [selectedOutput, setSelectedOutput] = useState<ContentOutput | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch outputs when taskId changes
  const fetchOutputs = useCallback(async () => {
    if (!taskId) {
      setOutputs([]);
      setSelectedOutput(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Fetch all outputs for the task
      const outputsResult = await window.electronAPI.contentOutputGetByTask(taskId);
      if (outputsResult.success && outputsResult.data) {
        setOutputs(outputsResult.data);

        // Find selected output
        const selected = outputsResult.data.find((o) => o.selected);
        setSelectedOutput(selected || null);
      } else {
        setError(outputsResult.error || 'Failed to fetch outputs');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    fetchOutputs();
  }, [fetchOutputs]);

  // Save a new output
  const saveOutput = useCallback(
    async (
      agentId: string,
      content: string,
      metadata?: Record<string, unknown>
    ): Promise<ContentOutput | null> => {
      if (!taskId) return null;

      try {
        const result = await window.electronAPI.contentOutputCreate({
          taskId,
          agentId,
          content,
          metadata,
        });

        if (result.success && result.data) {
          setOutputs((prev) => [...prev, result.data!]);
          return result.data;
        } else {
          setError(result.error || 'Failed to save output');
        }
      } catch (err) {
        setError(String(err));
      }

      return null;
    },
    [taskId]
  );

  // Select an output as preferred
  const selectOutput = useCallback(async (id: string): Promise<boolean> => {
    try {
      const result = await window.electronAPI.contentOutputSelect(id);

      if (result.success && result.data) {
        // Update local state to reflect selection
        setOutputs((prev) =>
          prev.map((o) => ({
            ...o,
            selected: o.id === id,
          }))
        );
        setSelectedOutput(result.data);
        return true;
      } else {
        setError(result.error || 'Failed to select output');
      }
    } catch (err) {
      setError(String(err));
    }

    return false;
  }, []);

  // Update an output's content
  const updateOutput = useCallback(
    async (
      id: string,
      content: string,
      metadata?: Record<string, unknown>
    ): Promise<ContentOutput | null> => {
      try {
        const result = await window.electronAPI.contentOutputUpdate({
          id,
          content,
          metadata,
        });

        if (result.success && result.data) {
          setOutputs((prev) => prev.map((o) => (o.id === id ? result.data! : o)));

          // Update selected if this was the selected one
          if (selectedOutput?.id === id) {
            setSelectedOutput(result.data);
          }

          return result.data;
        } else {
          setError(result.error || 'Failed to update output');
        }
      } catch (err) {
        setError(String(err));
      }

      return null;
    },
    [selectedOutput]
  );

  // Delete an output
  const deleteOutput = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const result = await window.electronAPI.contentOutputDelete(id);

        if (result.success) {
          setOutputs((prev) => prev.filter((o) => o.id !== id));

          // Clear selected if deleted
          if (selectedOutput?.id === id) {
            setSelectedOutput(null);
          }

          return true;
        } else {
          setError(result.error || 'Failed to delete output');
        }
      } catch (err) {
        setError(String(err));
      }

      return false;
    },
    [selectedOutput]
  );

  return {
    outputs,
    selectedOutput,
    isLoading,
    error,
    saveOutput,
    selectOutput,
    updateOutput,
    deleteOutput,
    refresh: fetchOutputs,
  };
}

/**
 * Get outputs grouped by agent.
 */
export function groupOutputsByAgent(outputs: ContentOutput[]): Map<string, ContentOutput[]> {
  const grouped = new Map<string, ContentOutput[]>();

  for (const output of outputs) {
    const existing = grouped.get(output.agentId) || [];
    existing.push(output);
    grouped.set(output.agentId, existing);
  }

  // Sort each group by version descending
  for (const [agentId, agentOutputs] of grouped) {
    agentOutputs.sort((a, b) => b.version - a.version);
    grouped.set(agentId, agentOutputs);
  }

  return grouped;
}

/**
 * Get the latest output for each agent.
 */
export function getLatestOutputPerAgent(outputs: ContentOutput[]): ContentOutput[] {
  const grouped = groupOutputsByAgent(outputs);
  const latest: ContentOutput[] = [];

  for (const agentOutputs of grouped.values()) {
    if (agentOutputs.length > 0) {
      latest.push(agentOutputs[0]); // First is latest due to version sort
    }
  }

  return latest;
}
