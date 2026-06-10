import type { PluginIcon } from './icon';
import type { CLIAgentPluginMetadata } from './metadata';
import type { CLIAgentPluginProvider } from './provider';

export class CLIAgentPluginMetadataRegistry {
  private readonly plugins = new Map<string, CLIAgentPluginMetadata>();

  register(plugin: CLIAgentPluginMetadata): void {
    this.plugins.set(plugin.id, plugin);
  }

  get(id: string): CLIAgentPluginMetadata | undefined {
    return this.plugins.get(id);
  }

  getAll(): CLIAgentPluginMetadata[] {
    return Array.from(this.plugins.values());
  }

  ids(): string[] {
    return Array.from(this.plugins.keys());
  }
}

export class CLIAgentPluginProviderRegistry {
  private readonly providers = new Map<string, CLIAgentPluginProvider>();

  register(provider: CLIAgentPluginProvider): void {
    this.providers.set(provider.metadata.id, provider);
  }

  get(id: string): CLIAgentPluginProvider | undefined {
    return this.providers.get(id);
  }

  getAll(): CLIAgentPluginProvider[] {
    return Array.from(this.providers.values());
  }

  ids(): string[] {
    return Array.from(this.providers.keys());
  }
}

export class CLIAgentPluginIconRegistry {
  private readonly icons = new Map<string, PluginIcon>();

  register(id: string, icon: PluginIcon): void {
    this.icons.set(id, icon);
  }

  get(id: string): PluginIcon | undefined {
    return this.icons.get(id);
  }

  ids(): string[] {
    return Array.from(this.icons.keys());
  }
}
