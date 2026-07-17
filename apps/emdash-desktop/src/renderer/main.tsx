import ReactDOM from 'react-dom/client';
import { prefetchAppSettingsKey } from '@core/features/settings/browser/use-app-settings-key';
import {
  workbenchHistoryMemento,
  workbenchNavigationMemento,
  workbenchSidebarMemento,
} from '@core/features/workbench/contributions/mementos';
import { featureViewRuntimes } from '@core/manifests/browser-contributions';
import { viewCatalog } from '@core/manifests/view-catalog';
import { MementoClientProvider, SubjectProvider } from '@core/primitives/mementos/react';
import { appSubject } from '@core/primitives/subjects/api';
import { assertViewRuntimesComplete, registerViewRuntime } from '@core/primitives/views/react';
import '@emdash/ui/style.css';
import '@emdash/chat-ui/style.css';
import './index.css';
import 'devicon/devicon.min.css';
import 'katex/dist/katex.min.css';
import { setupAppCommandProvider } from '@renderer/lib/commands/app-commands';
import { setupViewCommandProvider } from '@renderer/lib/commands/registry';
import { wireExternalLinkRequests } from '@renderer/lib/external-link-requests';
import { initMementos } from '@renderer/lib/mementos';
import { monacoBootstrap } from '@renderer/lib/monaco/monaco-bootstrap';
import { log } from '@renderer/utils/logger';
import { initSoundPlayer } from '@renderer/utils/soundPlayer';
import { initNotificationDeliveryListener } from '@root/src/core/services/notifications/browser';
import { App } from './App';
import { ErrorBoundary } from './lib/components/error-boundary';
import { appState } from './lib/stores/app-state';
import { wireNavigationTelemetry } from './lib/stores/navigation-telemetry';

async function bootstrap() {
  wireExternalLinkRequests();

  appState.update.start();
  initSoundPlayer();
  initNotificationDeliveryListener();

  // Stores may acquire memento spaces while project data loads, so initialize
  // the singleton before starting any store construction.
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
  setupAppCommandProvider();
  setupViewCommandProvider();

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
