import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './index.css';
import 'devicon/devicon.min.css';
import type { NavigationSnapshot, SidebarSnapshot } from '@shared/view-state';
import { rpc } from './core/ipc';
import { codeEditorPool } from './core/monaco/monaco-code-pool';
import { diffEditorPool } from './core/monaco/monaco-diff-pool';
import { appState } from './core/stores/app-state';
import { log } from './lib/logger';
import { initSoundPlayer } from './lib/soundPlayer';

async function bootstrap() {
  // Pre-warm Monaco immediately — runs in parallel with data loading.
  codeEditorPool.init(0).catch((error: unknown) => {
    log.warn('[monaco-code-pool] init failed:', error);
  });
  diffEditorPool.init(4).catch((error: unknown) => {
    log.warn('[monaco-diff-pool] init failed:', error);
  });

  appState.appInfo.load();
  appState.update.start();
  initSoundPlayer();
  const [navResult, sidebarResult] = await Promise.all([
    rpc.viewState.get('navigation') as Promise<NavigationSnapshot> | null,
    rpc.viewState.get('sidebar'),
    appState.projects.load(),
  ]);

  if (navResult) appState.navigation.restoreSnapshot(navResult);
  if (sidebarResult) {
    appState.sidebar.restoreSnapshot(sidebarResult as Partial<SidebarSnapshot>);
  } else {
    appState.sidebar.expandAllProjects();
  }

  // Avoid double-mount in dev which can duplicate PTY sessions
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<App />);
}

bootstrap().catch((error: unknown) => {
  log.error('Renderer bootstrap failed:', error);
});
