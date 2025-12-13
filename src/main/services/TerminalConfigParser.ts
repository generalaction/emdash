import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';
import { log } from '../lib/logger';

export interface TerminalTheme {
  background?: string;
  foreground?: string;
  cursor?: string;
  cursorAccent?: string;
  selectionBackground?: string;
  black?: string;
  red?: string;
  green?: string;
  yellow?: string;
  blue?: string;
  magenta?: string;
  cyan?: string;
  white?: string;
  brightBlack?: string;
  brightRed?: string;
  brightGreen?: string;
  brightYellow?: string;
  brightBlue?: string;
  brightMagenta?: string;
  brightCyan?: string;
  brightWhite?: string;
  fontFamily?: string;
  fontSize?: number;
}

export interface TerminalConfig {
  terminal: string;
  theme: TerminalTheme;
}

/**
 * Detect the user's preferred terminal emulator and extract its theme configuration.
 * Supports: iTerm2, Terminal.app, Alacritty, Ghostty, Kitty
 */
export function detectAndLoadTerminalConfig(): TerminalConfig | null {
  if (process.platform === 'darwin') {
    return detectMacOSTerminal();
  } else if (process.platform === 'win32') {
    return detectWindowsTerminal();
  } else if (process.platform === 'linux') {
    return detectLinuxTerminal();
  }
  return null;
}

function detectMacOSTerminal(): TerminalConfig | null {
  // Check iTerm2 first (most popular)
  const iterm2Config = loadiTerm2Config();
  if (iterm2Config) {
    log.debug('terminalConfig:detected', { terminal: 'iTerm2' });
    return iterm2Config;
  }

  // Check Terminal.app
  const terminalAppConfig = loadTerminalAppConfig();
  if (terminalAppConfig) {
    log.debug('terminalConfig:detected', { terminal: 'Terminal.app' });
    return terminalAppConfig;
  }

  // Check Alacritty
  const alacrittyConfig = loadAlacrittyConfig();
  if (alacrittyConfig) {
    log.debug('terminalConfig:detected', { terminal: 'Alacritty' });
    return alacrittyConfig;
  }

  // Check Ghostty
  const ghosttyConfig = loadGhosttyConfig();
  if (ghosttyConfig) {
    log.debug('terminalConfig:detected', { terminal: 'Ghostty' });
    return ghosttyConfig;
  }

  // Check Kitty
  const kittyConfig = loadKittyConfig();
  if (kittyConfig) {
    log.debug('terminalConfig:detected', { terminal: 'Kitty' });
    return kittyConfig;
  }

  return null;
}

function detectWindowsTerminal(): TerminalConfig | null {
  // Windows Terminal stores config in JSON at:
  // %LOCALAPPDATA%\Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState\settings.json
  try {
    const localAppData = process.env.LOCALAPPDATA;
    if (!localAppData) return null;

    const settingsPath = join(
      localAppData,
      'Packages',
      'Microsoft.WindowsTerminal_8wekyb3d8bbwe',
      'LocalState',
      'settings.json'
    );

    if (existsSync(settingsPath)) {
      const config = loadWindowsTerminalConfig(settingsPath);
      if (config) {
        log.debug('terminalConfig:detected', { terminal: 'Windows Terminal' });
        return config;
      }
    }
  } catch (error) {
    log.warn('terminalConfig:windowsTerminal:readFailed', { error });
  }

  return null;
}

function detectLinuxTerminal(): TerminalConfig | null {
  // Check common Linux terminals
  const alacrittyConfig = loadAlacrittyConfig();
  if (alacrittyConfig) {
    log.debug('terminalConfig:detected', { terminal: 'Alacritty' });
    return alacrittyConfig;
  }

  const kittyConfig = loadKittyConfig();
  if (kittyConfig) {
    log.debug('terminalConfig:detected', { terminal: 'Kitty' });
    return kittyConfig;
  }

  const ghosttyConfig = loadGhosttyConfig();
  if (ghosttyConfig) {
    log.debug('terminalConfig:detected', { terminal: 'Ghostty' });
    return ghosttyConfig;
  }

  // GNOME Terminal uses dconf, which is harder to parse
  // We could use dconf read, but it's complex

  return null;
}

/**
 * Load iTerm2 configuration from plist file.
 * iTerm2 stores preferences at: ~/Library/Preferences/com.googlecode.iterm2.plist
 */
function loadiTerm2Config(): TerminalConfig | null {
  try {
    const plistPath = join(homedir(), 'Library', 'Preferences', 'com.googlecode.iterm2.plist');
    if (!existsSync(plistPath)) {
      return null;
    }

    // Use plutil to convert plist to JSON (macOS built-in)
    let jsonContent: string;
    try {
      jsonContent = execSync(`plutil -convert json -o - "${plistPath}"`, {
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024, // 10MB
      });
    } catch {
      // If plutil fails, try reading as XML plist
      return loadiTerm2ConfigXML(plistPath);
    }

    const plist = JSON.parse(jsonContent);

    // iTerm2 stores color schemes in "New Bookmarks" -> "Color Presets"
    // We need to find the default profile's color scheme
    const newBookmarks = plist['New Bookmarks'] || [];
    const defaultProfile = Array.isArray(newBookmarks)
      ? newBookmarks.find((p: any) => p['Default Bookmark'] === 'Yes') || newBookmarks[0]
      : newBookmarks;

    if (!defaultProfile) {
      return null;
    }

    const colorPresetName =
      defaultProfile['Color Preset Name'] || defaultProfile['Custom Color Preset'];
    if (!colorPresetName) {
      return null;
    }

    // Find the color preset
    const customColorPresets = plist['Custom Color Presets'] || {};
    const preset = customColorPresets[colorPresetName] || {};

    // Extract colors
    const theme: TerminalTheme = {};

    // Background and foreground
    if (preset['Background Color']) {
      theme.background = parseiTerm2Color(preset['Background Color']);
    }
    if (preset['Foreground Color']) {
      theme.foreground = parseiTerm2Color(preset['Foreground Color']);
    }
    if (preset['Cursor Color']) {
      theme.cursor = parseiTerm2Color(preset['Cursor Color']);
    }
    if (preset['Selection Color']) {
      theme.selectionBackground = parseiTerm2Color(preset['Selection Color']);
    }

    // ANSI colors
    const ansiColors = [
      'Ansi 0 Color',
      'Ansi 1 Color',
      'Ansi 2 Color',
      'Ansi 3 Color',
      'Ansi 4 Color',
      'Ansi 5 Color',
      'Ansi 6 Color',
      'Ansi 7 Color',
      'Ansi 8 Color',
      'Ansi 9 Color',
      'Ansi 10 Color',
      'Ansi 11 Color',
      'Ansi 12 Color',
      'Ansi 13 Color',
      'Ansi 14 Color',
      'Ansi 15 Color',
    ];

    const colorMap: Record<string, keyof TerminalTheme> = {
      'Ansi 0 Color': 'black',
      'Ansi 1 Color': 'red',
      'Ansi 2 Color': 'green',
      'Ansi 3 Color': 'yellow',
      'Ansi 4 Color': 'blue',
      'Ansi 5 Color': 'magenta',
      'Ansi 6 Color': 'cyan',
      'Ansi 7 Color': 'white',
      'Ansi 8 Color': 'brightBlack',
      'Ansi 9 Color': 'brightRed',
      'Ansi 10 Color': 'brightGreen',
      'Ansi 11 Color': 'brightYellow',
      'Ansi 12 Color': 'brightBlue',
      'Ansi 13 Color': 'brightMagenta',
      'Ansi 14 Color': 'brightCyan',
      'Ansi 15 Color': 'brightWhite',
    };

    for (const ansiKey of ansiColors) {
      if (preset[ansiKey]) {
        const colorKey = colorMap[ansiKey];
        if (colorKey) {
          const parsedColor = parseiTerm2Color(preset[ansiKey]);
          if (parsedColor) {
            (theme as any)[colorKey] = parsedColor;
          }
        }
      }
    }

    // Font
    if (defaultProfile['Normal Font']) {
      const fontMatch = String(defaultProfile['Normal Font']).match(/^(.+?)\s+(\d+)$/);
      if (fontMatch) {
        theme.fontFamily = fontMatch[1];
        theme.fontSize = parseInt(fontMatch[2], 10);
      }
    }

    return {
      terminal: 'iTerm2',
      theme,
    };
  } catch (error) {
    log.warn('terminalConfig:iTerm2:parseFailed', { error });
    return null;
  }
}

/**
 * Fallback: Try to parse iTerm2 plist as XML
 */
function loadiTerm2ConfigXML(plistPath: string): TerminalConfig | null {
  try {
    const _xmlContent = readFileSync(plistPath, 'utf8');
    // Simple XML parsing for color values
    // This is a basic implementation - could be improved
    const _colorRegex =
      /<key>([^<]+)<\/key>\s*<dict>[\s\S]*?<key>Red Component<\/key>\s*<real>([\d.]+)<\/real>[\s\S]*?<key>Green Component<\/key>\s*<real>([\d.]+)<\/real>[\s\S]*?<key>Blue Component<\/key>\s*<real>([\d.]+)<\/real>/g;
    // This is complex - for now, return null and rely on JSON conversion
    return null;
  } catch {
    return null;
  }
}

/**
 * Parse iTerm2 color format (NSColor with Red/Green/Blue/Alpha components)
 */
function parseiTerm2Color(colorObj: any): string | undefined {
  if (typeof colorObj === 'string') {
    // Already a hex string
    return colorObj;
  }

  if (colorObj && typeof colorObj === 'object') {
    // NSColor format: { "Red Component": 0.5, "Green Component": 0.5, "Blue Component": 0.5, "Alpha Component": 1.0 }
    const r = Math.round((colorObj['Red Component'] || 0) * 255);
    const g = Math.round((colorObj['Green Component'] || 0) * 255);
    const b = Math.round((colorObj['Blue Component'] || 0) * 255);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }

  return undefined;
}

/**
 * Load Terminal.app configuration
 */
function loadTerminalAppConfig(): TerminalConfig | null {
  try {
    const plistPath = join(homedir(), 'Library', 'Preferences', 'com.apple.Terminal.plist');
    if (!existsSync(plistPath)) {
      return null;
    }

    let jsonContent: string;
    try {
      jsonContent = execSync(`plutil -convert json -o - "${plistPath}"`, {
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      });
    } catch {
      return null;
    }

    const plist = JSON.parse(jsonContent);
    const windowSettings = plist['Window Settings'] || {};
    const defaultProfile = plist['Default Window Settings'] || 'Basic';

    const profile = windowSettings[defaultProfile];
    if (!profile) {
      return null;
    }

    const theme: TerminalTheme = {};

    if (profile['BackgroundColor']) {
      theme.background = parseiTerm2Color(profile['BackgroundColor']);
    }
    if (profile['TextColor']) {
      theme.foreground = parseiTerm2Color(profile['TextColor']);
    }
    if (profile['CursorColor']) {
      theme.cursor = parseiTerm2Color(profile['CursorColor']);
    }

    // Terminal.app uses similar ANSI color structure
    const colorMap: Record<string, keyof TerminalTheme> = {
      ANSIBlackColor: 'black',
      ANSIRedColor: 'red',
      ANSIGreenColor: 'green',
      ANSIYellowColor: 'yellow',
      ANSIBlueColor: 'blue',
      ANSIMagentaColor: 'magenta',
      ANSICyanColor: 'cyan',
      ANSIWhiteColor: 'white',
      ANSIBrightBlackColor: 'brightBlack',
      ANSIBrightRedColor: 'brightRed',
      ANSIBrightGreenColor: 'brightGreen',
      ANSIBrightYellowColor: 'brightYellow',
      ANSIBrightBlueColor: 'brightBlue',
      ANSIBrightMagentaColor: 'brightMagenta',
      ANSIBrightCyanColor: 'brightCyan',
      ANSIBrightWhiteColor: 'brightWhite',
    };

    for (const [key, themeKey] of Object.entries(colorMap)) {
      if (profile[key]) {
        const parsedColor = parseiTerm2Color(profile[key]);
        if (parsedColor) {
          (theme as any)[themeKey] = parsedColor;
        }
      }
    }

    if (profile['Font']) {
      const fontMatch = String(profile['Font']).match(/^(.+?)\s+(\d+)$/);
      if (fontMatch) {
        theme.fontFamily = fontMatch[1];
        theme.fontSize = parseInt(fontMatch[2], 10);
      }
    }

    return {
      terminal: 'Terminal.app',
      theme,
    };
  } catch (error) {
    log.warn('terminalConfig:TerminalApp:parseFailed', { error });
    return null;
  }
}

/**
 * Load Alacritty configuration (TOML format)
 */
function loadAlacrittyConfig(): TerminalConfig | null {
  try {
    const configPath = join(homedir(), '.config', 'alacritty', 'alacritty.toml');
    if (!existsSync(configPath)) {
      // Try YAML format (older versions)
      const yamlPath = join(homedir(), '.config', 'alacritty', 'alacritty.yml');
      if (existsSync(yamlPath)) {
        return loadAlacrittyYAML(yamlPath);
      }
      return null;
    }

    const content = readFileSync(configPath, 'utf8');
    return parseAlacrittyTOML(content);
  } catch (error) {
    log.warn('terminalConfig:Alacritty:parseFailed', { error });
    return null;
  }
}

/**
 * Parse Alacritty TOML config (simplified parser)
 */
function parseAlacrittyTOML(content: string): TerminalConfig | null {
  const theme: TerminalTheme = {};

  // Simple TOML parsing - extract colors section
  const colorsMatch = content.match(/\[colors\]\s*([\s\S]*?)(?=\[|$)/);
  if (!colorsMatch) {
    return null;
  }

  const colorsSection = colorsMatch[1];

  // Parse background/foreground
  const bgMatch = colorsSection.match(/background\s*=\s*['"]([^'"]+)['"]/);
  if (bgMatch) {
    theme.background = bgMatch[1];
  }

  const fgMatch = colorsSection.match(/foreground\s*=\s*['"]([^'"]+)['"]/);
  if (fgMatch) {
    theme.foreground = fgMatch[1];
  }

  // Parse cursor
  const cursorMatch = colorsSection.match(/cursor\s*=\s*['"]([^'"]+)['"]/);
  if (cursorMatch) {
    theme.cursor = cursorMatch[1];
  }

  const colorMap: Record<string, keyof TerminalTheme> = {
    black: 'black',
    red: 'red',
    green: 'green',
    yellow: 'yellow',
    blue: 'blue',
    magenta: 'magenta',
    cyan: 'cyan',
    white: 'white',
    bright_black: 'brightBlack',
    bright_red: 'brightRed',
    bright_green: 'brightGreen',
    bright_yellow: 'brightYellow',
    bright_blue: 'brightBlue',
    bright_magenta: 'brightMagenta',
    bright_cyan: 'brightCyan',
    bright_white: 'brightWhite',
  };

  for (const [alacrittyKey, themeKey] of Object.entries(colorMap)) {
    const regex = new RegExp(`${alacrittyKey.replace('_', '[-_]')}\\s*=\\s*['"]([^'"]+)['"]`, 'i');
    const match = colorsSection.match(regex);
    if (match && match[1]) {
      (theme as any)[themeKey] = match[1];
    }
  }

  // Parse font
  const fontMatch = content.match(/\[font\]\s*([\s\S]*?)(?=\[|$)/);
  if (fontMatch) {
    const fontSection = fontMatch[1];
    const familyMatch = fontSection.match(/normal\s*=\s*\{[\s\S]*?family\s*=\s*['"]([^'"]+)['"]/);
    const sizeMatch = fontSection.match(/size\s*=\s*(\d+)/);
    if (familyMatch) {
      theme.fontFamily = familyMatch[1];
    }
    if (sizeMatch) {
      theme.fontSize = parseInt(sizeMatch[1], 10);
    }
  }

  return {
    terminal: 'Alacritty',
    theme,
  };
}

/**
 * Parse Alacritty YAML config (simplified)
 */
function loadAlacrittyYAML(yamlPath: string): TerminalConfig | null {
  try {
    const content = readFileSync(yamlPath, 'utf8');
    // Very basic YAML parsing for colors
    // For production, consider using a YAML parser library
    const theme: TerminalTheme = {};

    // Extract basic colors (simplified regex-based parsing)
    const bgMatch = content.match(/background:\s*['"]?([^'"]+)['"]?/);
    if (bgMatch) {
      theme.background = bgMatch[1];
    }

    const fgMatch = content.match(/foreground:\s*['"]?([^'"]+)['"]?/);
    if (fgMatch) {
      theme.foreground = fgMatch[1];
    }

    return {
      terminal: 'Alacritty',
      theme,
    };
  } catch {
    return null;
  }
}

/**
 * Load Ghostty configuration
 */
function loadGhosttyConfig(): TerminalConfig | null {
  try {
    const configPath = join(homedir(), '.config', 'ghostty', 'config');
    if (!existsSync(configPath)) {
      return null;
    }

    const content = readFileSync(configPath, 'utf8');
    return parseGhosttyConfig(content);
  } catch (error) {
    log.warn('terminalConfig:Ghostty:parseFailed', { error });
    return null;
  }
}

/**
 * Parse Ghostty config (key = value format)
 */
function parseGhosttyConfig(content: string): TerminalConfig | null {
  const theme: TerminalTheme = {};

  // Ghostty uses simple key = value format
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || !trimmed.includes('=')) {
      continue;
    }

    const [key, ...valueParts] = trimmed.split('=');
    const value = valueParts
      .join('=')
      .trim()
      .replace(/^["']|["']$/g, '');

    switch (key.trim()) {
      case 'background':
        theme.background = value;
        break;
      case 'foreground':
        theme.foreground = value;
        break;
      case 'cursor':
        theme.cursor = value;
        break;
      case 'color0':
        theme.black = value;
        break;
      case 'color1':
        theme.red = value;
        break;
      case 'color2':
        theme.green = value;
        break;
      case 'color3':
        theme.yellow = value;
        break;
      case 'color4':
        theme.blue = value;
        break;
      case 'color5':
        theme.magenta = value;
        break;
      case 'color6':
        theme.cyan = value;
        break;
      case 'color7':
        theme.white = value;
        break;
      case 'color8':
        theme.brightBlack = value;
        break;
      case 'color9':
        theme.brightRed = value;
        break;
      case 'color10':
        theme.brightGreen = value;
        break;
      case 'color11':
        theme.brightYellow = value;
        break;
      case 'color12':
        theme.brightBlue = value;
        break;
      case 'color13':
        theme.brightMagenta = value;
        break;
      case 'color14':
        theme.brightCyan = value;
        break;
      case 'color15':
        theme.brightWhite = value;
        break;
      case 'font':
        theme.fontFamily = value;
        break;
      case 'font-size':
        theme.fontSize = parseInt(value, 10);
        break;
    }
  }

  return {
    terminal: 'Ghostty',
    theme,
  };
}

/**
 * Load Kitty configuration
 */
function loadKittyConfig(): TerminalConfig | null {
  try {
    const configPath = join(homedir(), '.config', 'kitty', 'kitty.conf');
    if (!existsSync(configPath)) {
      return null;
    }

    const content = readFileSync(configPath, 'utf8');
    return parseKittyConfig(content);
  } catch (error) {
    log.warn('terminalConfig:Kitty:parseFailed', { error });
    return null;
  }
}

/**
 * Parse Kitty config (similar to Ghostty format)
 */
function parseKittyConfig(content: string): TerminalConfig | null {
  const theme: TerminalTheme = {};

  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || !trimmed.includes(' ')) {
      continue;
    }

    const [key, ...valueParts] = trimmed.split(/\s+/);
    const value = valueParts.join(' ').trim();

    switch (key) {
      case 'background':
        theme.background = value;
        break;
      case 'foreground':
        theme.foreground = value;
        break;
      case 'cursor':
        theme.cursor = value;
        break;
      case 'color0':
        theme.black = value;
        break;
      case 'color1':
        theme.red = value;
        break;
      case 'color2':
        theme.green = value;
        break;
      case 'color3':
        theme.yellow = value;
        break;
      case 'color4':
        theme.blue = value;
        break;
      case 'color5':
        theme.magenta = value;
        break;
      case 'color6':
        theme.cyan = value;
        break;
      case 'color7':
        theme.white = value;
        break;
      case 'color8':
        theme.brightBlack = value;
        break;
      case 'color9':
        theme.brightRed = value;
        break;
      case 'color10':
        theme.brightGreen = value;
        break;
      case 'color11':
        theme.brightYellow = value;
        break;
      case 'color12':
        theme.brightBlue = value;
        break;
      case 'color13':
        theme.brightMagenta = value;
        break;
      case 'color14':
        theme.brightCyan = value;
        break;
      case 'color15':
        theme.brightWhite = value;
        break;
      case 'font_family':
        theme.fontFamily = value;
        break;
      case 'font_size':
        theme.fontSize = parseInt(value, 10);
        break;
    }
  }

  return {
    terminal: 'Kitty',
    theme,
  };
}

/**
 * Load Windows Terminal configuration
 */
function loadWindowsTerminalConfig(settingsPath: string): TerminalConfig | null {
  try {
    const content = readFileSync(settingsPath, 'utf8');
    const config = JSON.parse(content);

    // Windows Terminal stores profiles in "profiles.list"
    const profiles = config.profiles?.list || [];
    const defaultProfile = profiles.find((p: any) => p.default === true) || profiles[0];

    if (!defaultProfile) {
      return null;
    }

    const theme: TerminalTheme = {};

    // Windows Terminal uses color schemes
    const colorSchemeName = defaultProfile.colorScheme;
    if (colorSchemeName && config.schemes) {
      const scheme = config.schemes.find((s: any) => s.name === colorSchemeName);
      if (scheme) {
        theme.background = scheme.background;
        theme.foreground = scheme.foreground;
        theme.black = scheme.black;
        theme.red = scheme.red;
        theme.green = scheme.green;
        theme.yellow = scheme.yellow;
        theme.blue = scheme.blue;
        theme.magenta = scheme.magenta;
        theme.cyan = scheme.cyan;
        theme.white = scheme.white;
        theme.brightBlack = scheme.brightBlack;
        theme.brightRed = scheme.brightRed;
        theme.brightGreen = scheme.brightGreen;
        theme.brightYellow = scheme.brightYellow;
        theme.brightBlue = scheme.brightBlue;
        theme.brightMagenta = scheme.brightMagenta;
        theme.brightCyan = scheme.brightCyan;
        theme.brightWhite = scheme.brightWhite;
      }
    }

    // Font
    if (defaultProfile.font) {
      theme.fontFamily = defaultProfile.font.face;
      theme.fontSize = defaultProfile.font.size;
    }

    return {
      terminal: 'Windows Terminal',
      theme,
    };
  } catch (error) {
    log.warn('terminalConfig:WindowsTerminal:parseFailed', { error });
    return null;
  }
}
