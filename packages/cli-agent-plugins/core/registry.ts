import { CLIAgentPlugin } from "./plugin";


export class CLIAgentPluginRegistry {
    private plugins: Map<string, CLIAgentPlugin> = new Map();

    register(plugin: CLIAgentPlugin): void {
        this.plugins.set(plugin.id, plugin);
    }

    get(id: string): CLIAgentPlugin | undefined {
        return this.plugins.get(id);
    }

    getAll(): CLIAgentPlugin[] {
        return Array.from(this.plugins.values());
    }
}