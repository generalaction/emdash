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
  diffEditorPool.init(3).catch(console.warn);

  // Load navigation snapshot and all projects+tasks concurrently before
  // first render so the UI is fully ready when React mounts.
  // #region agent log
  fetch('http://127.0.0.1:7430/ingest/6ccbb4c2-4905-4756-889f-988f583bdf2f', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'f1d8e3' },
    body: JSON.stringify({
      sessionId: 'f1d8e3',
      location: 'main.tsx:bootstrap-start',
      message: 'bootstrap starting',
      data: { navCurrentViewId: appState.navigation.currentViewId },
      timestamp: Date.now(),
      runId: 'run2',
      hypothesisId: 'A-D',
    }),
  }).catch(() => {});
  // #endregion

  const [navResult] = await Promise.all([
    rpc.viewState.get('navigation').catch((e) => {
      fetch('http://127.0.0.1:7430/ingest/6ccbb4c2-4905-4756-889f-988f583bdf2f', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'f1d8e3' },
        body: JSON.stringify({
          sessionId: 'f1d8e3',
          location: 'main.tsx:nav-fetch-error',
          message: 'nav snapshot fetch error',
          data: { error: String(e) },
          timestamp: Date.now(),
          runId: 'run2',
          hypothesisId: 'A',
        }),
      }).catch(() => {});
      return null;
    }),
    appState.projects
      .load()
      .then(() => {
        fetch('http://127.0.0.1:7430/ingest/6ccbb4c2-4905-4756-889f-988f583bdf2f', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'f1d8e3' },
          body: JSON.stringify({
            sessionId: 'f1d8e3',
            location: 'main.tsx:projects-loaded',
            message: 'projects.load() resolved',
            data: { projectCount: [...appState.projects.projects.keys()].length },
            timestamp: Date.now(),
            runId: 'run2',
            hypothesisId: 'C',
          }),
        }).catch(() => {});
      })
      .catch((e) => {
        fetch('http://127.0.0.1:7430/ingest/6ccbb4c2-4905-4756-889f-988f583bdf2f', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'f1d8e3' },
          body: JSON.stringify({
            sessionId: 'f1d8e3',
            location: 'main.tsx:projects-load-error',
            message: 'projects.load() error',
            data: { error: String(e) },
            timestamp: Date.now(),
            runId: 'run2',
            hypothesisId: 'C',
          }),
        }).catch(() => {});
      }),
  ]);

  // #region agent log
  fetch('http://127.0.0.1:7430/ingest/6ccbb4c2-4905-4756-889f-988f583bdf2f', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'f1d8e3' },
    body: JSON.stringify({
      sessionId: 'f1d8e3',
      location: 'main.tsx:after-promise-all',
      message: 'Promise.all resolved',
      data: { navResult: navResult, navResultType: typeof navResult },
      timestamp: Date.now(),
      runId: 'run2',
      hypothesisId: 'A-B',
    }),
  }).catch(() => {});
  // #endregion

  if (navResult) appState.navigation.restoreSnapshot(navResult as NavigationSnapshot);

  // #region agent log
  fetch('http://127.0.0.1:7430/ingest/6ccbb4c2-4905-4756-889f-988f583bdf2f', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'f1d8e3' },
    body: JSON.stringify({
      sessionId: 'f1d8e3',
      location: 'main.tsx:after-restore',
      message: 'after restoreSnapshot',
      data: {
        currentViewId: appState.navigation.currentViewId,
        viewParams: appState.navigation.viewParamsStore,
      },
      timestamp: Date.now(),
      runId: 'run2',
      hypothesisId: 'A-B-D',
    }),
  }).catch(() => {});
  // #endregion

  // Avoid double-mount in dev which can duplicate PTY sessions
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<App />);
}

bootstrap().catch(console.error);
