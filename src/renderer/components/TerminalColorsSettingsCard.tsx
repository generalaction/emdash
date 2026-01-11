import React, { useEffect, useState, useCallback } from 'react';
import { Button } from './ui/button';
import { Switch } from './ui/switch';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { TerminalPreview } from './TerminalPreview';
import { Separator } from './ui/separator';
import { Upload, Download, RotateCcw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { TerminalColorScheme, TerminalColorSettings } from '@shared/terminal-color-schemes';
import {
  TERMINAL_COLOR_PRESETS,
  getDefaultColorScheme,
  validateColorScheme,
} from '@shared/terminal-color-schemes';

function TerminalColorsSettingsCard() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<TerminalColorSettings>({ enabled: false });
  const [currentScheme, setCurrentScheme] = useState<TerminalColorScheme>(
    getDefaultColorScheme('dark')
  );
  const presetNames = Object.keys(TERMINAL_COLOR_PRESETS);
  const [loading, setLoading] = useState(true);

  // Load settings on mount
  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const result = await window.electronAPI.terminalGetColorSettings();
      if (result.success && result.data) {
        setSettings(result.data);

        // Load the active scheme
        if (result.data.enabled) {
          if (result.data.activePreset && TERMINAL_COLOR_PRESETS[result.data.activePreset]) {
            setCurrentScheme(TERMINAL_COLOR_PRESETS[result.data.activePreset]);
          } else if (result.data.customColors && validateColorScheme(result.data.customColors)) {
            setCurrentScheme(result.data.customColors);
          }
        }
      }
    } catch (error) {
      console.error('Failed to load terminal color settings:', error);
      toast({
        title: 'Error',
        description: 'Failed to load terminal color settings',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = async (enabled: boolean) => {
    const newSettings = { ...settings, enabled };
    setSettings(newSettings);
    await saveSettings(newSettings);
  };

  const handlePresetChange = async (presetName: string) => {
    if (presetName === 'custom') {
      // Switch to custom mode
      const newSettings = {
        ...settings,
        activePreset: undefined,
        customColors: currentScheme,
      };
      setSettings(newSettings);
      await saveSettings(newSettings);
    } else if (TERMINAL_COLOR_PRESETS[presetName]) {
      // Load preset
      const preset = TERMINAL_COLOR_PRESETS[presetName];
      setCurrentScheme(preset);
      const newSettings = {
        ...settings,
        activePreset: presetName,
        customColors: undefined,
      };
      setSettings(newSettings);
      await saveSettings(newSettings);
    }
  };

  const handleColorChange = useCallback(
    (colorKey: keyof TerminalColorScheme, value: string) => {
      const newScheme = { ...currentScheme, [colorKey]: value };
      setCurrentScheme(newScheme);

      // If we're in custom mode, update the settings
      if (!settings.activePreset) {
        const newSettings = {
          ...settings,
          customColors: newScheme,
        };
        setSettings(newSettings);
        // Debounce the save
        debouncedSave(newSettings);
      }
    },
    [currentScheme, settings]
  );

  const debouncedSave = useCallback(
    debounce((newSettings: TerminalColorSettings) => {
      saveSettings(newSettings);
    }, 500),
    []
  );

  const saveSettings = async (newSettings: TerminalColorSettings) => {
    try {
      const result = await window.electronAPI.terminalUpdateColorSettings(newSettings);
      if (!result.success) {
        throw new Error(result.error || 'Failed to save settings');
      }
    } catch (error) {
      console.error('Failed to save terminal color settings:', error);
      toast({
        title: 'Error',
        description: 'Failed to save terminal color settings',
        variant: 'destructive',
      });
    }
  };

  const handleImport = async () => {
    try {
      const result = await window.electronAPI.terminalImportColorScheme();
      if (result.success && result.data) {
        setCurrentScheme(result.data);
        const newSettings = {
          ...settings,
          activePreset: undefined,
          customColors: result.data,
        };
        setSettings(newSettings);
        await saveSettings(newSettings);
        toast({
          title: 'Success',
          description: 'Color scheme imported successfully',
        });
      }
    } catch (error) {
      console.error('Failed to import color scheme:', error);
      toast({
        title: 'Error',
        description: 'Failed to import color scheme',
        variant: 'destructive',
      });
    }
  };

  const handleExport = async () => {
    try {
      const result = await window.electronAPI.terminalExportColorScheme(currentScheme);
      if (result.success) {
        toast({
          title: 'Success',
          description: `Color scheme exported to ${result.filePath}`,
        });
      }
    } catch (error) {
      console.error('Failed to export color scheme:', error);
      toast({
        title: 'Error',
        description: 'Failed to export color scheme',
        variant: 'destructive',
      });
    }
  };

  const handleReset = async () => {
    const defaultScheme = getDefaultColorScheme('dark');
    setCurrentScheme(defaultScheme);
    const newSettings = {
      enabled: false,
      activePreset: undefined,
      customColors: undefined,
    };
    setSettings(newSettings);
    await saveSettings(newSettings);
    toast({
      title: 'Success',
      description: 'Terminal colors reset to defaults',
    });
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading...</div>;
  }

  const isCustomMode = !settings.activePreset;

  return (
    <div className="space-y-4">
      {/* Simple Enable/Disable Toggle */}
      <div className="flex items-center justify-between">
        <div>
          <Label htmlFor="terminal-colors-enabled" className="text-sm">
            Custom Terminal Colors
          </Label>
          <p className="mt-1 text-xs text-muted-foreground">
            Enable custom color schemes for terminal output
          </p>
        </div>
        <Switch
          id="terminal-colors-enabled"
          checked={settings.enabled}
          onCheckedChange={handleToggle}
        />
      </div>

      {/* Only show options when enabled */}
      {settings.enabled && (
        <>
          {/* Preset Selection */}
          <div className="space-y-2">
            <Label htmlFor="color-preset" className="text-sm">
              Color Scheme
            </Label>
            <div className="flex gap-2">
              <Select value={settings.activePreset || 'custom'} onValueChange={handlePresetChange}>
                <SelectTrigger id="color-preset" className="flex-1">
                  <SelectValue placeholder="Select a color scheme" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="custom">Custom</SelectItem>
                  <Separator className="my-1" />
                  {presetNames.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleImport}
                title="Import color scheme"
              >
                <Upload className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleExport}
                title="Export color scheme"
              >
                <Download className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleReset}
                title="Reset to defaults"
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Terminal Preview */}
          <div className="space-y-2">
            <Label className="text-sm">Preview</Label>
            <div className="rounded border bg-muted/20 p-2">
              <TerminalPreview colorScheme={currentScheme} className="h-32" />
            </div>
          </div>

          {/* Custom Color Editor - Only show for custom mode */}
          {isCustomMode && (
            <div className="space-y-3 border-t pt-3">
              <Label className="text-sm font-medium">Custom Colors</Label>

              {/* Basic Colors */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="mb-2 block text-xs text-muted-foreground">
                    Background & Text
                  </Label>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={currentScheme.background}
                        onChange={(e) => handleColorChange('background', e.target.value)}
                        className="h-8 w-8 cursor-pointer rounded border"
                      />
                      <Label className="flex-1 text-xs">Background</Label>
                      <input
                        type="text"
                        value={currentScheme.background}
                        onChange={(e) => handleColorChange('background', e.target.value)}
                        className="w-20 rounded border px-2 py-1 font-mono text-xs"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={currentScheme.foreground}
                        onChange={(e) => handleColorChange('foreground', e.target.value)}
                        className="h-8 w-8 cursor-pointer rounded border"
                      />
                      <Label className="flex-1 text-xs">Foreground</Label>
                      <input
                        type="text"
                        value={currentScheme.foreground}
                        onChange={(e) => handleColorChange('foreground', e.target.value)}
                        className="w-20 rounded border px-2 py-1 font-mono text-xs"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <Label className="mb-2 block text-xs text-muted-foreground">
                    Cursor & Selection
                  </Label>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={currentScheme.cursor}
                        onChange={(e) => handleColorChange('cursor', e.target.value)}
                        className="h-8 w-8 cursor-pointer rounded border"
                      />
                      <Label className="flex-1 text-xs">Cursor</Label>
                      <input
                        type="text"
                        value={currentScheme.cursor}
                        onChange={(e) => handleColorChange('cursor', e.target.value)}
                        className="w-20 rounded border px-2 py-1 font-mono text-xs"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={currentScheme.selectionBackground}
                        onChange={(e) => handleColorChange('selectionBackground', e.target.value)}
                        className="h-8 w-8 cursor-pointer rounded border"
                      />
                      <Label className="flex-1 text-xs">Selection</Label>
                      <input
                        type="text"
                        value={currentScheme.selectionBackground}
                        onChange={(e) => handleColorChange('selectionBackground', e.target.value)}
                        className="w-20 rounded border px-2 py-1 font-mono text-xs"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* ANSI Colors - Simplified grid */}
              <div>
                <Label className="mb-2 block text-xs text-muted-foreground">
                  ANSI Colors (Normal / Bright)
                </Label>
                <div className="grid grid-cols-4 gap-2">
                  {['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'].map(
                    (color) => {
                      const colorKey = color as keyof TerminalColorScheme;
                      const brightColorKey =
                        `bright${color.charAt(0).toUpperCase()}${color.slice(1)}` as keyof TerminalColorScheme;

                      return (
                        <div key={color} className="space-y-1">
                          <Label className="text-[10px] capitalize text-muted-foreground">
                            {color}
                          </Label>
                          <div className="flex gap-1">
                            <input
                              type="color"
                              value={currentScheme[colorKey] as string}
                              onChange={(e) => handleColorChange(colorKey, e.target.value)}
                              className="h-6 w-6 cursor-pointer rounded border"
                              title={`Normal ${color}`}
                            />
                            <input
                              type="color"
                              value={currentScheme[brightColorKey] as string}
                              onChange={(e) => handleColorChange(brightColorKey, e.target.value)}
                              className="h-6 w-6 cursor-pointer rounded border"
                              title={`Bright ${color}`}
                            />
                          </div>
                        </div>
                      );
                    }
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Simple debounce implementation
function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

export default TerminalColorsSettingsCard;
