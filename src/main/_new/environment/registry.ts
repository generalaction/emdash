import type { EnvironmentProvider } from './types';
import { localEnvironmentProvider } from './providers/local';
import { sshEnvironmentProvider } from './providers/ssh';
import { vmEnvironmentProvider } from './providers/vm';

/**
 * Maps `project.environmentProvider` string values to concrete
 * `EnvironmentProvider` implementations.
 *
 * Defaults to `LocalEnvironmentProvider` for any unknown / unset value
 * so that existing projects continue to work without a migration step.
 *
 * To add a new environment type:
 *  1. Create a class implementing `EnvironmentProvider` in `providers/`.
 *  2. Register it here with `register()`.
 *  3. Set `project.environmentProvider` to the new type string.
 */
export class EnvironmentProviderRegistry {
  private providers = new Map<string, EnvironmentProvider>();

  constructor() {
    this.register(localEnvironmentProvider);
    this.register(sshEnvironmentProvider);
    this.register(vmEnvironmentProvider);
  }

  register(provider: EnvironmentProvider): void {
    this.providers.set(provider.type, provider);
  }

  resolve(type: string | null | undefined): EnvironmentProvider {
    if (type && this.providers.has(type)) {
      return this.providers.get(type)!;
    }
    // Default to local for legacy projects without environmentProvider set
    return localEnvironmentProvider;
  }
}

export const environmentProviderRegistry = new EnvironmentProviderRegistry();
