import { useState } from 'react';
import { commands, type SecretsCommandError } from './bindings';
import { DebugShell } from './components/DebugShell';

function formatThrown(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

function formatSecretsError(err: SecretsCommandError): string {
  return `[${err.code}] ${err.message}`;
}

export function App() {
  const [name, setName] = useState('');
  const [greeting, setGreeting] = useState<string | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [greetPending, setGreetPending] = useState(false);
  const [pathPending, setPathPending] = useState(false);

  const [secretKey, setSecretKey] = useState('');
  const [secretValue, setSecretValue] = useState('');
  const [readBack, setReadBack] = useState<string | null>(null);
  const [secretsPending, setSecretsPending] = useState(false);

  async function runGreet() {
    setError(null);
    setGreetPending(true);
    try {
      const result = await commands.greet(name || 'world');
      setGreeting(result);
    } catch (e) {
      setError(`greet failed: ${formatThrown(e)}`);
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
      setError(`get_path failed: ${formatThrown(e)}`);
    } finally {
      setPathPending(false);
    }
  }

  async function runRoundtrip() {
    setError(null);
    setReadBack(null);
    setSecretsPending(true);
    try {
      const setResult = await commands.setSecret(secretKey, secretValue);
      if (setResult.status === 'error') {
        setError(`set_secret failed: ${formatSecretsError(setResult.error)}`);
        return;
      }
      const getResult = await commands.getSecret(secretKey);
      if (getResult.status === 'error') {
        setError(`get_secret failed: ${formatSecretsError(getResult.error)}`);
        return;
      }
      setReadBack(getResult.data ?? '<none>');
    } catch (e) {
      // Thrown errors (e.g., IPC layer failures, Tauri panics that bubble up as Error instances)
      setError(`secrets round-trip failed: ${formatThrown(e)}`);
    } finally {
      setSecretsPending(false);
    }
  }

  return (
    <main className="app">
      <header>
        <h1>emdash — dev</h1>
        <p className="muted">
          Tauri 2 + Rust scaffold. Greet + get_path remain from EMD-5; settings round-trip exercises
          the AEAD secrets pipeline from EMD-6.
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

      <section>
        <h2>Settings — secrets round-trip</h2>
        <p className="muted">
          Stores the value in <code>app_secrets</code> under AEAD, then reads it back via{' '}
          <code>get_secret</code>. Plaintext never leaves Rust at rest.
        </p>
        <div className="row">
          <input
            type="text"
            value={secretKey}
            onChange={(e) => setSecretKey(e.target.value)}
            placeholder="key (e.g. github_token)"
            aria-label="secret key"
            disabled={secretsPending}
          />
        </div>
        <div className="row">
          <input
            type="text"
            value={secretValue}
            onChange={(e) => setSecretValue(e.target.value)}
            placeholder="value"
            aria-label="secret value"
            disabled={secretsPending}
          />
          <button
            onClick={runRoundtrip}
            type="button"
            disabled={secretsPending || secretKey.length === 0}
          >
            {secretsPending ? 'Round-tripping...' : 'Save & read back'}
          </button>
        </div>
        {readBack !== null && <pre className="output">stored and re-read: {readBack}</pre>}
      </section>

      {import.meta.env.DEV && <DebugShell />}

      {error && <pre className="error">{error}</pre>}
    </main>
  );
}
