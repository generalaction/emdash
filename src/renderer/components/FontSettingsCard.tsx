import React, { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { RotateCcw, Type } from 'lucide-react';

interface FontSettings {
  terminal: {
    fontFamily: string;
    fontSize: number;
  };
  editor: {
    fontFamily: string;
    fontSize: number;
  };
}

const DEFAULT_FONTS: FontSettings = {
  terminal: {
    fontFamily: 'monospace',
    fontSize: 13,
  },
  editor: {
    fontFamily: 'monospace',
    fontSize: 13,
  },
};

// Popular monospace fonts
const MONOSPACE_FONTS = [
  { label: 'System Default', value: 'monospace' },
  { label: 'Menlo', value: 'Menlo, monospace' },
  { label: 'Monaco', value: 'Monaco, monospace' },
  { label: 'Consolas', value: 'Consolas, monospace' },
  { label: 'Courier New', value: '"Courier New", monospace' },
  { label: 'Recursive Mono', value: '"Recursive Mono Linear Static", monospace' },
  { label: 'JetBrains Mono', value: '"JetBrains Mono", monospace' },
  { label: 'Fira Code', value: '"Fira Code", monospace' },
  { label: 'Source Code Pro', value: '"Source Code Pro", monospace' },
  { label: 'Cascadia Code', value: '"Cascadia Code", monospace' },
];

// Variable-width fonts for editor
const VARIABLE_WIDTH_FONTS = [
  { label: 'SF Pro', value: '"SF Pro", -apple-system, BlinkMacSystemFont, sans-serif' },
  { label: 'System Sans', value: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' },
  { label: 'Inter', value: 'Inter, sans-serif' },
  { label: 'Helvetica', value: 'Helvetica, Arial, sans-serif' },
];

const FONT_SIZES = [10, 11, 12, 13, 14, 15, 16, 18, 20];

const FontSettingsCard: React.FC = () => {
  const [fonts, setFonts] = useState<FontSettings>(() => {
    try {
      const stored = localStorage.getItem('emdash-fonts');
      if (stored) {
        return { ...DEFAULT_FONTS, ...JSON.parse(stored) };
      }
    } catch {
      // Ignore localStorage errors
    }
    return DEFAULT_FONTS;
  });

  const [nativeTheme, setNativeTheme] = useState<any>(null);
  const [useVariableWidth, setUseVariableWidth] = useState(false);

  // Load native terminal theme (which includes font settings from Ghostty etc.)
  useEffect(() => {
    const loadNativeTheme = async () => {
      if (window.electronAPI?.terminalGetTheme) {
        try {
          const theme = await window.electronAPI.terminalGetTheme();
          setNativeTheme(theme);
        } catch (error) {
          console.error('Failed to load native terminal theme:', error);
        }
      }
    };
    void loadNativeTheme();
  }, []);

  const saveFonts = (newFonts: FontSettings) => {
    setFonts(newFonts);
    try {
      localStorage.setItem('emdash-fonts', JSON.stringify(newFonts));
      // Emit custom event for components to update
      window.dispatchEvent(new CustomEvent('font-settings-changed', { detail: newFonts }));
    } catch {
      // Ignore localStorage errors
    }
  };

  const handleTerminalFontChange = (fontFamily: string) => {
    saveFonts({
      ...fonts,
      terminal: { ...fonts.terminal, fontFamily },
    });
  };

  const handleTerminalSizeChange = (fontSize: number) => {
    saveFonts({
      ...fonts,
      terminal: { ...fonts.terminal, fontSize },
    });
  };

  const handleEditorFontChange = (fontFamily: string) => {
    saveFonts({
      ...fonts,
      editor: { ...fonts.editor, fontFamily },
    });
  };

  const handleEditorSizeChange = (fontSize: number) => {
    saveFonts({
      ...fonts,
      editor: { ...fonts.editor, fontSize },
    });
  };

  const handleUseNativeTheme = () => {
    if (nativeTheme?.theme) {
      const newFonts: FontSettings = { ...fonts };

      // Apply native terminal fonts to terminal settings
      if (nativeTheme.theme.fontFamily) {
        newFonts.terminal.fontFamily = nativeTheme.theme.fontFamily;
      }
      if (nativeTheme.theme.fontSize) {
        newFonts.terminal.fontSize = nativeTheme.theme.fontSize;
      }

      saveFonts(newFonts);

      // Show which terminal was detected
      const terminalName = nativeTheme.terminal || 'native terminal';
      void import('../lib/telemetryClient').then(({ captureTelemetry }) => {
        captureTelemetry('font_native_applied', { terminal: terminalName });
      });
    }
  };

  const handleReset = () => {
    saveFonts(DEFAULT_FONTS);
    setUseVariableWidth(false);
    void import('../lib/telemetryClient').then(({ captureTelemetry }) => {
      captureTelemetry('font_reset');
    });
  };

  const editorFontOptions = useVariableWidth
    ? [...VARIABLE_WIDTH_FONTS, ...MONOSPACE_FONTS]
    : MONOSPACE_FONTS;

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-foreground">Terminal Font</div>
            <div className="text-xs text-muted-foreground">
              Font for agent terminals and command output
            </div>
          </div>
          {nativeTheme?.theme?.fontFamily && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleUseNativeTheme}
              className="text-xs"
            >
              <Type className="mr-1 h-3 w-3" />
              Use {nativeTheme.terminal || 'native'}
            </Button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Font Family</label>
            <select
              value={fonts.terminal.fontFamily}
              onChange={(e) => handleTerminalFontChange(e.target.value)}
              className="w-full rounded-md border border-border/60 bg-background px-2.5 py-1.5 text-xs focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {MONOSPACE_FONTS.map((font) => (
                <option key={font.value} value={font.value}>
                  {font.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Font Size</label>
            <select
              value={fonts.terminal.fontSize}
              onChange={(e) => handleTerminalSizeChange(Number(e.target.value))}
              className="w-full rounded-md border border-border/60 bg-background px-2.5 py-1.5 text-xs focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {FONT_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}px
                </option>
              ))}
            </select>
          </div>
        </div>

        <div
          className="rounded-md border border-border/60 bg-black px-3 py-2 text-white"
          style={{
            fontFamily: fonts.terminal.fontFamily,
            fontSize: `${fonts.terminal.fontSize}px`,
          }}
        >
          <div className="opacity-60">$ npm run dev</div>
          <div className="text-green-400">&gt; emdash@0.2.9 dev</div>
          <div className="text-green-400">&gt; npm-run-all -p dev:*</div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-foreground">Editor Font</div>
            <div className="text-xs text-muted-foreground">
              Font for code viewing and editing
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={useVariableWidth}
              onChange={(e) => {
                setUseVariableWidth(e.target.checked);
                if (!e.target.checked && !MONOSPACE_FONTS.find(f => f.value === fonts.editor.fontFamily)) {
                  // Reset to monospace if current font is variable-width
                  handleEditorFontChange('monospace');
                }
              }}
              className="h-3 w-3 rounded border-border/60"
            />
            <span className="text-muted-foreground">Variable-width fonts</span>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Font Family</label>
            <select
              value={fonts.editor.fontFamily}
              onChange={(e) => handleEditorFontChange(e.target.value)}
              className="w-full rounded-md border border-border/60 bg-background px-2.5 py-1.5 text-xs focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {editorFontOptions.map((font) => (
                <option key={font.value} value={font.value}>
                  {font.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Font Size</label>
            <select
              value={fonts.editor.fontSize}
              onChange={(e) => handleEditorSizeChange(Number(e.target.value))}
              className="w-full rounded-md border border-border/60 bg-background px-2.5 py-1.5 text-xs focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {FONT_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}px
                </option>
              ))}
            </select>
          </div>
        </div>


        <div
          className="rounded-md border border-border/60 bg-muted/20 px-3 py-2"
          style={{
            fontFamily: fonts.editor.fontFamily,
            fontSize: `${fonts.editor.fontSize}px`,
          }}
        >
          <div className="text-blue-500">function</div>
          <div>
            <span className="text-purple-500">const</span> greeting = <span className="text-green-600">"Hello, World!"</span>;
          </div>
          <div className="text-gray-500">// This is how your code will look</div>
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleReset}
          className="text-xs"
        >
          <RotateCcw className="mr-1 h-3 w-3" />
          Reset to defaults
        </Button>
      </div>
    </div>
  );
};

export default FontSettingsCard;