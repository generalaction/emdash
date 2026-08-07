import { NavigationHistoryStore } from './navigation-history-store';
import { NavigationStore } from './navigation-store';

// Navigation and history are the last app-state members; a later ticket moves
// them into a navigation primitive. Everything else lives in the app scope
// (see @core/primitives/scoped-stores/browser/app-scope).
class AppState {
  readonly history: NavigationHistoryStore;
  readonly navigation: NavigationStore;

  constructor() {
    this.history = new NavigationHistoryStore();
    this.navigation = new NavigationStore();
  }
}

export const appState = new AppState();
