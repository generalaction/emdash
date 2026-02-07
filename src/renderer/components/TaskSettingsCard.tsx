import React, { useEffect, useState, useRef } from 'react';
import { ExternalLink } from 'lucide-react';
import { Switch } from './ui/switch';
import { Input } from './ui/input';

const TaskSettingsCard: React.FC = () => {
  const [autoGenerateName, setAutoGenerateName] = useState(true);
  const [autoApproveByDefault, setAutoApproveByDefault] = useState(false);
  const [autoRenameWithLLM, setAutoRenameWithLLM] = useState(false);
  const [llmRenameModel, setLlmRenameModel] = useState('llama3.2:1b');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const modelDebounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await window.electronAPI.getSettings();
        if (cancelled) return;
        if (result.success) {
          setAutoGenerateName(result.settings?.tasks?.autoGenerateName ?? true);
          setAutoApproveByDefault(result.settings?.tasks?.autoApproveByDefault ?? false);
          setAutoRenameWithLLM(result.settings?.tasks?.autoRenameWithLLM ?? false);
          setLlmRenameModel(result.settings?.tasks?.llmRenameModel ?? 'llama3.2:1b');
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

  const updateAutoRenameWithLLM = async (next: boolean) => {
    const previous = autoRenameWithLLM;
    setAutoRenameWithLLM(next);
    setError(null);
    setSaving(true);
    try {
      const result = await window.electronAPI.updateSettings({
        tasks: { autoRenameWithLLM: next },
      });
      if (!result.success) {
        throw new Error(result.error || 'Failed to update settings.');
      }
      setAutoRenameWithLLM(result.settings?.tasks?.autoRenameWithLLM ?? next);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update settings.';
      setAutoRenameWithLLM(previous);
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const updateLlmRenameModel = (value: string) => {
    setLlmRenameModel(value);
    if (modelDebounceRef.current) clearTimeout(modelDebounceRef.current);
    modelDebounceRef.current = setTimeout(async () => {
      setSaving(true);
      try {
        const result = await window.electronAPI.updateSettings({
          tasks: { llmRenameModel: value },
        });
        if (!result.success) {
          throw new Error(result.error || 'Failed to update settings.');
        }
        setLlmRenameModel(result.settings?.tasks?.llmRenameModel ?? value);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update settings.';
        setError(message);
      } finally {
        setSaving(false);
      }
    }, 500);
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
            <div className="text-sm">Auto-rename with local LLM (Ollama)</div>
            <div className="text-xs text-muted-foreground">
              Renames tasks ~60s after they start using a local Ollama model.
              <br />
              <span className="text-[11px] text-muted-foreground/70">
                Requires Ollama running at localhost:11434
              </span>
            </div>
          </div>
          <Switch
            checked={autoRenameWithLLM}
            disabled={loading || saving}
            onCheckedChange={updateAutoRenameWithLLM}
          />
        </label>
        {autoRenameWithLLM ? (
          <div className="ml-1 space-y-1">
            <label className="text-xs text-muted-foreground">Ollama model</label>
            <Input
              value={llmRenameModel}
              onChange={(e) => updateLlmRenameModel(e.target.value)}
              disabled={loading || saving}
              placeholder="llama3.2:1b"
              className="h-8 text-xs"
            />
          </div>
        ) : null}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    </div>
  );
};

export default TaskSettingsCard;
