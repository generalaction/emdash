import React, { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import { Switch } from './ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { agentMeta } from '../providers/meta';

type TaskSettingsVariant = 'both' | 'auto-generate' | 'auto-approve';

interface TaskSettingsCardProps {
  variant?: TaskSettingsVariant;
}

const TaskSettingsCard: React.FC<TaskSettingsCardProps> = ({ variant = 'both' }) => {
  const [autoGenerateName, setAutoGenerateName] = useState(true);
  const [autoApproveByDefault, setAutoApproveByDefault] = useState(false);
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
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update settings.';
      setAutoApproveByDefault(previous);
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const showAutoGenerate = variant === 'both' || variant === 'auto-generate';
  const showAutoApprove = variant === 'both' || variant === 'auto-approve';
  const supportedAutoApproveAgents = Object.values(agentMeta)
    .filter((meta) => Boolean(meta.autoApproveFlag))
    .map((meta) => meta.label)
    .sort((a, b) => a.localeCompare(b));
  const supportedAutoApproveText = supportedAutoApproveAgents.join(', ');

  return (
    <div className="flex flex-col gap-4">
      {showAutoGenerate ? (
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-1 flex-col gap-0.5">
            <p className="text-sm font-medium text-foreground">Auto-generate task names</p>
            <p className="text-sm text-muted-foreground">
              Automatically suggests a task name when creating a new task.
            </p>
          </div>
          <Switch
            checked={autoGenerateName}
            disabled={loading || saving}
            onCheckedChange={updateAutoGenerateName}
          />
        </div>
      ) : null}

      {showAutoApprove ? (
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-1 flex-col gap-0.5">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-medium text-foreground">Auto-approve by default</p>
              <TooltipProvider delayDuration={150}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex h-4 w-4 items-center justify-center text-muted-foreground hover:text-foreground"
                      aria-label="Show supported agents for auto-approve"
                    >
                      <Info className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs text-xs">
                    Supported by: {supportedAutoApproveText}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <p className="text-sm text-muted-foreground">
              Skips permission prompts for file operations in new tasks.
            </p>
          </div>
          <Switch
            checked={autoApproveByDefault}
            disabled={loading || saving}
            onCheckedChange={updateAutoApproveByDefault}
          />
        </div>
      ) : null}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
};

export default TaskSettingsCard;
