import type { HealthSource, RuntimeHealth } from './types';

export class ConstantHealthSource implements HealthSource {
  constructor(private readonly health: RuntimeHealth = { status: 'ok' }) {}

  current(): RuntimeHealth {
    return this.health;
  }

  subscribe(): () => void {
    return () => {};
  }
}
