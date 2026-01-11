import { ipcMain, dialog } from 'electron';
import { getAppSettings, updateAppSettings } from '../settings';
import { log } from '../lib/logger';
import type { TerminalColorSettings, TerminalColorScheme } from '@shared/terminal-color-schemes';
import { validateColorScheme, TERMINAL_COLOR_PRESETS } from '@shared/terminal-color-schemes';
import { writeFileSync, readFileSync } from 'fs';

// Get terminal color settings
ipcMain.handle('terminal:getColorSettings', async () => {
  try {
    const settings = getAppSettings();
    return {
      success: true,
      data: settings.terminal || { enabled: false },
    };
  } catch (error) {
    log.error('terminal:getColorSettings failed', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

// Update terminal color settings
ipcMain.handle('terminal:updateColorSettings', async (_, colors: TerminalColorSettings) => {
  try {
    await updateAppSettings({ terminal: colors });
    return { success: true };
  } catch (error) {
    log.error('terminal:updateColorSettings failed', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

// Export color scheme to file
ipcMain.handle('terminal:exportColorScheme', async (event, scheme: TerminalColorScheme) => {
  try {
    const result = await dialog.showSaveDialog({
      title: 'Export Terminal Color Scheme',
      defaultPath: 'terminal-colors.json',
      filters: [
        { name: 'JSON', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (!result.canceled && result.filePath) {
      writeFileSync(result.filePath, JSON.stringify(scheme, null, 2));
      return { success: true, filePath: result.filePath };
    }

    return { success: false, error: 'Export cancelled' };
  } catch (error) {
    log.error('terminal:exportColorScheme failed', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

// Import color scheme from file
ipcMain.handle('terminal:importColorScheme', async (_event) => {
  try {
    const result = await dialog.showOpenDialog({
      title: 'Import Terminal Color Scheme',
      filters: [
        { name: 'JSON', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const content = readFileSync(result.filePaths[0], 'utf8');
      const scheme = JSON.parse(content) as Partial<TerminalColorScheme>;

      if (validateColorScheme(scheme)) {
        return { success: true, data: scheme };
      } else {
        return { success: false, error: 'Invalid color scheme format' };
      }
    }

    return { success: false, error: 'Import cancelled' };
  } catch (error) {
    log.error('terminal:importColorScheme failed', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

// Get available presets
ipcMain.handle('terminal:getColorPresets', async () => {
  try {
    return {
      success: true,
      data: Object.keys(TERMINAL_COLOR_PRESETS),
    };
  } catch (error) {
    log.error('terminal:getColorPresets failed', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

// Get a specific preset
ipcMain.handle('terminal:getPreset', async (_, presetName: string) => {
  try {
    const preset = TERMINAL_COLOR_PRESETS[presetName];
    if (preset) {
      return { success: true, data: preset };
    }
    return { success: false, error: 'Preset not found' };
  } catch (error) {
    log.error('terminal:getPreset failed', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});
