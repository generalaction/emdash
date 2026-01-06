/**
 * PendingInjectionManager - Singleton for managing text to be prepended to the next terminal input
 *
 * This is implemented as a singleton rather than React context because:
 * 1. TerminalSessionManager is a class-based component that can't access React context
 * 2. We need synchronous access to pending text during terminal input handling
 */

type InjectionUsedCallback = () => void;

class PendingInjectionManagerSingleton {
  private pendingText: string | null = null;
  private listeners: Set<() => void> = new Set();
  private onInjectionUsedCallbacks: Set<InjectionUsedCallback> = new Set();

  /**
   * Set pending text to be prepended to the next user message
   */
  setPending(text: string): void {
    this.pendingText = text;
    this.notifyListeners();
  }

  /**
   * Get the current pending text (if any)
   */
  getPending(): string | null {
    return this.pendingText;
  }

  /**
   * Clear the pending text
   */
  clear(): void {
    this.pendingText = null;
    this.notifyListeners();
  }

  /**
   * Check if there is pending text
   */
  hasPending(): boolean {
    return this.pendingText !== null;
  }

  /**
   * Called when the pending injection has been used (prepended to user input)
   * This clears the pending text and notifies callbacks
   */
  markUsed(): void {
    this.pendingText = null;
    this.notifyListeners();
    // Notify callbacks that injection was used
    for (const callback of this.onInjectionUsedCallbacks) {
      try {
        callback();
      } catch (e) {
        console.error('PendingInjectionManager: callback error', e);
      }
    }
  }

  /**
   * Register a listener to be notified when pending text changes
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Register a callback to be called when the injection is used
   * Useful for marking comments as sent after they're injected
   */
  onInjectionUsed(callback: InjectionUsedCallback): () => void {
    this.onInjectionUsedCallbacks.add(callback);
    return () => {
      this.onInjectionUsedCallbacks.delete(callback);
    };
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (e) {
        console.error('PendingInjectionManager: listener error', e);
      }
    }
  }
}

// Export singleton instance
export const pendingInjectionManager = new PendingInjectionManagerSingleton();
