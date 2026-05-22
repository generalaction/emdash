import {
  detectPlatform,
  KEY_DISPLAY_SYMBOLS,
  MAC_MODIFIER_SYMBOLS,
  parseHotkey,
  STANDARD_MODIFIER_LABELS,
  type CanonicalModifier,
  type Hotkey,
  type ParsedHotkey,
} from '@tanstack/react-hotkeys';

type Platform = ReturnType<typeof detectPlatform>;

const VISIBLE_KEY_LABELS: Record<string, string> = {
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  Backspace: '⌫',
  Delete: 'Del',
  End: 'End',
  Enter: '⏎',
  Escape: 'Esc',
  Home: 'Home',
  PageDown: 'PgDn',
  PageUp: 'PgUp',
  Space: 'Space',
  Tab: 'Tab',
};

const SPOKEN_KEY_LABELS: Record<string, string> = {
  ArrowDown: 'Down Arrow',
  ArrowLeft: 'Left Arrow',
  ArrowRight: 'Right Arrow',
  ArrowUp: 'Up Arrow',
  Backspace: 'Backspace',
  Delete: 'Delete',
  End: 'End',
  Enter: 'Enter',
  Escape: 'Escape',
  Home: 'Home',
  PageDown: 'Page Down',
  PageUp: 'Page Up',
  Space: 'Space',
  Tab: 'Tab',
};

const OPTICAL_ALIGN_CLASS: Record<string, string> = {
  '(': '-translate-y-px',
  ')': '-translate-y-px',
  '+': '-translate-y-px',
  ',': '-translate-y-px',
  '-': '-translate-y-px',
  '.': '-translate-y-px',
  ':': '-translate-y-px',
  ';': '-translate-y-px',
  '=': '-translate-y-px',
  '[': '-translate-y-px',
  ']': '-translate-y-px',
  '{': '-translate-y-px',
  '}': '-translate-y-px',
  '/': '-translate-y-px',
  '\\': '-translate-y-px',
};

const MODIFIER_DISPLAY_ORDER: Record<Platform, Record<CanonicalModifier, number>> = {
  mac: {
    Control: 0,
    Alt: 1,
    Meta: 2,
    Shift: 3,
  },
  windows: {
    Control: 0,
    Alt: 1,
    Shift: 2,
    Meta: 3,
  },
  linux: {
    Control: 0,
    Alt: 1,
    Shift: 2,
    Meta: 3,
  },
};

function isCanonicalModifier(key: string): key is CanonicalModifier {
  return key === 'Control' || key === 'Alt' || key === 'Shift' || key === 'Meta';
}

function normalizeVisibleKeyLabel(key: string): string {
  return key.length === 1 ? key.toUpperCase() : key;
}

function normalizeSpokenKeyLabel(key: string): string {
  const normalized = normalizeVisibleKeyLabel(key);
  return normalized.replace(/([a-z])([A-Z])/g, '$1 $2');
}

function describeModifier(modifier: CanonicalModifier, platform: Platform): string {
  if (platform === 'mac') {
    return (
      {
        Alt: 'Option',
        Control: 'Control',
        Meta: 'Command',
        Shift: 'Shift',
      } satisfies Record<CanonicalModifier, string>
    )[modifier];
  }

  return (
    {
      Alt: 'Alt',
      Control: 'Control',
      Meta: 'Windows',
      Shift: 'Shift',
    } satisfies Record<CanonicalModifier, string>
  )[modifier];
}

function modifierSortValue(modifier: CanonicalModifier, platform: Platform): number {
  return MODIFIER_DISPLAY_ORDER[platform][modifier];
}

export function getShortcutKeys(
  parsed: ParsedHotkey,
  platform: Platform = detectPlatform()
): string[] {
  return [
    ...[...parsed.modifiers].sort(
      (a, b) => modifierSortValue(a, platform) - modifierSortValue(b, platform)
    ),
    parsed.key,
  ];
}

export function formatShortcutKey(key: string, platform: Platform = detectPlatform()): string {
  if (isCanonicalModifier(key)) {
    return platform === 'mac' ? MAC_MODIFIER_SYMBOLS[key] : STANDARD_MODIFIER_LABELS[key];
  }

  return VISIBLE_KEY_LABELS[key] ?? KEY_DISPLAY_SYMBOLS[key] ?? normalizeVisibleKeyLabel(key);
}

export function getShortcutKeyOpticalAlignClass(key: string): string | undefined {
  return OPTICAL_ALIGN_CLASS[key];
}

export function describeShortcut(
  parsed: ParsedHotkey,
  platform: Platform = detectPlatform()
): string {
  const parts = getShortcutKeys(parsed, platform).map((key) => {
    if (isCanonicalModifier(key)) return describeModifier(key, platform);
    return SPOKEN_KEY_LABELS[key] ?? normalizeSpokenKeyLabel(key);
  });
  return parts.join(' ');
}

export function describeHotkey(hotkey: Hotkey, platform: Platform = detectPlatform()): string {
  return describeShortcut(parseHotkey(hotkey, platform), platform);
}
