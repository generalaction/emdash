/**
 * PendingInjectionManager - Singleton for managing text to be prepended to the next terminal input
 *
 * This is implemented as a singleton rather than React context because:
 * 1. TerminalSessionManager is a class-based component that can't access React context
 * 2. We need synchronous access to pending text during terminal input handling
 *
 * Supports multiple named sources (e.g. diff comments, PR comments) that are
 * concatenated when retrieved and all cleared when the injection is consumed.
 */

type InjectionUsedCallback = () => void;

const DEFAULT_SOURCE = 'default';

class PendingInjectionManagerSingleton {
  private sources = new Map<string, string>();
  private listeners: Set<() => void> = new Set();
  private onInjectionUsedCallbacks: Set<InjectionUsedCallback> = new Set();

  /**
   * Set pending text for a named source. Multiple sources are concatenated on retrieval.
   */
  setPending(text: string, source: string = DEFAULT_SOURCE): void {
    this.sources.set(source, text);
    this.notifyListeners();
  }

  /**
   * Get concatenated pending text from all sources (if any)
   */
  getPending(): string | null {
    if (this.sources.size === 0) return null;
    return Array.from(this.sources.values()).join('');
  }

  /**
   * Clear pending text. If source is given, clears only that source; otherwise clears all.
   */
  clear(source?: string): void {
    if (source !== undefined) {
      this.sources.delete(source);
    } else {
      this.sources.clear();
    }
    this.notifyListeners();
  }

  /**
   * Check if there is any pending text
   */
  hasPending(): boolean {
    return this.sources.size > 0;
  }

  /**
   * Called when the pending injection has been used (prepended to user input)
   * This clears all sources and notifies callbacks
   */
  markUsed(): void {
    this.sources.clear();
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
