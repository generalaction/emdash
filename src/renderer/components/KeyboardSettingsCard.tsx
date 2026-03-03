import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { ArrowBigUp, Command, RotateCcw } from 'lucide-react';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { toast } from '../hooks/use-toast';
import {
  APP_SHORTCUTS,
  hasShortcutConflict,
  normalizeShortcutKey,
  type AppShortcut,
  type ShortcutSettingsKey,
} from '../hooks/useKeyboardShortcuts';
import type { ShortcutModifier } from '../types/shortcuts';
import { useAppSettings } from '@/contexts/AppSettingsProvider';

interface ShortcutBinding {
  key: string;
  modifier: ShortcutModifier;
}

// Get configurable shortcuts (filter out hidden ones)
const CONFIGURABLE_SHORTCUTS = Object.entries(APP_SHORTCUTS)
  .filter(([, shortcut]) => !shortcut.hideFromSettings && shortcut.modifier)
  .map(([id, shortcut]) => ({ id, ...shortcut }));

function findConflictingShortcut(
  settingsKey: ShortcutSettingsKey,
  binding: ShortcutBinding,
  allBindings: Record<ShortcutSettingsKey, ShortcutBinding>
): (AppShortcut & { id: string }) | null {
  const candidate = { key: binding.key, modifier: binding.modifier, description: '' };

  for (const shortcut of CONFIGURABLE_SHORTCUTS) {
    if (shortcut.settingsKey === settingsKey) continue;

    const existing = allBindings[shortcut.settingsKey];
    if (!existing) continue;

    const existingConfig = { key: existing.key, modifier: existing.modifier, description: '' };
    if (hasShortcutConflict(candidate, existingConfig)) {
      return shortcut;
    }
  }

  return null;
}

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

const formatDisplayKey = (value: string): string => {
  const key = normalizeShortcutKey(value);
  if (key === 'ArrowLeft') return '←';
  if (key === 'ArrowRight') return '→';
  if (key === 'ArrowUp') return '↑';
  if (key === 'ArrowDown') return '↓';
  if (key === 'Escape') return 'Esc';
  if (key === 'Tab') return 'Tab';
  return key.toUpperCase();
};

const ShortcutDisplay: React.FC<{ binding: ShortcutBinding }> = ({ binding }) => {
  const displayKey = formatDisplayKey(binding.key);

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
  const { settings, updateSettings, isLoading: loading, isSaving: saving } = useAppSettings();
  const [error, setError] = useState<string | null>(null);
  const [capturingKey, setCapturingKey] = useState<ShortcutSettingsKey | null>(null);
  const captureRef = useRef<HTMLButtonElement>(null);

  const bindings = useMemo<Record<ShortcutSettingsKey, ShortcutBinding>>(() => {
    const keyboard = settings?.keyboard;
    const result: Record<string, ShortcutBinding> = {};
    for (const shortcut of CONFIGURABLE_SHORTCUTS) {
      const saved = keyboard?.[shortcut.settingsKey as keyof typeof keyboard];
      result[shortcut.settingsKey] = saved ?? { key: shortcut.key, modifier: shortcut.modifier! };
    }
    return result as Record<ShortcutSettingsKey, ShortcutBinding>;
  }, [settings?.keyboard]);

  const saveBinding = useCallback(
    (settingsKey: ShortcutSettingsKey, binding: ShortcutBinding) => {
      const shortcut = CONFIGURABLE_SHORTCUTS.find((s) => s.settingsKey === settingsKey);
      if (!shortcut) return;

      const nextBindings = { ...bindings, [settingsKey]: binding };
      const conflict = findConflictingShortcut(settingsKey, binding, nextBindings);
      if (conflict) {
        const message = `Conflicts with "${conflict.label}". Choose a different shortcut.`;
        setError(message);
        toast({ title: 'Shortcut conflict', description: message, variant: 'destructive' });
        return;
      }

      setError(null);
      updateSettings({ keyboard: { [settingsKey]: binding } });
      toast({
        title: 'Shortcut updated',
        description: `${shortcut.label} is now ${formatModifier(binding.modifier)} ${formatDisplayKey(binding.key)}`,
      });
    },
    [bindings, updateSettings]
  );

  const handleKeyCapture = useCallback(
    (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (!capturingKey) return;

      // Determine which modifier is pressed
      let modifier: ShortcutModifier | null = null;
      if (event.metaKey && event.ctrlKey) {
        setError('Please use either Cmd or Ctrl, not both.');
        return;
      }
      if (event.altKey && (event.metaKey || event.ctrlKey || event.shiftKey)) {
        setError('Alt/Option can only be used by itself.');
        return;
      }
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
        setError('Please press a modifier key (Cmd/Ctrl/Alt/Shift) + key');
        return;
      }

      const normalizedKey = normalizeShortcutKey(event.key);
      const isSinglePrintable = normalizedKey.length === 1 && /\S/u.test(normalizedKey);
      const isAllowedSpecial = [
        'Tab',
        'Escape',
        'ArrowLeft',
        'ArrowRight',
        'ArrowUp',
        'ArrowDown',
      ].includes(normalizedKey);
      if (!isSinglePrintable && !isAllowedSpecial) {
        setError('Allowed keys: printable character, Tab, Esc, or arrow keys.');
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
