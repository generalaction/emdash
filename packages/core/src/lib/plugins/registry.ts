export function createPluginRegistry<TPlugin extends { metadata: { id: string } }>() {
  const plugins = new Map<string, TPlugin>();
  return {
    register(plugin: TPlugin) {
      plugins.set(plugin.metadata.id, plugin);
    },
    get: (id: string) => plugins.get(id),
    getAll: () => [...plugins.values()],
    ids: () => [...plugins.keys()],
  };
}
