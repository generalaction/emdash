import { useState } from 'react';
import { commands } from './bindings';

function formatError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

export function App() {
  const [name, setName] = useState('');
  const [greeting, setGreeting] = useState<string | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [greetPending, setGreetPending] = useState(false);
  const [pathPending, setPathPending] = useState(false);

  async function runGreet() {
    setError(null);
    setGreetPending(true);
    try {
      const result = await commands.greet(name || 'world');
      setGreeting(result);
    } catch (e) {
      setError(`greet failed: ${formatError(e)}`);
    } finally {
      setGreetPending(false);
    }
  }

  async function runGetPath() {
    setError(null);
    setPathPending(true);
    try {
      const result = await commands.getPath();
      setPath(result);
    } catch (e) {
      setError(`get_path failed: ${formatError(e)}`);
    } finally {
      setPathPending(false);
    }
  }

  return (
    <main className="app">
      <header>
        <h1>emdash — dev</h1>
        <p className="muted">
          Tauri 2 + Rust scaffold. Two demo commands wired end-to-end:
          <code>greet</code> proves the RPC roundtrip, <code>get_path</code> verifies the macOS
          login-shell PATH inheritance pass.
        </p>
      </header>

      <section>
        <h2>greet</h2>
        <div className="row">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="your name"
            aria-label="your name"
            disabled={greetPending}
          />
          <button onClick={runGreet} type="button" disabled={greetPending}>
            {greetPending ? 'Invoking...' : 'Invoke'}
          </button>
        </div>
        {greeting !== null && <pre className="output">{greeting}</pre>}
      </section>

      <section>
        <h2>get_path</h2>
        <p className="muted">
          Returns the <code>$PATH</code> captured from <code>$SHELL -ilc env</code> at app startup.
        </p>
        <button onClick={runGetPath} type="button" disabled={pathPending}>
          {pathPending ? 'Capturing...' : 'Capture login-shell $PATH'}
        </button>
        {path !== null && <pre className="output">{path}</pre>}
      </section>

      {error && <pre className="error">{error}</pre>}
    </main>
  );
}
