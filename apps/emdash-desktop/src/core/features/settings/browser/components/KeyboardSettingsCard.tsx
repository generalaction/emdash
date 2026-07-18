import { RotateCcw, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React, { useState } from 'react';
import { useAppSettingsKey } from '@core/features/settings/browser/use-app-settings-key';
import { COMMAND_CATALOG } from '@core/manifests/command-catalog';
import { SCOPE_CATALOG } from '@core/manifests/scope-catalog';
import {
  CODE_TO_US_CHAR,
  detectPlatformContext,
  findConflicts,
  keybinding,
  type Chord,
  type KeybindingEntry,
} from '@core/primitives/keybindings/api';
import { toast } from '@renderer/lib/hooks/use-toast';
import {
  keyboardLayoutService,
  keybindingService,
  useChordRecorder,
} from '@renderer/lib/keybindings';
import { Button } from '@renderer/lib/ui/button';
import { Shortcut } from '@renderer/lib/ui/shortcut';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';

const groupsByCommandId = new Map<string, string[]>();
for (const scope of SCOPE_CATALOG) {
  for (const command of scope.commands) {
    const groups = groupsByCommandId.get(command.id) ?? [];
    groups.push(scope.id);
    groupsByCommandId.set(command.id, groups);
  }
}

const CONFLICT_ENTRIES: readonly KeybindingEntry[] = COMMAND_CATALOG.defs.flatMap((command) =>
  command.keybinding
    ? [
        {
          id: command.id,
          groups: groupsByCommandId.get(command.id),
          binding: command.keybinding,
        },
      ]
    : []
);

const SYSTEM_HIDE_ENTRY: KeybindingEntry = {
  id: 'system.hide',
  groups: [],
  binding: keybinding.fixed('Mod+H'),
};

const KeyboardSettingsCard: React.FC = observer(function KeyboardSettingsCard() {
  const {
    value: keyboard,
    update,
    isLoading: loading,
    isSaving: saving,
    resetField,
  } = useAppSettingsKey('keyboard');
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const groups = keybindingService.settingsEntries();
  const platform = detectPlatformContext();

  const recorder = useChordRecorder({
    onRecord: (candidate: Chord) => {
      const editingEntry = groups
        .flatMap((group) => group.entries)
        .find((entry) => entry.binding.settingsKey === editingKey);
      if (!editingEntry || !editingKey) return;

      const conflicts = findConflicts(
        platform.os === 'mac' ? [...CONFLICT_ENTRIES, SYSTEM_HIDE_ENTRY] : CONFLICT_ENTRIES,
        candidate,
        editingEntry.command.id,
        keyboard ?? {},
        platform,
        keyboardLayoutService.codeToCharMap() ?? CODE_TO_US_CHAR
      );
      const rejected = conflicts.find(
        (conflict) => conflict.severity === 'reserved' || conflict.severity === 'error'
      );
      if (rejected) {
        const conflictingTitle =
          COMMAND_CATALOG.byId(rejected.id)?.title ??
          (rejected.id === SYSTEM_HIDE_ENTRY.id ? 'Hide Emdash' : rejected.id);
        toast({
          title: rejected.severity === 'reserved' ? 'Shortcut is reserved' : 'Shortcut conflict',
          description: `Conflicts with "${conflictingTitle}". Choose a different shortcut.`,
          variant: 'destructive',
        });
        setEditingKey(null);
        return;
      }

      update({ [editingKey]: candidate });
      const shadowing = conflicts.find((conflict) => conflict.severity === 'shadowing');
      const label = keyboardLayoutService.displayLabel(candidate, platform).join(' + ');
      toast({
        title: 'Shortcut updated',
        description: shadowing
          ? `${editingEntry.command.title} is now ${label}. It shadows ${
              COMMAND_CATALOG.byId(shadowing.id)?.title ?? shadowing.id
            } in some contexts.`
          : `${editingEntry.command.title} is now ${label}.`,
      });
      setEditingKey(null);
    },
    onCancel: () => setEditingKey(null),
  });

  const startCapture = (settingsKey: string) => {
    setEditingKey(settingsKey);
    recorder.startRecording();
  };

  return (
    <div className="bg-muted/10 rounded-xl border border-border/60 p-4">
      <div className="space-y-6">
        {groups.map((group) => (
          <div key={group.category}>
            <div className="text-muted-foreground mb-3 text-xs font-medium tracking-wide uppercase">
              {group.category}
            </div>
            <div className="space-y-3">
              {group.entries.map((entry) => {
                const key = entry.binding.settingsKey;
                const capturing = editingKey === key && recorder.isRecording;
                const cleared = keyboard?.[key] === null;
                const showReset = keyboard?.[key] !== undefined;
                const showClear = !cleared;
                return (
                  <div
                    key={entry.command.id}
                    className="group/shortcut flex min-w-0 flex-wrap items-start justify-between gap-x-2 gap-y-2"
                  >
                    <div className="min-w-0 flex-1 basis-64 space-y-1">
                      <div className="text-sm wrap-break-word">{entry.command.title}</div>
                      <div className="text-muted-foreground text-xs wrap-break-word">
                        {entry.command.description}
                      </div>
                    </div>
                    <div className="ml-auto flex shrink-0 items-center gap-2">
                      {capturing ? (
                        <>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="min-w-[80px] animate-pulse"
                            onClick={recorder.cancelRecording}
                            disabled={saving}
                          >
                            Press keys...
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={recorder.cancelRecording}
                            disabled={saving}
                          >
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <>
                          {(showClear || showReset) && (
                            <div className="pointer-events-none flex items-center gap-1 opacity-0 transition-opacity group-hover/shortcut:pointer-events-auto group-hover/shortcut:opacity-100">
                              <TooltipProvider delay={150}>
                                {showReset && (
                                  <Tooltip>
                                    <TooltipTrigger>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="text-muted-foreground hover:text-foreground"
                                        onClick={() => {
                                          resetField(key);
                                          toast({
                                            title: 'Shortcut reset',
                                            description: `${entry.command.title} reset to default.`,
                                          });
                                        }}
                                        disabled={loading || saving}
                                        aria-label="Reset to default"
                                      >
                                        <RotateCcw className="h-3.5 w-3.5" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top">Reset to default</TooltipContent>
                                  </Tooltip>
                                )}
                                {showClear && (
                                  <Tooltip>
                                    <TooltipTrigger>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="text-muted-foreground hover:text-foreground"
                                        onClick={() => {
                                          update({ [key]: null });
                                          toast({
                                            title: 'Shortcut removed',
                                            description: `${entry.command.title} no longer has a key binding.`,
                                          });
                                        }}
                                        disabled={loading || saving}
                                        aria-label="Remove shortcut"
                                      >
                                        <X className="h-3.5 w-3.5" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top">Remove shortcut</TooltipContent>
                                  </Tooltip>
                                )}
                              </TooltipProvider>
                            </div>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="min-w-[80px] justify-end px-0 hover:bg-transparent dark:hover:bg-transparent"
                            onClick={() => startCapture(key)}
                            disabled={loading || saving}
                          >
                            <Shortcut hotkey={entry.chord} variant="keycaps" />
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
});

export default KeyboardSettingsCard;
