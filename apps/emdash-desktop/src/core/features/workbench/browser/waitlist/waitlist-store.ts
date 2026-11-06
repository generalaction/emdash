import { makeAutoObservable, runInAction } from 'mobx';
import { getHostClient } from '@core/primitives/desktop-host/browser/host-client';
import { releaseKey, type WaitlistPersistedState } from './waitlist-visibility';

const STORAGE_KEY = 'emdash:waitlist-card';

function readPersisted(): WaitlistPersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as WaitlistPersistedState) : {};
  } catch {
    return {};
  }
}

class WaitlistStore {
  persisted: WaitlistPersistedState = readPersisted();
  showJoinedConfirmation = false;
  submitting = false;
  errorMessage: string | null = null;

  constructor() {
    makeAutoObservable(this);
  }

  dismiss(currentVersion: string) {
    this.showJoinedConfirmation = false;
    this.update({ dismissedRelease: releaseKey(currentVersion) });
  }

  clearError() {
    this.errorMessage = null;
  }

  async join(email: string, note = ''): Promise<boolean> {
    if (this.submitting) return false;
    this.submitting = true;
    this.errorMessage = null;
    try {
      const result = await (await getHostClient()).joinWaitlist({ email, note });
      runInAction(() => {
        if (result.success) {
          this.showJoinedConfirmation = true;
          this.update({ joinedEmail: email.trim().toLowerCase() });
        } else {
          this.errorMessage = "We couldn't add you to the waitlist. Please try again.";
        }
      });
      return result.success;
    } catch {
      runInAction(() => {
        this.errorMessage = "We couldn't add you to the waitlist. Please try again.";
      });
      return false;
    } finally {
      runInAction(() => {
        this.submitting = false;
      });
    }
  }

  private update(patch: Partial<WaitlistPersistedState>) {
    this.persisted = { ...this.persisted, ...patch };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.persisted));
    } catch {
      // Persistence is best-effort; the card simply reappears next launch.
    }
  }
}

let store: WaitlistStore | null = null;

export function getWaitlistStore(): WaitlistStore {
  store ??= new WaitlistStore();
  return store;
}
