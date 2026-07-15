import type { ComposerModelOption } from '@emdash/ui/react/components';
import type { AgentModelOption } from '@shared/core/agents/agent-payload';

export function mergeComposerModelOptions(
  available: Record<string, ComposerModelOption> | null,
  catalog: Record<string, AgentModelOption> | null
) {
  if (!available || !catalog) return available;

  return Object.fromEntries(
    Object.entries(available).map(([id, option]) => {
      const metadata = catalog[id] ?? findAliasMatch(catalog, id);
      if (!metadata) return [id, option];
      return [
        id,
        {
          ...option,
          name: metadata.name,
          ...(metadata.description && { description: metadata.description }),
          ...(metadata.modelFeatures && { modelFeatures: metadata.modelFeatures }),
        },
      ];
    })
  );
}

function findAliasMatch(catalog: Record<string, AgentModelOption>, runtimeId: string) {
  return Object.values(catalog).find((option) => option.aliases?.includes(runtimeId));
}
