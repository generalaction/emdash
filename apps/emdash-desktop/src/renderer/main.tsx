import {
  connectSession,
  createChatContext,
  createChatState,
  createChatView,
  pinTopMode,
} from '@emdash/chat-ui';
import ReactDOM from 'react-dom/client';
import { configureDevPerfClient } from '@core/features/dev-perf/api/browser/client';
import { monacoBootstrap } from '@core/features/editor/browser/monaco/monaco-bootstrap';
import { prefetchAppSettingsKey } from '@core/features/settings/api/browser/use-app-settings-key';
import {
  workbenchHistoryMemento,
  workbenchNavigationMemento,
  workbenchSidebarMemento,
} from '@core/features/workbench/contributions/mementos';
import { featureViewRuntimes } from '@core/manifests/browser/browser-contributions';
import { viewCatalog } from '@core/manifests/browser/view-catalog';
import { mementoCatalog } from '@core/manifests/shared/memento-catalog';
import { log } from '@core/primitives/logging/browser/logger';
import { configureMementos, initMementos } from '@core/primitives/mementos/browser';
import { MementoClientProvider, SubjectProvider } from '@core/primitives/mementos/react';
import '@fontsource-variable/inter/index.css';
import '@emdash/ui/style.css';
import '@emdash/chat-ui/style.css';
import './index.css';
import 'devicon/devicon.min.css';
import 'katex/dist/katex.min.css';
import { appSubject } from '@core/primitives/subjects/api';
import { assertViewRuntimesComplete, registerViewRuntime } from '@core/primitives/views/react';
import { ErrorBoundary } from '@renderer/error-boundary';
import { installChatUiRuntime } from '@renderer/lib/chat/chat-ui-runtime';
import { wireExternalLinkRequests } from '@renderer/lib/external-link-requests';
import { getDesktopWireClient } from '@renderer/lib/runtime/desktop-wire-client';
import { getMementosWireClient } from '@renderer/lib/runtime/mementos-wire-client';
import { seedDesktopWire } from '@renderer/lib/runtime/seed-desktop-wire';
import { initRendererPerfVitals } from '@renderer/utils/perf-vitals';
import { initSoundPlayer } from '@renderer/utils/soundPlayer';
import { initNotificationDeliveryListener } from '@root/src/core/services/notifications/browser';
import { App } from './App';
import { appState } from './lib/stores/app-state';
import { wireNavigationTelemetry } from './lib/stores/navigation-telemetry';

async function bootstrap() {
  // Core owns wire access through the seeded-connection seam; seed it before
  // React mounts so any slice can reach the wire without host imports.
  seedDesktopWire();

  installChatUiRuntime({
    connectSession,
    createChatContext,
    createChatState,
    createChatView,
    pinTopMode,
  });
  wireExternalLinkRequests();

  appState.update.start();
  void appState.machines.start();
  initSoundPlayer();
  initNotificationDeliveryListener();
  initRendererPerfVitals();
  configureDevPerfClient(async () => (await getDesktopWireClient()).devPerf);

  // Stores may acquire memento spaces while project data loads, so initialize
  // the singleton before starting any store construction.
  configureMementos({
    getWireClient: getMementosWireClient,
    catalog: mementoCatalog,
    onError: (error) => log.error('Memento operation failed:', error),
  });
  const mementoClient = await initMementos();

  // Initialize Monaco and load app data in parallel. Awaiting Monaco here
  // guarantees __monaco is set before React renders, so StickyDiffEditor can
  // create editors synchronously on mount without any async coordination.
  await Promise.all([
    monacoBootstrap.init().catch((error: unknown) => {
      log.warn('[monaco-bootstrap] init failed:', error);
    }),
    appState.projects.load(),
    prefetchAppSettingsKey('interface'),
    prefetchAppSettingsKey('browser'),
  ]);

  for (const contribution of featureViewRuntimes) registerViewRuntime(contribution);
  assertViewRuntimesComplete(viewCatalog);
  const appSpace = mementoClient.subject(appSubject({}));
  const historyHandle = appSpace.handle(workbenchHistoryMemento);
  const legacyNavigationHandle = appSpace.handle(workbenchNavigationMemento);
  const sidebarHandle = appSpace.handle(workbenchSidebarMemento);
  await appSpace.ready;
  appState.navigation.attachMemento(historyHandle, legacyNavigationHandle);
  appState.sidebar.attachMemento(sidebarHandle);
  if (!sidebarHandle.hasStoredValue) appState.sidebar.expandAllProjects();
  wireNavigationTelemetry(appState.navigation);

  // Avoid double-mount in dev which can duplicate PTY sessions
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <ErrorBoundary>
      <MementoClientProvider client={mementoClient}>
        <SubjectProvider subject={appSubject({})}>
          <App />
        </SubjectProvider>
      </MementoClientProvider>
    </ErrorBoundary>
  );
}

bootstrap().catch((error: unknown) => {
  log.error('Renderer bootstrap failed:', error);
});
