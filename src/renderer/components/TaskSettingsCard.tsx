import React, { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Switch } from './ui/switch';

const TaskSettingsCard: React.FC = () => {
  const [autoGenerateName, setAutoGenerateName] = useState(true);
  const [autoApproveByDefault, setAutoApproveByDefault] = useState(false);
  const [startInPlanModeByDefault, setStartInPlanModeByDefault] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await window.electronAPI.getSettings();
        if (cancelled) return;
        if (result.success) {
          setAutoGenerateName(result.settings?.tasks?.autoGenerateName ?? true);
          setAutoApproveByDefault(result.settings?.tasks?.autoApproveByDefault ?? false);
          setStartInPlanModeByDefault(result.settings?.tasks?.startInPlanModeByDefault ?? true);
        } else {
          setError(result.error || 'Failed to load settings.');
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Failed to load settings.';
          setError(message);
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
    setSaving(true);
    try {
      const result = await window.electronAPI.updateSettings({ tasks: { autoGenerateName: next } });
      if (!result.success) {
        throw new Error(result.error || 'Failed to update settings.');
      }
      setAutoGenerateName(result.settings?.tasks?.autoGenerateName ?? next);
      setAutoApproveByDefault(result.settings?.tasks?.autoApproveByDefault ?? autoApproveByDefault);
      setStartInPlanModeByDefault(
        result.settings?.tasks?.startInPlanModeByDefault ?? startInPlanModeByDefault
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update settings.';
      setAutoGenerateName(previous);
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const updateAutoApproveByDefault = async (next: boolean) => {
    const previous = autoApproveByDefault;
    setAutoApproveByDefault(next);
    setError(null);
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
      setStartInPlanModeByDefault(
        result.settings?.tasks?.startInPlanModeByDefault ?? startInPlanModeByDefault
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update settings.';
      setAutoApproveByDefault(previous);
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const updateStartInPlanModeByDefault = async (next: boolean) => {
    const previous = startInPlanModeByDefault;
    setStartInPlanModeByDefault(next);
    setError(null);
    setSaving(true);
    try {
      const result = await window.electronAPI.updateSettings({
        tasks: { startInPlanModeByDefault: next },
      });
      if (!result.success) {
        throw new Error(result.error || 'Failed to update settings.');
      }
      setAutoGenerateName(result.settings?.tasks?.autoGenerateName ?? autoGenerateName);
      setAutoApproveByDefault(result.settings?.tasks?.autoApproveByDefault ?? autoApproveByDefault);
      setStartInPlanModeByDefault(result.settings?.tasks?.startInPlanModeByDefault ?? next);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update settings.';
      setStartInPlanModeByDefault(previous);
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-border/60 bg-muted/10 p-4">
      <div className="space-y-3">
        <label className="flex items-center justify-between gap-2">
          <span className="text-sm">Auto-generate task names</span>
          <Switch
            checked={autoGenerateName}
            disabled={loading || saving}
            onCheckedChange={updateAutoGenerateName}
          />
        </label>
        <label className="flex items-center justify-between gap-2">
          <div className="space-y-1">
            <div className="text-sm">Enable Auto-approve by default in new tasks</div>
            <div className="text-xs text-muted-foreground">
              Skips permission prompts for file operations.{' '}
              <a
                href="https://simonwillison.net/2025/Oct/22/living-dangerously-with-claude/"
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-0.5 text-foreground underline"
              >
                Learn more
                <ExternalLink className="h-3 w-3" />
              </a>
              <br />
              <span className="text-[11px] text-muted-foreground/70">
                Supported by: Claude Code, Cursor, Gemini, Qwen, Codex, Rovo, Mistral
              </span>
            </div>
          </div>
          <Switch
            checked={autoApproveByDefault}
            disabled={loading || saving}
            onCheckedChange={updateAutoApproveByDefault}
          />
        </label>
        <label className="flex items-center justify-between gap-2">
          <div className="space-y-1">
            <div className="text-sm">Start in Plan mode by default in new tasks</div>
            <div className="text-xs text-muted-foreground">
              Agent plans before making changes.
              <br />
              <span className="text-[11px] text-muted-foreground/70">
                Supported by: Claude Code
              </span>
            </div>
          </div>
          <Switch
            checked={startInPlanModeByDefault}
            disabled={loading || saving}
            onCheckedChange={updateStartInPlanModeByDefault}
          />
        </label>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    </div>
  );
};

export default TaskSettingsCard;
