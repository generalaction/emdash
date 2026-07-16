import ReactDOM from 'react-dom/client';
import { setupNavigationGuards } from '@renderer/app/view-registry';
import { prefetchAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import '@emdash/ui/style.css';
import '@emdash/chat-ui/style.css';
import './index.css';
import 'devicon/devicon.min.css';
import 'katex/dist/katex.min.css';
import { setupAppCommandProvider } from '@renderer/lib/commands/app-commands';
import { setupViewCommandProvider } from '@renderer/lib/commands/registry';
import { wireExternalLinkRequests } from '@renderer/lib/external-link-requests';
import { rpc } from '@renderer/lib/ipc';
import { monacoBootstrap } from '@renderer/lib/monaco/monaco-bootstrap';
import { wirePrCacheInvalidation } from '@renderer/lib/pr-cache-invalidation';
import { viewStateCache } from '@renderer/lib/stores/view-state-cache';
import { log } from '@renderer/utils/logger';
import { initSoundPlayer } from '@renderer/utils/soundPlayer';
import { initNotificationDeliveryListener } from '@root/src/core/services/notifications/browser';
import type { NavigationSnapshot, SidebarSnapshot } from '@shared/view-state';
import { App } from './App';
import { ErrorBoundary } from './lib/components/error-boundary';
import { appState } from './lib/stores/app-state';

async function bootstrap() {
  wirePrCacheInvalidation();
  wireExternalLinkRequests();

  appState.update.start();
  initSoundPlayer();
  initNotificationDeliveryListener();

  // Initialize Monaco and load app data in parallel. Awaiting Monaco here
  // guarantees __monaco is set before React renders, so StickyDiffEditor can
  // create editors synchronously on mount without any async coordination.
  const [, navResult, sidebarResult, allViewState] = await Promise.all([
    monacoBootstrap.init().catch((error: unknown) => {
      log.warn('[monaco-bootstrap] init failed:', error);
    }),
    rpc.viewState.get('navigation') as Promise<NavigationSnapshot> | null,
    rpc.viewState.get('sidebar'),
    rpc.viewState.getAll(),
    appState.projects.load(),
    prefetchAppSettingsKey('interface'),
    prefetchAppSettingsKey('browser'),
  ]);

  viewStateCache.populate(allViewState as Record<string, unknown>);

  setupNavigationGuards();
  if (navResult) appState.navigation.restoreSnapshot(navResult);
  setupAppCommandProvider();
  setupViewCommandProvider();
  if (sidebarResult) {
    appState.sidebar.restoreSnapshot(sidebarResult as Partial<SidebarSnapshot>);
  } else {
    appState.sidebar.expandAllProjects();
  }

  // Avoid double-mount in dev which can duplicate PTY sessions
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}

bootstrap().catch((error: unknown) => {
  log.error('Renderer bootstrap failed:', error);
});
