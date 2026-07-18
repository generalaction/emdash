import { action, makeObservable, observable, runInAction } from 'mobx';
import type { PaginationSpec } from '../types';

/**
 * PaginationSlice — manages infinite-scroll state.
 *
 * The store accumulates page results into `accumulatedItems`; these are used
 * as the final visible items when pagination is active.
 */
export class PaginationSlice<T> {
  accumulatedItems: T[] = [];
  isFetchingMore = false;
  hasMore = true;
  private cursor: string | null = null;
  private controller: AbortController | null = null;

  constructor(readonly spec: PaginationSpec<T>) {
    makeObservable(this, {
      accumulatedItems: observable.ref,
      isFetchingMore: observable,
      hasMore: observable,
      reset: action,
    });
  }

  /**
   * Clears accumulated items and resets pagination state.
   * Called by the store when search/filter/sort changes cause a full reload.
   */
  reset(): void {
    this.controller?.abort();
    this.controller = null;
    this.accumulatedItems = [];
    this.isFetchingMore = false;
    this.hasMore = true;
    this.cursor = null;
  }

  /**
   * Loads the next page and appends to `accumulatedItems`.
   * No-ops when already fetching or there are no more pages.
   */
  async loadMore(): Promise<void> {
    if (this.isFetchingMore || !this.hasMore) return;

    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;

    runInAction(() => {
      this.isFetchingMore = true;
    });

    try {
      const { items, nextCursor } = await this.spec.loadMore(this.cursor, controller.signal);
      if (controller.signal.aborted) return;
      runInAction(() => {
        this.accumulatedItems = [...this.accumulatedItems, ...items];
        this.cursor = nextCursor;
        this.hasMore = nextCursor !== null;
        this.isFetchingMore = false;
      });
    } catch {
      if (controller.signal.aborted) return;
      runInAction(() => {
        this.isFetchingMore = false;
      });
    }
  }

  dispose(): void {
    this.controller?.abort();
  }
}
