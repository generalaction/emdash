import { formatForDisplay, useHotkeyRecorder, type Hotkey } from '@tanstack/react-hotkeys';
import { RotateCcw, X } from 'lucide-react';
import React, { useState } from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { toast } from '@renderer/lib/hooks/use-toast';
import {
  APP_SHORTCUTS,
  getEffectiveHotkey,
  type ShortcutSettingsKey,
} from '@renderer/lib/hooks/useKeyboardShortcuts';
import { Button } from '@renderer/lib/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';

const CONFIGURABLE_SHORTCUTS = (
  Object.entries(APP_SHORTCUTS) as [
    ShortcutSettingsKey,
    (typeof APP_SHORTCUTS)[ShortcutSettingsKey],
  ][]
).filter(([, def]) => !def.hideFromSettings);

const SHORTCUTS_BY_CATEGORY = CONFIGURABLE_SHORTCUTS.reduce<
  Record<string, [ShortcutSettingsKey, (typeof APP_SHORTCUTS)[ShortcutSettingsKey]][]>
>((acc, entry) => {
  const category = entry[1].category;
  if (!acc[category]) acc[category] = [];
  acc[category].push(entry);
  return acc;
}, {});

const KeyboardSettingsCard: React.FC = () => {
  const {
    value: keyboard,
    update,
    isLoading: loading,
    isSaving: saving,
    resetField,
  } = useAppSettingsKey('keyboard');

  const [editingKey, setEditingKey] = useState<ShortcutSettingsKey | null>(null);

  const recorder = useHotkeyRecorder({
    onRecord: (hotkey: Hotkey) => {
      if (!editingKey) return;

      const conflict = CONFIGURABLE_SHORTCUTS.find(([key]) => {
        if (key === editingKey) return false;
        return getEffectiveHotkey(key, keyboard) === hotkey;
      });

      if (conflict) {
        const [, def] = conflict;
        const msg = `Conflicts with "${def.label}". Choose a different shortcut.`;
        toast({ title: 'Shortcut conflict', description: msg, variant: 'destructive' });
        recorder.cancelRecording();
        setEditingKey(null);
        return;
      }

      update({ [editingKey]: hotkey });
      toast({
        title: 'Shortcut updated',
        description: `${APP_SHORTCUTS[editingKey].label} is now ${formatForDisplay(hotkey)}`,
      });
      setEditingKey(null);
    },
    onCancel: () => setEditingKey(null),
  });

  const startCapture = (key: ShortcutSettingsKey) => {
    setEditingKey(key);
    recorder.startRecording();
  };

  const handleReset = (key: ShortcutSettingsKey) => {
    resetField(key);
    toast({
      title: 'Shortcut reset',
      description: `${APP_SHORTCUTS[key].label} reset to default.`,
    });
  };

  const handleClear = (key: ShortcutSettingsKey) => {
    update({ [key]: null });
    toast({
      title: 'Shortcut removed',
      description: `${APP_SHORTCUTS[key].label} no longer has a key binding.`,
    });
  };

  return (
    <div className="rounded-xl border border-border/60 bg-muted/10 p-4">
      <div className="space-y-6">
        {Object.entries(SHORTCUTS_BY_CATEGORY).map(([category, shortcuts]) => (
          <div key={category}>
            <div className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {category}
            </div>
            <div className="space-y-3">
              {shortcuts.map(([key, def]) => {
                const effectiveHotkey = getEffectiveHotkey(key, keyboard);
                const capturing = editingKey === key && recorder.isRecording;
                const cleared = keyboard?.[key] === null;
                const showClear = !cleared;
                const showReset = effectiveHotkey !== def.defaultHotkey;
                const showActions = showClear || showReset;
                const displayHotkey = effectiveHotkey ? formatForDisplay(effectiveHotkey) : '';

                return (
                  <div key={key} className="group/shortcut flex items-center justify-between gap-2">
                    <div className="space-y-1">
                      <div className="text-sm">{def.label}</div>
                      <div className="text-xs text-muted-foreground">{def.description}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      {capturing ? (
                        <>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="min-w-[80px] animate-pulse"
                            onClick={() => recorder.cancelRecording()}
                            disabled={saving}
                          >
                            Press keys...
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => recorder.cancelRecording()}
                            disabled={saving}
                          >
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <>
                          {showActions && (
                            <div className="pointer-events-none flex items-center gap-1 opacity-0 transition-opacity group-hover/shortcut:pointer-events-auto group-hover/shortcut:opacity-100">
                              <TooltipProvider delay={150}>
                                {showClear && (
                                  <Tooltip>
                                    <TooltipTrigger>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="text-muted-foreground hover:text-foreground"
                                        onClick={() => handleClear(key)}
                                        disabled={loading || saving}
                                        aria-label="Remove shortcut"
                                      >
                                        <X className="h-3.5 w-3.5" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top">Remove shortcut</TooltipContent>
                                  </Tooltip>
                                )}
                                {showReset && (
                                  <Tooltip>
                                    <TooltipTrigger>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="text-muted-foreground hover:text-foreground"
                                        onClick={() => handleReset(key)}
                                        disabled={loading || saving}
                                        aria-label="Reset to default"
                                      >
                                        <RotateCcw className="h-3.5 w-3.5" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top">Reset to default</TooltipContent>
                                  </Tooltip>
                                )}
                              </TooltipProvider>
                            </div>
                          )}
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="min-w-[80px] font-mono"
                            onClick={() => startCapture(key)}
                            disabled={loading || saving}
                          >
                            {displayHotkey}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default KeyboardSettingsCard;
