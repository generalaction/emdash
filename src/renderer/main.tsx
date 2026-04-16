import ReactDOM from 'react-dom/client';
import { App } from './App';
import './index.css';
import 'devicon/devicon.min.css';
import type { NavigationSnapshot, SidebarSnapshot } from '@shared/view-state';
import { rpc } from '@renderer/lib/ipc';
import { wireModelRegistryInvalidation } from '@renderer/lib/monaco/invalidation-bridges';
import { codeEditorPool } from '@renderer/lib/monaco/monaco-code-pool';
import { diffEditorPool } from '@renderer/lib/monaco/monaco-diff-pool';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import { log } from '@renderer/utils/logger';
import { initSoundPlayer } from '@renderer/utils/soundPlayer';
import { appState } from './lib/stores/app-state';

async function bootstrap() {
  // Wire invalidation bridges so FS and git events flow into the model registry.
  wireModelRegistryInvalidation(modelRegistry);

  appState.update.start();
  initSoundPlayer();

  // Initialize Monaco and load app data in parallel. Awaiting Monaco here
  // guarantees __monaco is set before React renders, so StickyDiffEditor can
  // create editors synchronously on mount without any async coordination.
  const [, , navResult, sidebarResult] = await Promise.all([
    codeEditorPool.init(0).catch((error: unknown) => {
      log.warn('[monaco-code-pool] init failed:', error);
    }),
    diffEditorPool.init(0).catch((error: unknown) => {
      log.warn('[monaco-diff-pool] init failed:', error);
    }),
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
