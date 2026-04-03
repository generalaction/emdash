import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './index.css';
import 'devicon/devicon.min.css';
import type { NavigationSnapshot } from '@shared/view-state';
import { rpc } from './core/ipc';
import { codeEditorPool } from './core/monaco/monaco-code-pool';
import { diffEditorPool } from './core/monaco/monaco-diff-pool';
import { appState } from './core/stores/app-state';

async function bootstrap() {
  // Pre-warm Monaco immediately — runs in parallel with data loading.
  codeEditorPool.init(0).catch(console.warn);
  diffEditorPool.init(4).catch(console.warn);

  appState.appInfo.load();
  appState.update.start();

  const [navResult] = await Promise.all([
    rpc.viewState.get('navigation') as Promise<NavigationSnapshot> | null,
    appState.projects.load(),
  ]);

  if (navResult) appState.navigation.restoreSnapshot(navResult);

  // Avoid double-mount in dev which can duplicate PTY sessions
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<App />);
}

bootstrap().catch(console.error);
