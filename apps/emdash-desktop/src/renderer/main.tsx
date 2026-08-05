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
import { wireCommitHistoryInvalidation } from '@renderer/lib/commit-history-invalidation';
import { wireExternalLinkRequests } from '@renderer/lib/external-link-requests';
import { events, rpc } from '@renderer/lib/ipc';
import { wireModelRegistryInvalidation } from '@renderer/lib/monaco/invalidation-bridges';
import { monacoBootstrap } from '@renderer/lib/monaco/monaco-bootstrap';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import { wirePrCacheInvalidation } from '@renderer/lib/pr-cache-invalidation';
import { snapshotRegistry } from '@renderer/lib/stores/snapshot-registry';
import { viewStateCache } from '@renderer/lib/stores/view-state-cache';
import { log } from '@renderer/utils/logger';
import { initSoundPlayer } from '@renderer/utils/soundPlayer';
import { menuReloadRequestedChannel } from '@shared/events/appEvents';
import type { NavigationSnapshot, SidebarSnapshot } from '@shared/view-state';
import { App } from './App';
import { ErrorBoundary } from './lib/components/error-boundary';
import { appState } from './lib/stores/app-state';

let viewStateReady = false;
let reloadRequested = false;

events.on(menuReloadRequestedChannel, () => {
  if (reloadRequested) return;
  reloadRequested = true;
  void (viewStateReady ? snapshotRegistry.flush() : Promise.resolve())
    .then(async () => {
      const result = await rpc.app.reload();
      if (!result.success) throw new Error(result.error);
    })
    .catch((error: unknown) => {
      reloadRequested = false;
      log.error('Failed to persist view state before reload:', error);
    });
});

async function bootstrap() {
  // Wire invalidation bridges so FS and git events flow into the model registry.
  wireModelRegistryInvalidation(modelRegistry);
  wirePrCacheInvalidation();
  wireCommitHistoryInvalidation();
  wireExternalLinkRequests();

  appState.update.start();
  initSoundPlayer();

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
  appState.snapshots.register('sidebar', () => appState.sidebar.snapshot, 0);
  viewStateReady = true;

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
