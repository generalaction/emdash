import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Clipboard, Keyboard } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { readMobileClipboard } from '../browser-compat';
import { useMobileClient } from '../client/context';
import type { PtyResourceHandle } from '../client/types';
import { chunkTerminalInput } from '../terminal-input';

const keys: Array<{ label: string; data: string; icon?: 'left' | 'right' | 'up' | 'down' }> = [
  { label: 'Esc', data: '\u001b' },
  { label: 'Tab', data: '\t' },
  { label: '←', data: '\u001b[D', icon: 'left' },
  { label: '↑', data: '\u001b[A', icon: 'up' },
  { label: '↓', data: '\u001b[B', icon: 'down' },
  { label: '→', data: '\u001b[C', icon: 'right' },
  { label: 'Enter', data: '\r' },
  { label: 'Ctrl-C', data: '\u0003' },
];

function KeyIcon({ icon }: { icon?: 'left' | 'right' | 'up' | 'down' }) {
  if (icon === 'left') return <ArrowLeft size={15} />;
  if (icon === 'right') return <ArrowRight size={15} />;
  if (icon === 'up') return <ArrowUp size={15} />;
  if (icon === 'down') return <ArrowDown size={15} />;
  return null;
}

function ctrlCharacter(data: string): string {
  if (data.length !== 1) return data;
  const code = data.toUpperCase().charCodeAt(0);
  return code >= 64 && code <= 95 ? String.fromCharCode(code - 64) : data;
}

export function TerminalView({ handle }: { handle: PtyResourceHandle }) {
  const client = useMobileClient();
  const container = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const [ctrl, setCtrl] = useState(false);
  const ctrlRef = useRef(false);
  const [exited, setExited] = useState(handle.exited);
  const [exitCode, setExitCode] = useState(handle.exitCode);
  const [inputError, setInputError] = useState('');

  const sendInput = useCallback(
    async (data: string) => {
      try {
        await client.sendPtyInput(handle.handleId, data);
        setInputError('');
      } catch (reason) {
        setInputError(errorMessage(reason, 'Could not send terminal input.'));
        throw reason;
      }
    },
    [client, handle.handleId]
  );

  useEffect(() => {
    ctrlRef.current = ctrl;
  }, [ctrl]);

  useEffect(() => {
    const host = container.current;
    if (!host) return;
    const instance = new Terminal({
      cols: handle.cols,
      rows: handle.rows,
      cursorBlink: true,
      cursorStyle: 'bar',
      allowTransparency: true,
      convertEol: true,
      fontFamily: "'JetBrains Mono Variable', 'SFMono-Regular', Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.3,
      scrollback: 4_000,
      theme: {
        background: '#0b0d0c',
        foreground: '#d8ddd9',
        cursor: '#87e8bc',
        cursorAccent: '#0b0d0c',
        selectionBackground: '#2b5d49aa',
        black: '#171a18',
        brightBlack: '#626b65',
        red: '#ff7b72',
        green: '#87e8bc',
        yellow: '#f0c66a',
        blue: '#78a9ff',
        magenta: '#c79bf2',
        cyan: '#66d9df',
        white: '#d8ddd9',
      },
    });
    terminal.current = instance;
    instance.open(host);
    instance.write(handle.snapshot);
    instance.focus();

    const dataSubscription = instance.onData((data) => {
      const next = ctrlRef.current ? ctrlCharacter(data) : data;
      if (ctrlRef.current) setCtrl(false);
      void sendInput(next).catch(() => undefined);
    });
    let resizeFrame = 0;
    let previousCols = handle.cols;
    let previousRows = handle.rows;
    const observer = new ResizeObserver(([entry]) => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => {
        const cols = Math.max(20, Math.floor(entry.contentRect.width / 8.25));
        const rows = Math.max(5, Math.floor(entry.contentRect.height / 17));
        if (cols === previousCols && rows === previousRows) return;
        previousCols = cols;
        previousRows = rows;
        instance.resize(cols, rows);
        void client.resizePty(handle.handleId, cols, rows).catch((reason: unknown) => {
          setInputError(errorMessage(reason, 'Could not resize the terminal.'));
        });
      });
    });
    observer.observe(host);
    const unsubscribe = client.subscribe((event) => {
      if (event.type === 'pty.data' && event.handleId === handle.handleId) {
        instance.write(event.data);
      }
      if (event.type === 'pty.exit' && event.handleId === handle.handleId) {
        setExited(true);
        setExitCode(event.exitCode);
      }
    });
    return () => {
      window.cancelAnimationFrame(resizeFrame);
      observer.disconnect();
      unsubscribe();
      dataSubscription.dispose();
      instance.dispose();
      terminal.current = null;
    };
  }, [client, handle, sendInput]);

  const paste = async () => {
    try {
      const text = await readMobileClipboard();
      for (const chunk of chunkTerminalInput(text)) await sendInput(chunk);
    } catch (reason) {
      setInputError(errorMessage(reason, 'Could not paste into the terminal.'));
    } finally {
      terminal.current?.focus();
    }
  };

  return (
    <div className="terminal-view">
      <div className="terminal-stage" ref={container} onClick={() => terminal.current?.focus()} />
      {exited && (
        <div className="terminal-exit" role="status">
          Process exited{exitCode === undefined ? '' : ` with code ${exitCode}`}
        </div>
      )}
      {inputError && (
        <div className="terminal-input-error" role="alert">
          {inputError}
        </div>
      )}
      <div className="terminal-keybar" aria-label="Terminal shortcut keys">
        <button
          type="button"
          data-active={ctrl || undefined}
          aria-pressed={ctrl}
          onClick={() => {
            setCtrl((value) => !value);
            terminal.current?.focus();
          }}
        >
          Ctrl
        </button>
        {keys.map((key) => (
          <button
            type="button"
            key={key.label}
            aria-label={key.label}
            onClick={() => {
              void sendInput(key.data).catch(() => undefined);
              terminal.current?.focus();
            }}
          >
            <KeyIcon icon={key.icon} />
            {!key.icon && key.label}
          </button>
        ))}
        <button type="button" aria-label="Paste" onClick={paste}>
          <Clipboard size={15} />
        </button>
        <span className="keybar-hint">
          <Keyboard size={14} /> tap terminal to type
        </span>
      </div>
    </div>
  );
}

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}
