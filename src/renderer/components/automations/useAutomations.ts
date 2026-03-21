import { useState, useEffect, useCallback } from 'react';
import type {
  Automation,
  AutomationRunLog,
  CreateAutomationInput,
  UpdateAutomationInput,
} from '@shared/automations/types';

export function useAutomations() {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await window.electronAPI.automationsList();
      if (result.success && result.data) {
        setAutomations(result.data);
      } else {
        setError(result.error ?? 'Failed to load automations');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load automations');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = useCallback(
    async (input: CreateAutomationInput): Promise<Automation | null> => {
      try {
        const result = await window.electronAPI.automationsCreate(input);
        if (result.success && result.data) {
          await load();
          return result.data;
        }
        setError(result.error ?? 'Failed to create automation');
        return null;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create automation');
        return null;
      }
    },
    [load]
  );

  const update = useCallback(
    async (input: UpdateAutomationInput): Promise<Automation | null> => {
      try {
        const result = await window.electronAPI.automationsUpdate(input);
        if (result.success && result.data) {
          await load();
          return result.data;
        }
        setError(result.error ?? 'Failed to update automation');
        return null;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update automation');
        return null;
      }
    },
    [load]
  );

  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const result = await window.electronAPI.automationsDelete({ id });
        if (result.success) {
          await load();
          return true;
        }
        setError(result.error ?? 'Failed to delete automation');
        return false;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete automation');
        return false;
      }
    },
    [load]
  );

  const toggle = useCallback(
    async (id: string): Promise<Automation | null> => {
      try {
        const result = await window.electronAPI.automationsToggle({ id });
        if (result.success && result.data) {
          await load();
          return result.data;
        }
        setError(result.error ?? 'Failed to toggle automation');
        return null;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to toggle automation');
        return null;
      }
    },
    [load]
  );

  const getRunLogs = useCallback(
    async (automationId: string, limit?: number): Promise<AutomationRunLog[]> => {
      try {
        const result = await window.electronAPI.automationsRunLogs({ automationId, limit });
        if (result.success && result.data) {
          return result.data;
        }
        return [];
      } catch {
        return [];
      }
    },
    []
  );

  const triggerNow = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const result = await window.electronAPI.automationsTriggerNow({ id });
        if (result.success) {
          await load();
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [load]
  );

  return {
    automations,
    isLoading,
    error,
    refresh: load,
    create,
    update,
    remove,
    toggle,
    getRunLogs,
    triggerNow,
  };
}
