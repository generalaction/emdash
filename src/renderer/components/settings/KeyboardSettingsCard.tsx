import { formatForDisplay, useHotkeyRecorder, type Hotkey } from '@tanstack/react-hotkeys';
import { RotateCcw } from 'lucide-react';
import React, { useState } from 'react';
import { useAppSettingsKey } from '@renderer/contexts/AppSettingsProvider';
import { toast } from '../../hooks/use-toast';
import {
  APP_SHORTCUTS,
  getEffectiveHotkey,
  type ShortcutSettingsKey,
} from '../../hooks/useKeyboardShortcuts';
import { Button } from '../ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';

const CONFIGURABLE_SHORTCUTS = (
  Object.entries(APP_SHORTCUTS) as [
    ShortcutSettingsKey,
    (typeof APP_SHORTCUTS)[ShortcutSettingsKey],
  ][]
).filter(([, def]) => !def.hideFromSettings);

const KeyboardSettingsCard: React.FC = () => {
  const {
    value: keyboard,
    update,
    isLoading: loading,
    isSaving: saving,
  } = useAppSettingsKey('keyboard');

  const [editingKey, setEditingKey] = useState<ShortcutSettingsKey | null>(null);

  const recorder = useHotkeyRecorder({
    onRecord: (hotkey: Hotkey) => {
      if (!editingKey) return;

      // Conflict check: any other action already bound to this hotkey?
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
    // Remove the override — falls back to default
    update({ [key]: undefined });
    toast({
      title: 'Shortcut reset',
      description: `${APP_SHORTCUTS[key].label} reset to default.`,
    });
  };

  const isModified = (key: ShortcutSettingsKey) => Boolean(keyboard?.[key]);

  return (
    <div className="rounded-xl border border-border/60 bg-muted/10 p-4">
      <div className="space-y-4">
        {CONFIGURABLE_SHORTCUTS.map(([key, def]) => {
          const effectiveHotkey = getEffectiveHotkey(key, keyboard);
          const capturing = editingKey === key && recorder.isRecording;

          return (
            <div key={key} className="flex items-center justify-between gap-2">
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
                    {isModified(key) ? (
                      <TooltipProvider delay={150}>
                        <Tooltip>
                          <TooltipTrigger>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => handleReset(key)}
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
                      className="min-w-[80px] font-mono"
                      onClick={() => startCapture(key)}
                      disabled={loading || saving}
                    >
                      {formatForDisplay(effectiveHotkey)}
                    </Button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default KeyboardSettingsCard;
