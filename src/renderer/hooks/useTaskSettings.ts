import { useEffect, useState } from 'react';

export type TaskSettingsErrorScope =
  | 'autoGenerateName'
  | 'autoApproveByDefault'
  | 'autoTrustWorktrees'
  | 'load'
  | null;

export interface TaskSettingsModel {
  autoGenerateName: boolean;
  autoApproveByDefault: boolean;
  autoTrustWorktrees: boolean;
  loading: boolean;
  saving: boolean;
  error: string | null;
  errorScope: TaskSettingsErrorScope;
  updateAutoGenerateName: (next: boolean) => Promise<void>;
  updateAutoApproveByDefault: (next: boolean) => Promise<void>;
  updateAutoTrustWorktrees: (next: boolean) => Promise<void>;
}

export function useTaskSettings(): TaskSettingsModel {
  const [autoGenerateName, setAutoGenerateName] = useState(true);
  const [autoApproveByDefault, setAutoApproveByDefault] = useState(false);
  const [autoTrustWorktrees, setAutoTrustWorktrees] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorScope, setErrorScope] = useState<TaskSettingsErrorScope>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await window.electronAPI.getSettings();
        if (cancelled) return;
        if (result.success) {
          setAutoGenerateName(result.settings?.tasks?.autoGenerateName ?? true);
          setAutoApproveByDefault(result.settings?.tasks?.autoApproveByDefault ?? false);
          setAutoTrustWorktrees(result.settings?.tasks?.autoTrustWorktrees ?? true);
          setError(null);
          setErrorScope(null);
        } else {
          setError(result.error || 'Failed to load settings.');
          setErrorScope('load');
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Failed to load settings.';
          setError(message);
          setErrorScope('load');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const updateAutoGenerateName = async (next: boolean) => {
    const previous = autoGenerateName;
    setAutoGenerateName(next);
    setError(null);
    setErrorScope(null);
    setSaving(true);
    try {
      const result = await window.electronAPI.updateSettings({ tasks: { autoGenerateName: next } });
      if (!result.success) {
        throw new Error(result.error || 'Failed to update settings.');
      }
      setAutoGenerateName(result.settings?.tasks?.autoGenerateName ?? next);
      setAutoApproveByDefault(result.settings?.tasks?.autoApproveByDefault ?? autoApproveByDefault);
      setAutoTrustWorktrees(result.settings?.tasks?.autoTrustWorktrees ?? autoTrustWorktrees);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update settings.';
      setAutoGenerateName(previous);
      setError(message);
      setErrorScope('autoGenerateName');
    } finally {
      setSaving(false);
    }
  };

  const updateAutoApproveByDefault = async (next: boolean) => {
    const previous = autoApproveByDefault;
    setAutoApproveByDefault(next);
    setError(null);
    setErrorScope(null);
    setSaving(true);
    try {
      const result = await window.electronAPI.updateSettings({
        tasks: { autoApproveByDefault: next },
      });
      if (!result.success) {
        throw new Error(result.error || 'Failed to update settings.');
      }
      setAutoGenerateName(result.settings?.tasks?.autoGenerateName ?? autoGenerateName);
      setAutoApproveByDefault(result.settings?.tasks?.autoApproveByDefault ?? next);
      setAutoTrustWorktrees(result.settings?.tasks?.autoTrustWorktrees ?? autoTrustWorktrees);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update settings.';
      setAutoApproveByDefault(previous);
      setError(message);
      setErrorScope('autoApproveByDefault');
    } finally {
      setSaving(false);
    }
  };

  const updateAutoTrustWorktrees = async (next: boolean) => {
    const previous = autoTrustWorktrees;
    setAutoTrustWorktrees(next);
    setError(null);
    setErrorScope(null);
    setSaving(true);
    try {
      const result = await window.electronAPI.updateSettings({
        tasks: { autoTrustWorktrees: next },
      });
      if (!result.success) {
        throw new Error(result.error || 'Failed to update settings.');
      }
      setAutoGenerateName(result.settings?.tasks?.autoGenerateName ?? autoGenerateName);
      setAutoApproveByDefault(result.settings?.tasks?.autoApproveByDefault ?? autoApproveByDefault);
      setAutoTrustWorktrees(result.settings?.tasks?.autoTrustWorktrees ?? next);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update settings.';
      setAutoTrustWorktrees(previous);
      setError(message);
      setErrorScope('autoTrustWorktrees');
    } finally {
      setSaving(false);
    }
  };

  return {
    autoGenerateName,
    autoApproveByDefault,
    autoTrustWorktrees,
    loading,
    saving,
    error,
    errorScope,
    updateAutoGenerateName,
    updateAutoApproveByDefault,
    updateAutoTrustWorktrees,
  };
}
