import { installChatUiRuntime } from '@core/features/conversations/api/browser/chat/chat-ui-runtime';
import { configureDevPerfClient } from '@core/features/dev-perf/api/browser/client';
import { installMonacoFacetBinder } from '@core/features/editor/browser/monaco/install-monaco-facet-binder';
import { monacoBootstrap } from '@core/features/editor/browser/monaco/monaco-bootstrap';
import { getProjectManagerStore } from '@core/features/projects/api/browser/stores/project-selectors';
import { prefetchAppSettingsKey } from '@core/features/settings/api/browser/use-app-settings-key';
import { initSoundPlayer, soundPlayer } from '@core/features/settings/browser/sound-player';
import { getSidebarStore } from '@core/features/workbench/contributions/browser/app-stores';
import { workbenchSidebarMemento } from '@core/features/workbench/contributions/mementos';
import { appStoreContributions } from '@core/manifests/browser/app-scoped-stores';
import { featureViewRuntimes } from '@core/manifests/browser/browser-contributions';
import { viewCatalog } from '@core/manifests/browser/view-catalog';
import { mementoCatalog } from '@core/manifests/shared/memento-catalog';
import { log } from '@core/primitives/logging/browser/logger';
import { getMementosWireClient } from '@core/primitives/mementos/api/client';
import { configureMementos, initMementos } from '@core/primitives/mementos/browser';
import { MementoClientProvider, SubjectProvider } from '@core/primitives/mementos/react';
import {
  workbenchHistoryMemento,
  workbenchNavigationMemento,
} from '@core/primitives/navigation/api/mementos';
import '@fontsource-variable/inter/index.css';
import '@emdash/ui/style.css';
import '@emdash/chat-ui/style.css';
import '@renderer/index.css';
import 'devicon/devicon.min.css';
import 'katex/dist/katex.min.css';
import { getNavigation } from '@core/primitives/navigation/browser/navigation-selectors';
import { createAppScope } from '@core/primitives/scoped-stores/browser';
import { appSubject } from '@core/primitives/subjects/api';
import { assertViewRuntimesComplete, registerViewRuntime } from '@core/primitives/views/react';
import { initNotificationDeliveryListener } from '@core/services/notifications/browser';
/**
 * Emdash Web renderer bootstrap.
 *
 * Mirrors the desktop renderer bootstrap (apps/emdash-desktop/src/renderer/main.tsx)
 * with two substitutions: the wire connection seeds over a WebSocket instead of
 * an Electron MessagePort, and `window.electronAPI` is a no-op shim.
 */
import {
  connectSession,
  createChatContext,
  createChatState,
  createChatView,
  pinTopMode,
} from '@emdash/chat-ui';
import ReactDOM from 'react-dom/client';
import { App } from '@renderer/App';
import { ErrorBoundary } from '@renderer/error-boundary';
import {
  dismissBootSplash,
  initBootSplash,
  showBootSplashEscapeHatch,
} from '@renderer/lib/boot/boot-splash';
import {
  appQueriesSettled,
  raceSplashGate,
  SPLASH_GATE_TIMEOUT_MS,
  waitForActiveProjectContext,
} from '@renderer/lib/boot/splash-gate';
import { wireExternalLinkRequests } from '@renderer/lib/external-link-requests';
import { getDesktopWireClient } from '@renderer/lib/runtime/desktop-wire-client';
import { seedRendererNavigationHost } from '@renderer/lib/runtime/seed-navigation-host';
import { captureTokenFromUrl, getWebToken, seedWebWire } from './seed-web-wire';
import { installElectronApiShim } from './shim';

function showTokenPrompt(): void {
  const splash = document.getElementById('boot-splash');
  const escape = document.getElementById('boot-splash-escape');
  if (splash && escape) {
    escape.hidden = false;
    escape.innerHTML = '';
    const p = document.createElement('p');
    p.textContent = 'Emdash Web needs an access token.';
    const input = document.createElement('input');
    input.type = 'password';
    input.placeholder = 'Paste token…';
    input.style.cssText =
      'padding:6px 10px;border-radius:6px;border:1px solid rgba(128,128,128,.5);background:transparent;color:inherit;font:inherit;font-size:12px;min-width:220px';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Connect';
    button.onclick = () => {
      const value = input.value.trim();
      if (!value) return;
      window.localStorage.setItem('emdash-web-token', value);
      window.location.reload();
    };
    const row = document.createElement('div');
    row.className = 'boot-splash-escape-actions';
    row.append(input, button);
    escape.append(p, row);
    input.focus();
  }
}

async function bootstrap() {
  installElectronApiShim();
  captureTokenFromUrl();
  initBootSplash();
  if (!getWebToken()) {
    showTokenPrompt();
    return;
  }
  seedWebWire();

  seedRendererNavigationHost();

  installChatUiRuntime({
    connectSession,
    createChatContext,
    createChatState,
    createChatView,
    pinTopMode,
  });
  wireExternalLinkRequests();

  createAppScope([...appStoreContributions]);
  installMonacoFacetBinder();
  void monacoBootstrap
    .init()
    .catch((error: unknown) => {
      log.warn('[monaco-bootstrap] init failed:', error);
    })
    .then(() => undefined);
  initSoundPlayer();
  initNotificationDeliveryListener((sound, dedupeKey) => soundPlayer.play(sound, dedupeKey));
  configureDevPerfClient(async () => (await getDesktopWireClient()).devPerf);

  configureMementos({
    getWireClient: getMementosWireClient,
    catalog: mementoCatalog,
    onError: (error: unknown) => log.error('Memento operation failed:', error),
  });
  const mementoClient = await initMementos();

  void prefetchAppSettingsKey('interface');
  void prefetchAppSettingsKey('browser');

  for (const contribution of featureViewRuntimes) registerViewRuntime(contribution);
  assertViewRuntimesComplete(viewCatalog);

  const appSpace = mementoClient.subject(appSubject({}));
  const historyHandle = appSpace.handle(workbenchHistoryMemento);
  const legacyNavigationHandle = appSpace.handle(workbenchNavigationMemento);
  const sidebarHandle = appSpace.handle(workbenchSidebarMemento);
  const projectsLoaded = getProjectManagerStore().load();
  const navigationRestored = appSpace.ready.then(() => {
    getNavigation().attachMemento(historyHandle, legacyNavigationHandle);
    getSidebarStore().attachMemento(sidebarHandle);
  });
  const sidebarInitialized = Promise.all([navigationRestored, projectsLoaded]).then(() => {
    if (!sidebarHandle.hasStoredValue) getSidebarStore().expandAllProjects();
  });

  const activeProjectReady = waitForActiveProjectContext({
    navigationRestored,
    projectsLoaded,
    activeProjectId: () => {
      const ref = getNavigation().currentRef;
      return ref.viewId === 'project' || ref.viewId === 'task'
        ? (ref.params as { projectId?: string }).projectId
        : undefined;
    },
    hydrateProjectContext: (projectId: string) =>
      getProjectManagerStore().hydrateProjectContext(projectId),
  });

  const gate = raceSplashGate(
    [sidebarInitialized, activeProjectReady, appQueriesSettled()],
    SPLASH_GATE_TIMEOUT_MS
  );

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <ErrorBoundary>
      <MementoClientProvider client={mementoClient}>
        <SubjectProvider subject={appSubject({})}>
          <App />
        </SubjectProvider>
      </MementoClientProvider>
    </ErrorBoundary>
  );

  const outcome = await gate;
  dismissBootSplash();
  log.info('web boot complete', { gate: outcome });
}

bootstrap().catch((error: unknown) => {
  log.error('Web renderer bootstrap failed:', error);
  showBootSplashEscapeHatch();
});
