import { useEffect, useState } from 'react';
import { useMobileClient } from './client/context';
import type { BootstrapState } from './client/types';
import { BrandMark } from './components/brand-mark';
import { PairScreen } from './components/pair-screen';
import { MobileShell } from './mobile-shell';

type AppState =
  | { kind: 'loading' }
  | { kind: 'pair'; error?: string }
  | { kind: 'ready'; bootstrap: BootstrapState };

export function App() {
  const client = useMobileClient();
  const [state, setState] = useState<AppState>({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    void client
      .bootstrap()
      .then((bootstrap) => {
        if (!active) return;
        setState(
          bootstrap.authenticated && bootstrap.catalog
            ? { kind: 'ready', bootstrap }
            : { kind: 'pair' }
        );
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setState({
          kind: 'pair',
          error:
            reason instanceof Error ? reason.message : 'Could not reach Emdash on this network.',
        });
      });
    return () => {
      active = false;
    };
  }, [client]);

  if (state.kind === 'loading') {
    return (
      <main className="launch-screen">
        <BrandMark size={48} />
        <span className="spinner" />
        <p>Connecting to Emdash…</p>
      </main>
    );
  }

  if (state.kind === 'pair') {
    return (
      <PairScreen
        initialError={state.error}
        onPair={async (code) => {
          const bootstrap = await client.pair(code);
          if (!bootstrap.authenticated || !bootstrap.catalog) {
            throw new Error('The desktop did not authorize this phone.');
          }
          setState({ kind: 'ready', bootstrap });
        }}
      />
    );
  }

  const { bootstrap } = state;
  return (
    <MobileShell
      initialCatalog={bootstrap.catalog!}
      deviceName={bootstrap.deviceName}
      onLogout={async () => {
        await client.logout();
        setState({ kind: 'pair' });
      }}
    />
  );
}
