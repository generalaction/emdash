import { formatForDisplay, useHotkeyRecorder, type Hotkey } from '@tanstack/react-hotkeys';
import React, { useState } from 'react';
import { useAppSettingsKey } from '@renderer/core/app/AppSettingsProvider';
import { toast } from '../../hooks/use-toast';
import {
  APP_SHORTCUTS,
  getEffectiveHotkey,
  type ShortcutSettingsKey,
} from '../../hooks/useKeyboardShortcuts';
import { Button } from '../ui/button';
import { ResetToDefaultButton } from './ResetToDefaultButton';

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
    isFieldOverridden,
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
                    {isFieldOverridden(key) && (
                      <ResetToDefaultButton
                        onReset={() => handleReset(key)}
                        disabled={loading || saving}
                      />
                    )}
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
