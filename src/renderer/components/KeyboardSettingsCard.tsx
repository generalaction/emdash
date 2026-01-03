import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Button } from './ui/button';
import { toast } from '../hooks/use-toast';
import type { ShortcutModifier } from '../types/shortcuts';

interface ShortcutBinding {
  key: string;
  modifier: ShortcutModifier;
}

interface ShortcutConfig {
  id: string;
  label: string;
  description: string;
  defaultBinding: ShortcutBinding;
  settingsKey: 'commandPalette'; // extend this union as we add more shortcuts
}

const SHORTCUTS: ShortcutConfig[] = [
  {
    id: 'commandPalette',
    label: 'Command Palette',
    description: 'Open the command palette to quickly search and navigate',
    defaultBinding: { key: 'k', modifier: 'cmd' },
    settingsKey: 'commandPalette',
  },
];

const formatModifier = (modifier: ShortcutBinding['modifier']): string => {
  switch (modifier) {
    case 'cmd':
      return '⌘';
    case 'ctrl':
      return 'Ctrl';
    case 'alt':
    case 'option':
      return '⌥';
    case 'shift':
      return '⇧';
    default:
      return '';
  }
};

const ShortcutDisplay: React.FC<{ binding: ShortcutBinding }> = ({ binding }) => (
  <span className="flex items-center gap-1">
    <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
      {formatModifier(binding.modifier)}
    </kbd>
    <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
      {binding.key.toUpperCase()}
    </kbd>
  </span>
);

const KeyboardSettingsCard: React.FC = () => {
  const [bindings, setBindings] = useState<Record<string, ShortcutBinding>>(() =>
    Object.fromEntries(SHORTCUTS.map((s) => [s.id, s.defaultBinding]))
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capturingId, setCapturingId] = useState<string | null>(null);
  const captureRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await window.electronAPI.getSettings();
        if (cancelled) return;
        if (result.success && result.settings?.keyboard) {
          const keyboard = result.settings.keyboard;
          setBindings((prev) => {
            const next = { ...prev };
            for (const shortcut of SHORTCUTS) {
              const saved = keyboard[shortcut.settingsKey];
              if (saved) {
                next[shortcut.id] = saved;
              }
            }
            return next;
          });
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

  const saveBinding = useCallback(
    async (shortcutId: string, binding: ShortcutBinding) => {
      const shortcut = SHORTCUTS.find((s) => s.id === shortcutId);
      if (!shortcut) return;

      const previous = bindings[shortcutId];
      setBindings((prev) => ({ ...prev, [shortcutId]: binding }));
      setError(null);
      setSaving(true);
      try {
        const result = await window.electronAPI.updateSettings({
          keyboard: { [shortcut.settingsKey]: binding },
        });
        if (!result.success) {
          throw new Error(result.error || 'Failed to update settings.');
        }
        if (result.settings?.keyboard?.[shortcut.settingsKey]) {
          setBindings((prev) => ({
            ...prev,
            [shortcutId]: result.settings!.keyboard![shortcut.settingsKey],
          }));
        }
        toast({
          title: 'Shortcut updated',
          description: `${shortcut.label} is now ${formatModifier(binding.modifier)} ${binding.key.toUpperCase()}`,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update settings.';
        setBindings((prev) => ({ ...prev, [shortcutId]: previous }));
        setError(message);
        toast({
          title: 'Failed to save shortcut',
          description: message,
          variant: 'destructive',
        });
      } finally {
        setSaving(false);
      }
    },
    [bindings]
  );

  const handleKeyCapture = useCallback(
    (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (!capturingId) return;

      // Determine which modifier is pressed
      let modifier: ShortcutModifier | null = null;
      if (event.metaKey) modifier = 'cmd';
      else if (event.ctrlKey) modifier = 'ctrl';
      else if (event.altKey) modifier = 'alt';
      else if (event.shiftKey) modifier = 'shift';

      // Ignore if only modifier key pressed (no actual key)
      const isModifierOnly = ['Meta', 'Control', 'Alt', 'Shift'].includes(event.key);
      if (isModifierOnly) return;

      // Require a modifier
      if (!modifier) {
        setError('Please press a modifier key (Cmd/Ctrl/Alt/Shift) + a letter/number');
        return;
      }

      // Only allow single character keys
      if (event.key.length !== 1) {
        setError('Please use a single letter or number key');
        return;
      }

      const newBinding: ShortcutBinding = {
        key: event.key.toLowerCase(),
        modifier,
      };

      const currentCapturingId = capturingId;
      setCapturingId(null);
      saveBinding(currentCapturingId, newBinding);
    },
    [capturingId, saveBinding]
  );

  useEffect(() => {
    if (capturingId) {
      window.addEventListener('keydown', handleKeyCapture);
      return () => window.removeEventListener('keydown', handleKeyCapture);
    }
  }, [capturingId, handleKeyCapture]);

  const startCapture = (shortcutId: string) => {
    setError(null);
    setCapturingId(shortcutId);
    captureRef.current?.focus();
  };

  const cancelCapture = () => {
    setCapturingId(null);
    setError(null);
  };

  const handleReset = (shortcut: ShortcutConfig) => {
    saveBinding(shortcut.id, shortcut.defaultBinding);
  };

  const isModified = (shortcut: ShortcutConfig) => {
    const current = bindings[shortcut.id];
    return (
      current.key !== shortcut.defaultBinding.key ||
      current.modifier !== shortcut.defaultBinding.modifier
    );
  };

  return (
    <div className="rounded-xl border border-border/60 bg-muted/10 p-4">
      <div className="space-y-4">
        {SHORTCUTS.map((shortcut) => (
          <div key={shortcut.id} className="flex items-center justify-between gap-2">
            <div className="space-y-1">
              <div className="text-sm">{shortcut.label}</div>
              <div className="text-xs text-muted-foreground">{shortcut.description}</div>
            </div>
            <div className="flex items-center gap-2">
              {capturingId === shortcut.id ? (
                <>
                  <Button
                    ref={captureRef}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-w-[80px] animate-pulse"
                    onClick={cancelCapture}
                    disabled={saving}
                  >
                    Press keys...
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={cancelCapture}
                    disabled={saving}
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-w-[80px]"
                    onClick={() => startCapture(shortcut.id)}
                    disabled={loading || saving}
                  >
                    <ShortcutDisplay binding={bindings[shortcut.id]} />
                  </Button>
                  {isModified(shortcut) ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleReset(shortcut)}
                      disabled={loading || saving}
                    >
                      Reset
                    </Button>
                  ) : null}
                </>
              )}
            </div>
          </div>
        ))}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        <p className="text-xs text-muted-foreground">
          Click a shortcut button and press a new key combination. Requires a modifier key
          (Cmd/Ctrl/Alt/Shift) + a letter or number.
        </p>
      </div>
    </div>
  );
};

export default KeyboardSettingsCard;
