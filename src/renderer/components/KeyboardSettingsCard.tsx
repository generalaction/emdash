import React, { useEffect, useState, useCallback, useRef } from 'react';
import { ArrowBigUp, Command, RotateCcw } from 'lucide-react';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { toast } from '../hooks/use-toast';
import {
  APP_SHORTCUTS,
  type AppShortcut,
  type ShortcutSettingsKey,
} from '../hooks/useKeyboardShortcuts';
import type { ShortcutModifier } from '../types/shortcuts';
import { useKeyboardSettings } from '../contexts/KeyboardSettingsContext';

interface ShortcutBinding {
  key: string;
  modifier: ShortcutModifier;
}

const SPECIAL_SHORTCUT_KEYS = ['Tab', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];

const SPECIAL_SHORTCUT_KEY_ALIASES: Record<string, string> = {
  tab: 'Tab',
  escape: 'Escape',
  esc: 'Escape',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
};

const normalizeCapturedKey = (rawKey: string): string | null => {
  const key = rawKey.trim();
  if (!key) return null;

  if (key.length === 1) {
    return key.toLowerCase();
  }

  return SPECIAL_SHORTCUT_KEY_ALIASES[key.toLowerCase()] ?? null;
};

const formatShortcutKeyLabel = (key: string): string => {
  if (key === 'Tab') return 'Tab';
  if (key === 'Escape') return 'Esc';
  if (key === 'ArrowLeft') return '←';
  if (key === 'ArrowRight') return '→';
  if (key === 'ArrowUp') return '↑';
  if (key === 'ArrowDown') return '↓';
  return key.toUpperCase();
};

// Get configurable shortcuts (filter out hidden ones)
const CONFIGURABLE_SHORTCUTS = Object.entries(APP_SHORTCUTS)
  .filter(([, shortcut]) => !shortcut.hideFromSettings && shortcut.modifier)
  .map(([id, shortcut]) => ({ id, ...shortcut }));

const formatModifier = (modifier: ShortcutModifier | undefined): string => {
  switch (modifier) {
    case 'cmd':
      return '⌘';
    case 'cmd+shift':
      return '⌘⇧';
    case 'ctrl':
      return 'Ctrl';
    case 'ctrl+shift':
      return 'Ctrl⇧';
    case 'alt':
    case 'option':
      return '⌥';
    case 'shift':
      return '⇧';
    default:
      return '';
  }
};

const ShortcutDisplay: React.FC<{ binding: ShortcutBinding }> = ({ binding }) => {
  const displayKey = formatShortcutKeyLabel(binding.key);

  const kbdBase = 'flex h-6 min-w-6 items-center justify-center rounded bg-muted px-1.5 text-xs';

  // Split compound modifiers into separate kbd elements
  const modifierElements: React.ReactNode[] = [];
  if (binding.modifier === 'cmd+shift') {
    modifierElements.push(
      <kbd key="cmd" className={kbdBase}>
        <Command className="h-3 w-3" />
      </kbd>
    );
    modifierElements.push(
      <kbd key="shift" className={kbdBase}>
        <ArrowBigUp className="h-3 w-3" />
      </kbd>
    );
  } else if (binding.modifier === 'ctrl+shift') {
    modifierElements.push(
      <kbd key="ctrl" className={`${kbdBase} font-mono`}>
        Ctrl
      </kbd>
    );
    modifierElements.push(
      <kbd key="shift" className={kbdBase}>
        <ArrowBigUp className="h-3 w-3" />
      </kbd>
    );
  } else if (binding.modifier === 'cmd') {
    modifierElements.push(
      <kbd key="cmd" className={kbdBase}>
        <Command className="h-3 w-3" />
      </kbd>
    );
  } else if (binding.modifier === 'shift') {
    modifierElements.push(
      <kbd key="shift" className={kbdBase}>
        <ArrowBigUp className="h-3 w-3" />
      </kbd>
    );
  } else if (binding.modifier) {
    modifierElements.push(
      <kbd key="mod" className={`${kbdBase} font-mono`}>
        {formatModifier(binding.modifier)}
      </kbd>
    );
  }

  return (
    <span className="flex items-center gap-1">
      {modifierElements}
      <kbd className={`${kbdBase} font-mono`}>{displayKey}</kbd>
    </span>
  );
};

const KeyboardSettingsCard: React.FC = () => {
  const { refreshSettings } = useKeyboardSettings();
  const [bindings, setBindings] = useState<Record<ShortcutSettingsKey, ShortcutBinding>>(() => {
    const initial: Record<string, ShortcutBinding> = {};
    for (const shortcut of CONFIGURABLE_SHORTCUTS) {
      initial[shortcut.settingsKey] = {
        key: shortcut.key,
        modifier: shortcut.modifier!,
      };
    }
    return initial as Record<ShortcutSettingsKey, ShortcutBinding>;
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capturingKey, setCapturingKey] = useState<ShortcutSettingsKey | null>(null);
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
            for (const shortcut of CONFIGURABLE_SHORTCUTS) {
              const saved = keyboard[shortcut.settingsKey as keyof typeof keyboard];
              if (saved) {
                next[shortcut.settingsKey] = saved;
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
    async (settingsKey: ShortcutSettingsKey, binding: ShortcutBinding) => {
      const shortcut = CONFIGURABLE_SHORTCUTS.find((s) => s.settingsKey === settingsKey);
      if (!shortcut) return;

      const previous = bindings[settingsKey];
      setBindings((prev) => ({ ...prev, [settingsKey]: binding }));
      setError(null);
      setSaving(true);
      try {
        const result = await window.electronAPI.updateSettings({
          keyboard: { [settingsKey]: binding },
        });
        if (!result.success) {
          throw new Error(result.error || 'Failed to update settings.');
        }
        const savedBinding =
          result.settings?.keyboard?.[settingsKey as keyof typeof result.settings.keyboard];
        if (savedBinding) {
          setBindings((prev) => ({
            ...prev,
            [settingsKey]: savedBinding,
          }));
        }
        toast({
          title: 'Shortcut updated',
          description: `${shortcut.label} is now ${formatModifier(binding.modifier)} ${formatShortcutKeyLabel(binding.key)}`,
        });
        // Refresh global keyboard settings so shortcuts work immediately
        await refreshSettings();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update settings.';
        setBindings((prev) => ({ ...prev, [settingsKey]: previous }));
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
    [bindings, refreshSettings]
  );

  const handleKeyCapture = useCallback(
    (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (!capturingKey) return;

      // Determine which modifier is pressed
      let modifier: ShortcutModifier | null = null;
      if (event.metaKey && event.shiftKey) {
        modifier = 'cmd+shift';
      } else if (event.ctrlKey && event.shiftKey) {
        modifier = 'ctrl+shift';
      } else if (event.metaKey) {
        modifier = 'cmd';
      } else if (event.ctrlKey) {
        modifier = 'ctrl';
      } else if (event.altKey) {
        modifier = 'alt';
      } else if (event.shiftKey) {
        modifier = 'shift';
      }

      // Ignore if only modifier key pressed (no actual key)
      const isModifierOnly = ['Meta', 'Control', 'Alt', 'Shift'].includes(event.key);
      if (isModifierOnly) return;

      // Require a modifier
      if (!modifier) {
        setError('Please press a modifier key (Cmd/Ctrl/Alt/Shift) + a key');
        return;
      }

      const normalizedKey = normalizeCapturedKey(event.key);
      if (!normalizedKey) {
        setError(
          `Unsupported key. Use a letter/number or one of: ${SPECIAL_SHORTCUT_KEYS.join(', ')}`
        );
        return;
      }

      const newBinding: ShortcutBinding = {
        key: normalizedKey,
        modifier,
      };

      const currentCapturingKey = capturingKey;
      setCapturingKey(null);
      saveBinding(currentCapturingKey, newBinding);
    },
    [capturingKey, saveBinding]
  );

  useEffect(() => {
    if (capturingKey) {
      window.addEventListener('keydown', handleKeyCapture);
      return () => window.removeEventListener('keydown', handleKeyCapture);
    }
  }, [capturingKey, handleKeyCapture]);

  const startCapture = (settingsKey: ShortcutSettingsKey) => {
    setError(null);
    setCapturingKey(settingsKey);
    captureRef.current?.focus();
  };

  const cancelCapture = () => {
    setCapturingKey(null);
    setError(null);
  };

  const handleReset = (shortcut: AppShortcut & { id: string }) => {
    if (shortcut.modifier) {
      saveBinding(shortcut.settingsKey, {
        key: shortcut.key,
        modifier: shortcut.modifier,
      });
    }
  };

  const isModified = (shortcut: AppShortcut & { id: string }) => {
    const current = bindings[shortcut.settingsKey];
    if (!current || !shortcut.modifier) return false;
    return current.key !== shortcut.key || current.modifier !== shortcut.modifier;
  };

  return (
    <div className="rounded-xl border border-border/60 bg-muted/10 p-4">
      <div className="space-y-4">
        {CONFIGURABLE_SHORTCUTS.map((shortcut) => (
          <div key={shortcut.id} className="flex items-center justify-between gap-2">
            <div className="space-y-1">
              <div className="text-sm">{shortcut.label}</div>
              <div className="text-xs text-muted-foreground">{shortcut.description}</div>
            </div>
            <div className="flex items-center gap-2">
              {capturingKey === shortcut.settingsKey ? (
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
                  {isModified(shortcut) ? (
                    <TooltipProvider delayDuration={150}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handleReset(shortcut)}
                            disabled={loading || saving}
                          >
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Reset to default shortcut</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-w-[80px]"
                    onClick={() => startCapture(shortcut.settingsKey)}
                    disabled={loading || saving}
                  >
                    <ShortcutDisplay binding={bindings[shortcut.settingsKey]} />
                  </Button>
                </>
              )}
            </div>
          </div>
        ))}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    </div>
  );
};

export default KeyboardSettingsCard;
