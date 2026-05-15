import { Channel } from '@tauri-apps/api/core';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import { useRef, useState } from 'react';
import '@xterm/xterm/css/xterm.css';
import { commands } from '../bindings';

const DEFAULT_SHELL = navigator.userAgent.includes('Windows') ? 'cmd.exe' : '/bin/bash';

export function DebugShell() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function openShell() {
    if (!containerRef.current || sessionId !== null) return;
    setError(null);

    const term = new Terminal({ rows: 24, cols: 80, scrollback: 100_000 });
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);
    term.focus();

    const onData = new Channel<number[]>();
    onData.onmessage = (chunk) => {
      // Channel<Vec<u8>> arrives as number[]; xterm.write accepts Uint8Array.
      term.write(new Uint8Array(chunk));
    };

    const result = await commands.ptySpawn(
      {
        command: DEFAULT_SHELL,
        args: [],
        cwd: null,
        env: {},
        size: { rows: 24, cols: 80 },
      },
      onData
    );

    if (result.status === 'error') {
      setError(`spawn failed: ${result.error.kind}`);
      return;
    }
    const id = result.data;
    setSessionId(id);

    term.onData((data) => {
      const bytes = Array.from(new TextEncoder().encode(data));
      void commands.ptyWrite(id, bytes);
    });

    term.onResize(({ rows, cols }) => {
      void commands.ptyResize(id, { rows, cols });
    });
  }

  async function killShell() {
    if (sessionId === null) return;
    const result = await commands.ptyKill(sessionId);
    if (result.status === 'error') {
      setError(`kill failed: ${result.error.kind}`);
      return;
    }
    setSessionId(null);
  }

  return (
    <section>
      <h2>Debug shell</h2>
      <p className="muted">
        Spawns <code>{DEFAULT_SHELL}</code> and streams output through{' '}
        <code>Channel&lt;Vec&lt;u8&gt;&gt;</code> coalesced at 16 KiB / 4 ms. Available in dev
        builds only.
      </p>
      <div className="row">
        {sessionId === null ? (
          <button onClick={openShell} type="button">
            Open shell
          </button>
        ) : (
          <button onClick={killShell} type="button">
            Kill shell ({sessionId})
          </button>
        )}
      </div>
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: 400,
          background: '#000',
          padding: 4,
          marginTop: 12,
        }}
      />
      {error && <pre className="error">{error}</pre>}
    </section>
  );
}
