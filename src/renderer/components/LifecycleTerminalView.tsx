import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Terminal, type ITerminalOptions } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { rpc } from '@/lib/rpc';
import { log } from '../lib/logger';

const FALLBACK_FONTS = 'Menlo, Monaco, Courier New, monospace';
const DEFAULT_FONT_SIZE = 13;

type ThemeOverride = NonNullable<ITerminalOptions['theme']> & {
  fontFamily?: string;
  fontSize?: number;
};

interface Props {
  content: string;
  variant: 'dark' | 'light';
  themeOverride?: ThemeOverride;
  className?: string;
}

export const LifecycleTerminalView: React.FC<Props> = ({
  content,
  variant,
  themeOverride,
  className,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const contentRef = useRef('');
  const [customFontFamily, setCustomFontFamily] = useState('');
  const [customFontSize, setCustomFontSize] = useState(0);

  const resolvedTheme = useMemo<NonNullable<ITerminalOptions['theme']>>(() => {
    const selection =
      variant === 'light'
        ? {
            selectionBackground: 'rgba(59, 130, 246, 0.35)',
            selectionForeground: '#0f172a',
          }
        : {
            selectionBackground: 'rgba(96, 165, 250, 0.35)',
            selectionForeground: '#f9fafb',
          };
    const base =
      variant === 'light'
        ? {
            background: '#ffffff',
            foreground: '#1f2933',
            cursor: '#1f2933',
            ...selection,
          }
        : {
            background: '#1f2937',
            foreground: '#f9fafb',
            cursor: '#f9fafb',
            ...selection,
          };

    const mergedTheme = { ...(themeOverride || {}) };
    delete mergedTheme.fontFamily;
    delete mergedTheme.fontSize;

    return { ...base, ...mergedTheme };
  }, [themeOverride, variant]);

  const effectiveFontFamily = useMemo(() => {
    const configuredFont = customFontFamily || themeOverride?.fontFamily?.trim() || '';
    return configuredFont ? `${configuredFont}, ${FALLBACK_FONTS}` : FALLBACK_FONTS;
  }, [customFontFamily, themeOverride?.fontFamily]);

  const effectiveFontSize = useMemo(() => {
    if (customFontSize >= 8 && customFontSize <= 24) {
      return customFontSize;
    }
    if (typeof themeOverride?.fontSize === 'number' && themeOverride.fontSize > 0) {
      return themeOverride.fontSize;
    }
    return DEFAULT_FONT_SIZE;
  }, [customFontSize, themeOverride?.fontSize]);

  useEffect(() => {
    rpc.appSettings
      .get()
      .then((settings) => {
        setCustomFontFamily(settings?.terminal?.fontFamily?.trim() ?? '');
        const size = settings?.terminal?.fontSize;
        if ((typeof size === 'number' && size >= 8 && size <= 24) || size === 0) {
          setCustomFontSize(size);
        }
      })
      .catch((error) => {
        log.warn('Failed to load terminal settings for lifecycle terminal', { error });
      });

    const handleFontChange = (event: Event) => {
      const detail = (event as CustomEvent<{ fontFamily?: string }>).detail;
      setCustomFontFamily(detail?.fontFamily?.trim() ?? '');
    };

    const handleFontSizeChange = (event: Event) => {
      const detail = (event as CustomEvent<{ fontSize?: number }>).detail;
      const size = detail?.fontSize;
      if ((typeof size === 'number' && size >= 8 && size <= 24) || size === 0) {
        setCustomFontSize(size);
      }
    };

    window.addEventListener('terminal-font-changed', handleFontChange);
    window.addEventListener('terminal-font-size-changed', handleFontSizeChange);
    return () => {
      window.removeEventListener('terminal-font-changed', handleFontChange);
      window.removeEventListener('terminal-font-size-changed', handleFontSizeChange);
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const terminal = new Terminal({
      allowProposedApi: true,
      convertEol: true,
      cursorBlink: false,
      disableStdin: true,
      fontFamily: effectiveFontFamily,
      fontSize: effectiveFontSize,
      lineHeight: 1.2,
      scrollback: 10_000,
      theme: resolvedTheme,
    });
    terminal.attachCustomKeyEventHandler(() => false);

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon((event, uri) => {
      event.preventDefault();
      window.electronAPI.openExternal(uri).catch((error) => {
        log.warn('Failed to open lifecycle terminal link', { uri, error });
      });
    });

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.open(container);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    contentRef.current = '';

    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
      } catch (error) {
        log.warn('Failed to fit lifecycle terminal', { error });
      }
    });
    resizeObserver.observe(container);

    requestAnimationFrame(() => {
      try {
        fitAddon.fit();
      } catch (error) {
        log.warn('Failed to fit lifecycle terminal on mount', { error });
      }
    });

    return () => {
      resizeObserver.disconnect();
      fitAddonRef.current = null;
      terminalRef.current = null;
      terminal.dispose();
    };
  }, []);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    terminal.options.theme = resolvedTheme;
    terminal.options.fontFamily = effectiveFontFamily;
    terminal.options.fontSize = effectiveFontSize;

    requestAnimationFrame(() => {
      try {
        fitAddonRef.current?.fit();
      } catch (error) {
        log.warn('Failed to refit lifecycle terminal after theme change', { error });
      }
    });
  }, [effectiveFontFamily, effectiveFontSize, resolvedTheme]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    if (content === contentRef.current) return;

    const previous = contentRef.current;
    contentRef.current = content;

    if (previous && content.startsWith(previous)) {
      const appended = content.slice(previous.length);
      if (!appended) return;
      terminal.write(appended, () => terminal.scrollToBottom());
      return;
    }

    terminal.reset();
    if (content) {
      terminal.write(content, () => terminal.scrollToBottom());
    }
  }, [content]);

  return (
    <div
      className={['terminal-pane flex h-full w-full min-w-0', className].filter(Boolean).join(' ')}
      style={{
        width: '100%',
        height: '100%',
        minHeight: 0,
        padding: '4px 8px 8px 8px',
        backgroundColor: variant === 'light' ? '#ffffff' : themeOverride?.background || '#1f2937',
        boxSizing: 'border-box',
      }}
    >
      <div
        ref={containerRef}
        data-terminal-container
        style={{
          width: '100%',
          height: '100%',
          minHeight: 0,
          overflow: 'hidden',
        }}
      />
    </div>
  );
};

export default LifecycleTerminalView;
