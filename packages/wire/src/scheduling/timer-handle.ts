import type { IDisposable } from '@emdash/shared';

export interface TimerHandle extends IDisposable {
  readonly active: boolean;
}

export class DisposableTimerHandle implements TimerHandle {
  private _active = true;

  constructor(private readonly clearTimer: () => void) {}

  get active(): boolean {
    return this._active;
  }

  dispose(): void {
    if (!this._active) return;
    this._active = false;
    this.clearTimer();
  }

  fire(callback: () => void): void {
    if (!this._active) return;
    this._active = false;
    callback();
  }
}
